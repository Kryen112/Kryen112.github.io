// The gold seam and Ring Link's scaling. The subtle part is accumulating before
// flooring: gold moves in amounts far below the ratio (a gun shot costs tens),
// so flooring each change on its own would throw all of it away.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");

/** The two gold functions out of game.js, with the globals they touch stubbed. */
function loadGold() {
    const source = readFileSync(GAME_JS, "utf8");
    const start = source.indexOf("function gainGold(amount){");
    const end = source.indexOf("window.ArchipelagoMod.applyTrapGold = applyTrapGold;");
    assert.ok(start !== -1 && end > start, "could not find the gold seam in game.js");

    const fakeWindow = { ArchipelagoMod: { pendingRingLinkGold: 0 } };
    const state = { Team_Gold: 0 };
    const build = new Function(
        "window",
        "clamp",
        "antiCheatCheck",
        "antiCheatSet",
        "state",
        `${source.slice(start, end)}
         return {
             gainGold: (n) => { Team_Gold = state.Team_Gold; const moved = gainGold(n); state.Team_Gold = Team_Gold; return moved; },
             applyRingLinkGold: (n) => { Team_Gold = state.Team_Gold; applyRingLinkGold(n); state.Team_Gold = Team_Gold; },
             applyTrapGold: (n) => { Team_Gold = state.Team_Gold; applyTrapGold(n); state.Team_Gold = Team_Gold; },
         };
         var Team_Gold;`,
    );
    const api = build(
        fakeWindow,
        (v, lo, hi) => Math.min(Math.max(v, lo), hi),
        () => {},
        () => {},
        state,
    );
    return { mod: fakeWindow.ArchipelagoMod, state, ...api };
}

const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");

/** Pull a method out of main.js by its signature, up to its closing brace. */
function methodSource(src, signature) {
    const start = src.indexOf(`    ${signature} {`);
    assert.ok(start !== -1, `could not find ${signature} in main.js`);
    const rest = src.slice(start);
    const end = rest.search(/\n {4}\}/);
    assert.ok(end !== -1, `could not find the end of ${signature}`);
    return rest.slice(0, end + 6);
}

/** The real flush and bounce handlers, on a stub client that records what goes out. */
function loadLink({ ratio = 100, source = 7, connected = true, ringLink = 1 } = {}) {
    const src = readFileSync(MAIN_JS, "utf8");
    const methods = ["async _flushRingLink()", "_onRingLinkBounce(packet)"].map((sig) => methodSource(src, sig));
    const sent = [];
    const applied = [];
    const win = {
        ArchipelagoMod: {
            ringLink,
            ringLinkRatio: ratio,
            pendingRingLinkGold: 0,
            applyRingLinkGold: (g) => applied.push(g),
        },
    };
    const host = new Function(
        "window",
        "RING_LINK_FLUSH_MS",
        `return {
            _connected: ${connected},
            ringSource: ${source},
            lastRingFlush: 0,
            client: null,
            logged: [],
            log(msg) { this.logged.push(msg); },
            ${methods.join(",\n")}
        };`,
    )(win, 5000);
    host.client = {
        authenticated: true,
        socket: {
            async send(packet) {
                sent.push(packet);
            },
        },
    };
    return { host, mod: win.ArchipelagoMod, sent, applied };
}

/** What the real _flushRingLink sends for a pending total, in rings. */
async function flush(mod, ratio) {
    const link = loadLink({ ratio });
    link.mod.pendingRingLinkGold = mod.pendingRingLinkGold || 0;
    await link.host._flushRingLink();
    mod.pendingRingLinkGold = link.mod.pendingRingLinkGold;
    return link.sent[0]?.data.amount ?? 0;
}

describe("gainGold", () => {
    let gold;
    beforeEach(() => {
        gold = loadGold();
    });

    it("records what actually moved", () => {
        gold.gainGold(300);
        assert.equal(gold.state.Team_Gold, 300);
        assert.equal(gold.mod.pendingRingLinkGold, 300);
    });

    it("records the capped amount, not the requested one", () => {
        gold.state.Team_Gold = 9999990;
        gold.mod.pendingRingLinkGold = 0;
        gold.gainGold(500); // only 9 can actually land
        assert.equal(gold.state.Team_Gold, 9999999);
        assert.equal(gold.mod.pendingRingLinkGold, 9, "sent rings for gold that never arrived");
    });

    it("never reports a spend larger than the gold you had", () => {
        gold.state.Team_Gold = 30;
        gold.mod.pendingRingLinkGold = 0;
        gold.gainGold(-500);
        assert.equal(gold.state.Team_Gold, 0);
        assert.equal(gold.mod.pendingRingLinkGold, -30);
    });
});

describe("applyRingLinkGold", () => {
    it("adds gold without queueing it for rebroadcast", () => {
        const gold = loadGold();
        gold.applyRingLinkGold(1000);
        assert.equal(gold.state.Team_Gold, 1000);
        assert.equal(gold.mod.pendingRingLinkGold, 0, "inbound gold would loop back out");
    });
});

describe("applyTrapGold", () => {
    it("takes gold without queueing the loss for Ring Link", () => {
        // The trap is Archipelago's doing; broadcasting it would halve every
        // linked player's gold along with this one's.
        const gold = loadGold();
        gold.state.Team_Gold = 1000;
        gold.applyTrapGold(-500);
        assert.equal(gold.state.Team_Gold, 500);
        assert.equal(gold.mod.pendingRingLinkGold, 0, "the trap would drain the room");
    });

    it("is what the gold trap uses", () => {
        const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
        const src = readFileSync(MAIN_JS, "utf8");
        const body = src.slice(src.indexOf("    loseHalfGold() {"));
        const method = body.slice(0, body.search(/\n {4}\}/));
        assert.match(method, /window\.ArchipelagoMod\.applyTrapGold\(-lostGold\)/);
        assert.doesNotMatch(method, /gainGold\(/, "the trap went back through the Ring Link seam");
    });
});

describe("ring link flushing", () => {
    let gold;
    beforeEach(() => {
        gold = loadGold();
    });

    it("accumulates before flooring", async () => {
        gold.state.Team_Gold = 10000; // you cannot spend gold you do not have
        gold.mod.pendingRingLinkGold = 0;
        for (let i = 0; i < 10; i++) gold.gainGold(-40); // ten gun shots
        assert.equal(await flush(gold.mod, 100), -4, "each shot floored alone would send nothing");
    });

    it("carries the remainder to the next flush", async () => {
        gold.gainGold(250);
        assert.equal(await flush(gold.mod, 100), 2);
        assert.equal(gold.mod.pendingRingLinkGold, 50);
        gold.gainGold(50);
        assert.equal(await flush(gold.mod, 100), 1, "the carried 50 plus 50 is another ring");
        assert.equal(gold.mod.pendingRingLinkGold, 0);
    });

    it("sends nothing when the total is below the ratio", async () => {
        gold.gainGold(99);
        assert.equal(await flush(gold.mod, 100), 0);
        assert.equal(gold.mod.pendingRingLinkGold, 99, "the remainder must survive");
    });

    it("loses nothing over a long run of small changes", async () => {
        let sent = 0;
        for (let i = 0; i < 1000; i++) {
            gold.gainGold(37);
            sent += await flush(gold.mod, 100);
        }
        assert.equal(sent * 100 + gold.mod.pendingRingLinkGold, 37000, "gold went missing");
    });

    it("nets gains against spends inside one window", async () => {
        gold.gainGold(500);
        gold.gainGold(-300);
        assert.equal(await flush(gold.mod, 100), 2);
    });
});

// The flush and the bounce handler, end to end on a stub socket.
describe("the flush on the wire", () => {
    let now;
    const realNow = Date.now;
    beforeEach(() => {
        now = 100000;
        Date.now = () => now;
    });
    afterEach(() => {
        Date.now = realNow;
    });

    it("sends the rings, tagged, with our source id", async () => {
        const { host, mod, sent } = loadLink({ source: 42 });
        mod.pendingRingLinkGold = 250;
        await host._flushRingLink();
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0].tags, ["RingLink"]);
        assert.equal(sent[0].cmd, "Bounce");
        assert.deepEqual([sent[0].data.amount, sent[0].data.source], [2, 42]);
        assert.equal(mod.pendingRingLinkGold, 50, "the remainder was lost");
    });

    it("throttles to one send per window", async () => {
        const { host, mod, sent } = loadLink();
        mod.pendingRingLinkGold = 200;
        await host._flushRingLink();
        mod.pendingRingLinkGold = 200;
        await host._flushRingLink();
        assert.equal(sent.length, 1, "two sends inside one window");
        now += 5001;
        await host._flushRingLink();
        assert.equal(sent.length, 2);
    });

    it("stays quiet without a source id", async () => {
        const { host, mod, sent } = loadLink({ source: null });
        mod.pendingRingLinkGold = 1000;
        await host._flushRingLink();
        assert.deepEqual(sent, [], "an unidentified packet would be dropped by every other client as its own");
    });

    it("stays quiet while disconnected", async () => {
        const { host, mod, sent } = loadLink({ connected: false });
        mod.pendingRingLinkGold = 1000;
        await host._flushRingLink();
        assert.deepEqual(sent, []);
    });

    it("drains the pending total when Ring Link is off", async () => {
        const { host, mod, sent } = loadLink({ ringLink: 0 });
        mod.pendingRingLinkGold = 1000;
        await host._flushRingLink();
        assert.deepEqual(sent, []);
        assert.equal(mod.pendingRingLinkGold, 0, "it would grow all session");
    });
});

describe("the bounce off the wire", () => {
    const packet = (amount, source, tags = ["RingLink"]) => ({ tags, data: { amount, source, time: 0 } });

    it("turns another player's rings into gold at the ratio", () => {
        const { host, applied } = loadLink({ ratio: 100, source: 7 });
        host._onRingLinkBounce(packet(3, 99));
        assert.deepEqual(applied, [300]);
    });

    it("drops the server's echo of our own packet", () => {
        const { host, applied } = loadLink({ source: 7 });
        host._onRingLinkBounce(packet(3, 7));
        assert.deepEqual(applied, [], "our own rings came back as gold");
    });

    it("does not treat an unset source as matching everyone", () => {
        const { host, applied } = loadLink({ source: null });
        host._onRingLinkBounce(packet(3, null));
        assert.deepEqual(applied, [300], "a null source swallowed the room");
    });

    it("ignores other links' bounces", () => {
        const { host, applied } = loadLink();
        host._onRingLinkBounce(packet(3, 99, ["DeathLink"]));
        assert.deepEqual(applied, []);
    });

    it("ignores amounts that come to nothing", () => {
        const { host, applied } = loadLink();
        host._onRingLinkBounce(packet(0, 99));
        host._onRingLinkBounce(packet("abc", 99));
        assert.deepEqual(applied, []);
    });

    it("does nothing with Ring Link off", () => {
        const { host, applied } = loadLink({ ringLink: 0 });
        host._onRingLinkBounce(packet(3, 99));
        assert.deepEqual(applied, []);
    });
});

// Stick Ranger's anti-cheat stores the gold seen at the last antiCheatSet and
// compares it on the next antiCheatCheck. A mutation between the two nulls
// Game_Canvas, which reads to the player as the game crashing. The Angel's
// per-ring payout shipped unbracketed in 1.8.0, so an Angel froze the game as
// soon as a thrown ring landed.
describe("every gold mutation is anti-cheat bracketed", () => {
    const lines = readFileSync(GAME_JS, "utf8").split("\n");
    const lineNos = (needle) =>
        lines.map((l, i) => (l.includes(needle) && !l.includes("function") ? i + 1 : 0)).filter(Boolean);

    const checks = lineNos("antiCheatCheck()");
    const sets = lineNos("antiCheatSet()");
    const calls = lines
        .map((l, i) => (/\bgainGold\(/.test(l) && !l.includes("function gainGold") ? i + 1 : 0))
        .filter(Boolean);

    it("finds the call sites", () => {
        assert.ok(calls.length >= 9, `expected the gold call sites, found ${calls.length}`);
    });

    for (const call of calls) {
        it(`line ${call}: ${lines[call - 1].trim().slice(0, 48)}`, () => {
            const before = (xs) => Math.max(...xs.filter((x) => x < call), -1);
            const lastCheck = before(checks);
            const lastSet = before(sets);
            assert.ok(lastCheck !== -1, "no antiCheatCheck precedes this gold change");
            assert.ok(
                lastSet < lastCheck,
                `gold changes at line ${call} outside a bracket (last antiCheatSet at ${lastSet} came after the last antiCheatCheck at ${lastCheck})`,
            );
            assert.ok(
                sets.some((s) => s > call),
                "no antiCheatSet commits this gold change",
            );
        });
    }
});

// The one-seam invariant: every gold movement the mod causes has to go through
// gainGold or one of the two deliberate bypasses (inbound Ring Link gold and
// trap gold), never Team_Gold directly -- or the anti-cheat and Ring Link both
// miss it.
describe("the gold seam has no bypasses", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");

    it("main.js never assigns Team_Gold directly", () => {
        const offenders = readFileSync(MAIN_JS, "utf8")
            .split("\n")
            .map((l, i) => [i + 1, l])
            .filter(([, l]) => /^\s*Team_Gold\s*(=[^=]|\+=|-=)/.test(l));
        assert.deepEqual(offenders, [], `these move gold without going through gainGold: ${JSON.stringify(offenders)}`);
    });

    it("drops the pending total when Ring Link is off", () => {
        const src = readFileSync(MAIN_JS, "utf8");
        const start = src.indexOf("async _flushRingLink() {");
        assert.ok(start !== -1, "could not find _flushRingLink");
        const guard = src.slice(start, src.indexOf("\n    }", start));
        assert.match(
            guard,
            /if \(!window\.ArchipelagoMod\.ringLink\) \{[\s\S]*pendingRingLinkGold = 0;[\s\S]*return;/,
            "with Ring Link off nothing drains the pending total, so it grows all session",
        );
    });
});

// The flush has to survive a slow tick.
//
// It used to be the last statement of _doTickWork, behind four saveAPData calls
// and two sendLocation calls in one promise. Any of those stalling meant the
// flush did not run, and as the save payload grew the link went quiet with
// nothing in the console to show for it.
describe("the ring flush does not ride on the tick's other work", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");
    const tick = src.slice(src.indexOf("    _tick() {"), src.indexOf("\n    }", src.indexOf("    _tick() {")));
    const tickWork = src.slice(
        src.indexOf("async _doTickWork() {"),
        src.indexOf("\n    _tick() {", src.indexOf("async _doTickWork() {")),
    );

    it("_tick drives it directly", () => {
        assert.match(tick, /this\._flushRingLink\(\)/, "the flush is not started by _tick");
    });

    it("_doTickWork does not", () => {
        assert.doesNotMatch(tickWork, /_flushRingLink/, "the flush is back behind the tick's awaits");
    });

    it("its failures cannot take the tick down with them", () => {
        assert.match(tick, /_flushRingLink\(\)\.catch\(/, "an unhandled rejection would escape");
    });

    it("it checks the connection itself, now that nothing else does", () => {
        const flush = src.slice(src.indexOf("async _flushRingLink() {"));
        const body = flush.slice(0, flush.indexOf("\n    }"));
        assert.match(body, /this\._connected/, "it would send while disconnected");
    });

    it("keeps the timer for sends it actually makes", () => {
        // Spending the window on an empty flush delays the next real one.
        const flush = src.slice(src.indexOf("async _flushRingLink() {"));
        const body = flush.slice(0, flush.indexOf("\n    }"));
        assert.ok(
            body.indexOf("if (rings === 0) return;") < body.indexOf("this.lastRingFlush = Date.now();"),
            "the timer resets even when nothing is sent",
        );
    });
});

// The source id identifies our own packets so the server's echo can be dropped.
// A stray copy of the connect-time initialisation sat in the shop-exit branch of
// _doTickWork, so walking out of a shop set it to null. Once both players had
// visited a shop, every packet carried source null, every client matched null
// against its own null, and the whole link threw itself away as self-echo.
describe("the ring source survives play", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");

    it("is only assigned at construction and on connect", () => {
        const assignments = src.match(/this\.ringSource\s*=(?!=)/g) ?? [];
        assert.equal(assignments.length, 2, "something else assigns the ring source");
    });

    it("is not touched by the tick", () => {
        const work = src.slice(src.indexOf("async _doTickWork() {"), src.indexOf("\n    _tick() {"));
        assert.doesNotMatch(work, /ringSource/, "the tick can reset the ring source again");
    });

    it("an unset source never matches another player's packet", () => {
        assert.match(
            src,
            /this\.ringSource !== null && data\.source === this\.ringSource/,
            "a null source would swallow every incoming packet",
        );
    });

    it("nothing unidentified goes on the wire", () => {
        assert.match(src, /if \(this\.ringSource === null\) return;/);
    });
});

// gainGold reports the change that actually happened, so a caller that shows a
// number shows a true one. The angel's ring payout floats a "+gold" over its
// head, and at the gold cap nothing lands, so nothing should float.
describe("gainGold reports what landed", () => {
    let gold;
    beforeEach(() => {
        gold = loadGold();
    });

    it("returns the amount for an ordinary gain", () => {
        assert.equal(gold.gainGold(50), 50);
    });

    it("returns what fitted, not what was asked for", () => {
        gold.state.Team_Gold = 9999990;
        assert.equal(gold.gainGold(500), 9, "a caller would show a number that never arrived");
    });

    it("returns zero at the cap, so nothing is shown", () => {
        gold.state.Team_Gold = 9999999;
        assert.equal(gold.gainGold(50), 0);
    });

    it("returns a negative for a spend", () => {
        gold.state.Team_Gold = 500;
        assert.equal(gold.gainGold(-200), -200);
    });

    it("returns zero for a no-op", () => {
        assert.equal(gold.gainGold(0), 0);
    });
});

describe("the angel's ring payout is shown", () => {
    const src = readFileSync(GAME_JS, "utf8");
    const angel = src.slice(src.indexOf("SR_Player.prototype.Angel = function"));
    const payout = angel.slice(0, angel.indexOf("PL_ring_distance_to_travel"));

    it("floats a number over the angel that earned it", () => {
        assert.match(payout, /Indicators\.INadd\(this\.PL_joint\[current_char\]\[0\]\.x/);
    });

    it("uses gold yellow, like a pickup", () => {
        assert.match(payout, /ring_pay,0xFFFF00\)/);
    });

    it("shows what landed rather than what was offered", () => {
        assert.match(payout, /ring_pay = gainGold\(window\.ArchipelagoMod\.ringGold\)/);
        assert.match(payout, /if \(ring_pay > 0\)/, "a capped payout would still float a number");
    });
});
