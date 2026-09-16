// The Archipelago logic block inside public/game.js, exercised in isolation.
//
// in_logic() decides whether a world-map dot is yellow ("Archipelago thinks you
// can do this") or orange ("unlocked, but out of logic"). It is a hand-written
// mirror of stick_ranger/rules.py in the apworld repo, so it can silently drift
// away from the generator. These tests pin the shape of that mirror; the apworld
// has the matching test in stick_ranger/test/test_data.py.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_JS = join(HERE, "..", "public", "game.js");

const Unlocked = 1;
const TOWN_STAGE_IDS = new Set([0, 20, 47, 70, 77]);
const STAGE_COUNT = 90;

// Same ids as CLIENT_LOGIC_REGION_STAGES in the apworld's test_data.py, which
// derives them from the actual "Unlock <stage>" item codes.
const EXPECTED_REGION_STAGES = {
    grassland: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    sea: [21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33],
    desert: [34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46],
    ice: [48, 49, 50, 51, 52, 53, 54, 56, 57, 58, 59, 60, 61, 62],
    hell: [64, 65, 66, 67, 68, 69, 71, 72, 73, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87],
};

const BOSS_STAGES = { castle: 10, submarineShrine: 29, pyramid: 42, iceCastle: 63, hellCastle: 88 };
const MOUNTAINTOP = 55;
const VOLCANO = 89;

/**
 * Evaluate just the AP logic block out of game.js. Loading the whole file needs
 * a canvas and the game's own globals, and this is the only part under test.
 */
function loadLogic() {
    const source = readFileSync(GAME_JS, "utf8");
    const start = source.indexOf("const LOGIC_REGION_STAGES = {");
    const end = source.indexOf("// map size");
    assert.ok(start !== -1 && end > start, "could not find the logic block in public/game.js");

    const stageStatus = new Array(STAGE_COUNT).fill(0);
    const fakeWindow = { ArchipelagoMod: {} };
    const build = new Function(
        "Stage_Status",
        "Unlocked",
        "TOWN_STAGE_IDS",
        "window",
        `${source.slice(start, end)}
         return { in_logic, unlocked, unlockedInRegion, LOGIC_REGION_STAGES };`,
    );
    return { stageStatus, mod: fakeWindow.ArchipelagoMod, ...build(stageStatus, Unlocked, TOWN_STAGE_IDS, fakeWindow) };
}

describe("LOGIC_REGION_STAGES", () => {
    const { LOGIC_REGION_STAGES } = loadLogic();

    it("matches the stage ids the apworld hands out unlock items for", () => {
        assert.deepEqual(LOGIC_REGION_STAGES, EXPECTED_REGION_STAGES);
    });

    it("never counts a boss stage towards a region", () => {
        const counted = new Set(Object.values(LOGIC_REGION_STAGES).flat());
        for (const stage of [...Object.values(BOSS_STAGES), MOUNTAINTOP, VOLCANO]) {
            assert.ok(!counted.has(stage), `boss stage ${stage} is counted as a region stage`);
        }
    });

    it("never counts a town or Opening Street", () => {
        const counted = new Set(Object.values(LOGIC_REGION_STAGES).flat());
        for (const stage of [...TOWN_STAGE_IDS, 1]) {
            assert.ok(!counted.has(stage), `stage ${stage} has no unlock item but is counted`);
        }
    });
});

describe("in_logic", () => {
    let logic;

    const unlock = (...stages) => stages.forEach((stage) => (logic.stageStatus[stage] |= Unlocked));
    const setRequirements = (stages, classes) => {
        for (const boss of ["Castle", "SubmarineShrine", "Pyramid", "IceCastle", "HellCastle"]) {
            logic.mod[`stagesFor${boss}`] = stages;
            logic.mod[`classesFor${boss}`] = classes;
        }
    };

    beforeEach(() => {
        logic = loadLogic();
        logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
        setRequirements(0, 0);
    });

    it("keeps a locked stage out of logic", () => {
        assert.equal(logic.in_logic(21), false);
    });

    it("puts Opening Street in logic with nothing else", () => {
        unlock(1);
        assert.equal(logic.in_logic(1), true);
    });

    it("does not count Opening Street towards the Castle gate", () => {
        setRequirements(1, 0);
        unlock(1, BOSS_STAGES.castle);
        assert.equal(logic.unlockedInRegion("grassland"), 0);
        assert.equal(logic.in_logic(BOSS_STAGES.castle), false);
        unlock(2);
        assert.equal(logic.in_logic(BOSS_STAGES.castle), true);
    });

    it("requires the Castle unlock before any sea stage", () => {
        unlock(21);
        assert.equal(logic.in_logic(21), false);
        unlock(BOSS_STAGES.castle);
        assert.equal(logic.in_logic(21), true);
    });

    it("chains each boss gate onto the one before it", () => {
        const chain = [
            BOSS_STAGES.castle,
            BOSS_STAGES.submarineShrine,
            BOSS_STAGES.pyramid,
            BOSS_STAGES.iceCastle,
            BOSS_STAGES.hellCastle,
        ];
        for (const [index, boss] of chain.entries()) {
            logic = loadLogic();
            logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
            setRequirements(0, 0);
            unlock(...chain.filter((stage) => stage !== boss));
            for (const blocked of chain.slice(index)) {
                assert.equal(logic.in_logic(blocked), false, `stage ${blocked} opened without ${boss}`);
            }
        }
    });

    it("keeps the boss rush stages behind Hell Castle and their own unlock", () => {
        const chain = Object.values(BOSS_STAGES);
        for (const bossRush of [MOUNTAINTOP, VOLCANO]) {
            logic = loadLogic();
            logic.mod.rangerClassesUnlocked = new Set(["Sniper"]);
            setRequirements(0, 0);

            unlock(...chain);
            assert.equal(logic.in_logic(bossRush), false, "opened without its own unlock");

            unlock(bossRush);
            assert.equal(logic.in_logic(bossRush), true);

            logic.stageStatus[BOSS_STAGES.hellCastle] = 0;
            assert.equal(logic.in_logic(bossRush), false, "opened without Unlock Hell Castle");
        }
    });

    it("counts the starting class towards the class gate", () => {
        setRequirements(0, 2);
        unlock(BOSS_STAGES.castle);
        assert.equal(logic.in_logic(BOSS_STAGES.castle), false, "one class should not satisfy two");
        logic.mod.rangerClassesUnlocked.add("Boxer");
        assert.equal(logic.in_logic(BOSS_STAGES.castle), true, "start + 1 unlock is 2");
    });

    it("counts unlocks rather than clears", () => {
        setRequirements(3, 0);
        unlock(BOSS_STAGES.castle, 2, 3, 4);
        assert.equal(logic.unlockedInRegion("grassland"), 3);
        assert.equal(logic.in_logic(BOSS_STAGES.castle), true, "no stage was beaten, but three are unlocked");
    });

    it("treats towns as in logic so they always draw white", () => {
        setRequirements(99, 99);
        unlock(20);
        assert.equal(logic.in_logic(20), true);
    });
});
