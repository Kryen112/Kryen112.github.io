// The gold seam and Ring Link's scaling. The subtle part is accumulating before
// flooring: gold moves in amounts far below the ratio (a gun shot costs tens),
// so flooring each change on its own would throw all of it away.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");

/** The two gold functions out of game.js, with the globals they touch stubbed. */
function loadGold() {
    const source = readFileSync(GAME_JS, "utf8");
    const start = source.indexOf("function gainGold(amount){");
    const end = source.indexOf("window.ArchipelagoMod.applyRingLinkGold = applyRingLinkGold;");
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

// What _flushRingLink does with the pending total.
function flush(mod, ratio) {
    const pending = mod.pendingRingLinkGold || 0;
    const rings = Math.trunc(pending / ratio);
    if (rings === 0) return 0;
    mod.pendingRingLinkGold = pending - rings * ratio;
    return rings;
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

describe("ring link flushing", () => {
    let gold;
    beforeEach(() => {
        gold = loadGold();
    });

    it("accumulates before flooring", () => {
        gold.state.Team_Gold = 10000; // you cannot spend gold you do not have
        gold.mod.pendingRingLinkGold = 0;
        for (let i = 0; i < 10; i++) gold.gainGold(-40); // ten gun shots
        assert.equal(flush(gold.mod, 100), -4, "each shot floored alone would send nothing");
    });

    it("carries the remainder to the next flush", () => {
        gold.gainGold(250);
        assert.equal(flush(gold.mod, 100), 2);
        assert.equal(gold.mod.pendingRingLinkGold, 50);
        gold.gainGold(50);
        assert.equal(flush(gold.mod, 100), 1, "the carried 50 plus 50 is another ring");
        assert.equal(gold.mod.pendingRingLinkGold, 0);
    });

    it("sends nothing when the total is below the ratio", () => {
        gold.gainGold(99);
        assert.equal(flush(gold.mod, 100), 0);
        assert.equal(gold.mod.pendingRingLinkGold, 99, "the remainder must survive");
    });

    it("loses nothing over a long run of small changes", () => {
        let sent = 0;
        for (let i = 0; i < 1000; i++) {
            gold.gainGold(37);
            sent += flush(gold.mod, 100);
        }
        assert.equal(sent * 100 + gold.mod.pendingRingLinkGold, 37000, "gold went missing");
    });

    it("nets gains against spends inside one window", () => {
        gold.gainGold(500);
        gold.gainGold(-300);
        assert.equal(flush(gold.mod, 100), 2);
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
// gainGold, or Ring Link silently misses it. The -50% gold trap wrote Team_Gold
// directly, so a trap that took half your money broadcast nothing.
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
        assert.match(src, /this\.ringSource === null\)\s*\{\s*\n\s*stats\.skippedNoSource/);
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
