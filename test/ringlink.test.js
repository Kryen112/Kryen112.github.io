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
             gainGold: (n) => { Team_Gold = state.Team_Gold; gainGold(n); state.Team_Gold = Team_Gold; },
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
