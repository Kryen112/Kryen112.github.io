// in_logic() decides whether a world-map dot is yellow ("Archipelago thinks you
// can do this") or orange ("unlocked, but out of logic").
//
// It used to carry its own copy of the apworld's tables, which drifted six
// different ways before 1.6.0. It now evaluates the description the seed sends
// in slot_data, so these tests feed it descriptions rather than asserting
// against constants -- there are none left in the client to assert against.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");

const Unlocked = 1;
const STAGE_COUNT = 90;

/** Evaluate just the logic block; loading all of game.js needs a canvas. */
function loadLogic() {
    const source = readFileSync(GAME_JS, "utf8");
    const start = source.indexOf("function unlocked(stage) {");
    const end = source.indexOf("// map size");
    assert.ok(start !== -1 && end > start, "could not find the logic block in public/game.js");

    const stageStatus = new Array(STAGE_COUNT).fill(0);
    const fakeWindow = { ArchipelagoMod: {} };
    const townIds = new Set([0, 20, 47, 70, 77]);
    const build = new Function(
        "Stage_Status",
        "Unlocked",
        "window",
        "isTownStage",
        `${source.slice(start, end)}
         return { in_logic, unlocked, unlockedInRegion, openGates, stageIsBlocked };`,
    );
    const api = build(stageStatus, Unlocked, fakeWindow, (s) => townIds.has(s));
    return { stageStatus, mod: fakeWindow.ArchipelagoMod, ...api };
}

// A description shaped exactly like the one rules.py emits.
function description({ stages = 0, classes = 0 } = {}) {
    return {
        regions: {
            Grassland: [2, 3, 4, 5],
            Sea: [21, 22, 23, 24],
            Desert: [34, 35],
            Ice: [48, 49],
            Hell: [64, 65],
        },
        region_gate: { Grassland: null, Sea: 10, Desert: 29, Ice: 42, Hell: 63 },
        gates: [
            { stage: 10, region: "Grassland", after: null, stages, classes },
            { stage: 29, region: "Sea", after: 10, stages, classes },
            { stage: 42, region: "Desert", after: 29, stages, classes },
            { stage: 63, region: "Ice", after: 42, stages, classes },
            { stage: 88, region: "Hell", after: 63, stages, classes },
        ],
        boss_rush: [
            { stage: 89, after: 88 },
            { stage: 55, after: 88 },
        ],
        free: [1],
    };
}

describe("in_logic", () => {
    let logic;
    const unlock = (...stages) => stages.forEach((s) => (logic.stageStatus[s] |= Unlocked));

    beforeEach(() => {
        logic = loadLogic();
        logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
        logic.mod.logic = description();
    });

    it("keeps a locked stage out of logic", () => {
        assert.equal(logic.in_logic(21), false);
    });

    it("puts Opening Street in logic with nothing else", () => {
        unlock(1);
        assert.equal(logic.in_logic(1), true);
    });

    it("does not count a free stage towards a gate", () => {
        logic.mod.logic = description({ stages: 1 });
        unlock(1, 10);
        assert.equal(logic.in_logic(10), false, "Opening Street is not a Grassland unlock");
        unlock(2);
        assert.equal(logic.in_logic(10), true);
    });

    it("requires a boss's own unlock before the region behind it", () => {
        unlock(21);
        assert.equal(logic.in_logic(21), false);
        unlock(10);
        assert.equal(logic.in_logic(21), true);
    });

    it("chains each gate onto the one before it", () => {
        const chain = [10, 29, 42, 63, 88];
        for (const [index, missing] of chain.entries()) {
            logic = loadLogic();
            logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
            logic.mod.logic = description();
            unlock(...chain.filter((s) => s !== missing));
            for (const blocked of chain.slice(index)) {
                assert.equal(logic.in_logic(blocked), false, `${blocked} opened without ${missing}`);
            }
        }
    });

    it("keeps boss rush stages behind the last gate and their own unlock", () => {
        const chain = [10, 29, 42, 63, 88];
        for (const bossRush of [55, 89]) {
            logic = loadLogic();
            logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
            logic.mod.logic = description();

            unlock(...chain);
            assert.equal(logic.in_logic(bossRush), false, "opened without its own unlock");
            unlock(bossRush);
            assert.equal(logic.in_logic(bossRush), true);
            logic.stageStatus[88] = 0;
            assert.equal(logic.in_logic(bossRush), false, "opened without the last gate");
        }
    });

    it("counts the starting class towards a class gate", () => {
        logic.mod.logic = description({ classes: 2 });
        unlock(10);
        assert.equal(logic.in_logic(10), false, "one class should not satisfy two");
        logic.mod.rangerClassesUnlocked.add("Boxer");
        assert.equal(logic.in_logic(10), true, "start + 1 unlock is 2");
    });

    it("counts unlocks held, not stages cleared", () => {
        logic.mod.logic = description({ stages: 3 });
        unlock(10, 2, 3, 4);
        assert.equal(logic.unlockedInRegion([2, 3, 4, 5]), 3);
        assert.equal(logic.in_logic(10), true, "nothing was beaten, three are unlocked");
    });

    it("treats towns as in logic so they always draw white", () => {
        unlock(20);
        assert.equal(logic.in_logic(20), true);
    });

    it("puts Grassland stages in logic on their own unlock alone", () => {
        unlock(3);
        assert.equal(logic.in_logic(3), true, "Grassland sits behind no gate");
    });
});

describe("in_logic on a seed that describes no logic", () => {
    // Every 1.7.0 game in progress gets the new client the moment the site
    // deploys, and those seeds send no description.
    let logic;

    beforeEach(() => {
        logic = loadLogic();
        logic.mod.logic = null;
        logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
    });

    it("falls back to unlocked, so the map still works", () => {
        assert.equal(logic.in_logic(42), false);
        logic.stageStatus[42] |= Unlocked;
        assert.equal(logic.in_logic(42), true);
    });

    it("never blocks a stage, whatever enforcement says", () => {
        logic.mod.enforceLogic = 1;
        assert.equal(logic.stageIsBlocked(42), false);
    });
});

describe("stageIsBlocked", () => {
    let logic;

    beforeEach(() => {
        logic = loadLogic();
        logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
        logic.mod.logic = description();
    });

    it("blocks nothing when enforcement is off", () => {
        logic.mod.enforceLogic = 0;
        logic.stageStatus[21] |= Unlocked; // unlocked but behind the Castle gate
        assert.equal(logic.in_logic(21), false);
        assert.equal(logic.stageIsBlocked(21), false);
    });

    it("blocks an unlocked stage that is out of logic", () => {
        logic.mod.enforceLogic = 1;
        logic.stageStatus[21] |= Unlocked;
        assert.equal(logic.stageIsBlocked(21), true);
    });

    it("stops blocking once the stage comes into logic", () => {
        logic.mod.enforceLogic = 1;
        logic.stageStatus[21] |= Unlocked;
        logic.stageStatus[10] |= Unlocked;
        assert.equal(logic.stageIsBlocked(21), false);
    });
});
