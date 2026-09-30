// "!hint stage" and "!hint class".
//
// A player can see that Castle will not open, but not which of the twenty-odd
// Grassland stages counts towards it or how many ranger classes it is short.
// The seed's logic knows both; these commands read it back out and then hint
// the answer through Archipelago in the ordinary way.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GAME_JS = join(here, "..", "public", "game.js");
const MAIN_JS = join(here, "..", "src", "main.js");

/** Pull a method out of main.js by its signature, up to its closing brace. */
function methodSource(src, signature) {
    const start = src.indexOf(`    ${signature} {`);
    assert.ok(start !== -1, `could not find ${signature} in main.js`);
    const rest = src.slice(start);
    const end = rest.search(/\n {4}\}/);
    assert.ok(end !== -1, `could not find the end of ${signature}`);
    return rest.slice(0, end + 6);
}

// Castle wants 3 Grassland unlocks and 2 classes; Submarine Shrine follows it.
// Sea stages sit behind Castle, Grassland stages behind nothing, and Volcano
// (89) is a boss rush stage behind Submarine Shrine.
const LOGIC = {
    regions: { Grassland: [2, 3, 4, 5, 6], Sea: [21, 22, 23] },
    region_gate: { Grassland: null, Sea: 10 },
    gates: [
        { stage: 10, region: "Grassland", after: null, stages: 3, classes: 2 },
        { stage: 29, region: "Sea", after: 10, stages: 2, classes: 3 },
    ],
    boss_rush: [{ stage: 89, after: 29 }],
};

/** The real gate helpers, over a stubbed world. */
function loadGateHelpers({ held = [], classes = 1, logic = LOGIC, open = {} } = {}) {
    const src = readFileSync(GAME_JS, "utf8");
    const start = src.indexOf("function gateNeeds(logic, gate){");
    const end = src.indexOf("window.ArchipelagoMod.blockedStageNeeds = blockedStageNeeds;");
    assert.ok(start !== -1 && end > start, "could not find the gate helpers in game.js");
    const mod = { rangerClassesUnlocked: new Set(Array.from({ length: classes }, (_, i) => `c${i}`)) };
    return new Function(
        "window",
        "logicDescription",
        "openGates",
        "unlocked",
        `${src.slice(start, end)} return { nextGateNeeds, blockedStageNeeds, gateFor };`,
    )(
        { ArchipelagoMod: mod },
        () => logic,
        () => open,
        (stage) => held.includes(stage),
    );
}

const loadNeeds = (options) => loadGateHelpers(options).nextGateNeeds;

describe("nextGateNeeds", () => {
    it("says nothing when the seed shipped no logic", () => {
        assert.equal(loadNeeds({ logic: null })(), null);
    });

    it("says nothing when every gate is open", () => {
        assert.equal(loadNeeds({ open: { 10: true, 29: true } })(), null);
    });

    it("picks the first gate that is still shut", () => {
        assert.equal(loadNeeds({ open: { 10: true, 29: false } })().stage, 29);
    });

    it("does not skip ahead to a later gate", () => {
        // Both are shut, and the second cannot open before the first.
        assert.equal(loadNeeds({ open: {} })().stage, 10);
    });

    it("reports the gate's own missing unlock", () => {
        assert.equal(loadNeeds({ held: [2, 3, 4] })().needsOwnUnlock, true);
        assert.equal(loadNeeds({ held: [2, 3, 4, 10] })().needsOwnUnlock, false);
    });

    it("counts what the region still owes", () => {
        const needs = loadNeeds({ held: [2, 3] })();
        assert.equal(needs.heldInRegion, 2);
        assert.equal(needs.requiredInRegion, 3);
        assert.deepEqual(needs.missingStages, [4, 5, 6]);
    });

    it("counts what the classes still owe", () => {
        const needs = loadNeeds({ classes: 1 })();
        assert.equal(needs.classesHeld, 1);
        assert.equal(needs.classesRequired, 2);
    });

    it("names the region, so the player is told where to look", () => {
        assert.equal(loadNeeds({ open: { 10: true } })().region, "Sea");
    });
});

// Enforce Logic refuses a click on a barred stage. It used to do so in
// silence; now it says which gate the stage waits on and what that gate lacks.
describe("blockedStageNeeds", () => {
    const blocked = (options) => loadGateHelpers(options).blockedStageNeeds;

    it("names the region's gate for an ordinary stage", () => {
        assert.equal(blocked({ held: [21] })(21).stage, 10);
    });

    it("names the gate itself for a boss stage", () => {
        assert.equal(blocked({ open: { 10: true } })(29).stage, 29);
    });

    it("walks back to the first shut gate on the chain", () => {
        // Submarine Shrine is shut, but so is Castle before it.
        assert.equal(blocked({})(29).stage, 10, "the real blocker is further back");
    });

    it("sends a boss rush stage to the last gate", () => {
        assert.equal(blocked({ open: { 10: true } })(89).stage, 29);
    });

    it("has nothing to say for a stage behind no gate", () => {
        assert.equal(blocked({})(2), null);
        assert.equal(blocked({})(999), null);
    });

    it("says nothing without a logic description", () => {
        assert.equal(blocked({ logic: null })(21), null);
    });

    it("carries the same detail as the next-gate summary", () => {
        const needs = blocked({ held: [2, 3, 21] })(21);
        assert.deepEqual(
            [needs.heldInRegion, needs.requiredInRegion, needs.missingStages, needs.needsOwnUnlock],
            [2, 3, [4, 5, 6], true],
        );
    });
});

describe("the refused click says why", () => {
    const src = readFileSync(MAIN_JS, "utf8");

    function loadExplain(needs) {
        const body = src.slice(src.indexOf("    _explainBlockedStage(stage) {"));
        const method = body.slice(0, body.search(/\n {4}\}/) + 6);
        globalThis.Stage_Names = [];
        globalThis.Stage_Names[10] = "Castle";
        globalThis.Stage_Names[21] = "Seaside 1";
        globalThis.window = { ArchipelagoMod: { blockedStageNeeds: () => needs } };
        const host = new Function(`return { logged: [], log(msg) { this.logged.push(msg); }, ${method} };`)();
        return host;
    }

    it("names the gate and what it still wants", () => {
        const host = loadExplain({
            stage: 10,
            region: "Grassland",
            needsOwnUnlock: true,
            heldInRegion: 1,
            requiredInRegion: 3,
            classesHeld: 1,
            classesRequired: 2,
        });
        host._explainBlockedStage(21);
        assert.equal(host.logged.length, 1);
        assert.match(host.logged[0], /Seaside 1 is barred: Castle is not open yet/);
        assert.match(host.logged[0], /Unlock Castle, 2 more Grassland stages, 1 more ranger class\./);
    });

    it("still says something when the seed gives no detail", () => {
        const host = loadExplain(null);
        host._explainBlockedStage(21);
        assert.match(host.logged[0], /Seaside 1 is out of logic/);
    });

    it("is what the map calls on a refused click", () => {
        const game = readFileSync(GAME_JS, "utf8");
        assert.match(game, /else if \(Clicked && stageIsBlocked\(s\) && window\.ArchipelagoMod\.explainBlockedStage\)/);
    });

    it("warns at connect when there is nothing to enforce", () => {
        assert.match(src, /Enforce Logic is on, but this seed carries no logic this site can evaluate/);
    });
});

describe("which messages the command takes", () => {
    const src = readFileSync(MAIN_JS, "utf8");
    const pattern = new RegExp(src.match(/const match = (\/\^!hint[^/]+\/i)\.exec\(text\);/)[1].slice(1, -2), "i");

    for (const text of ["!hint stage", "!hint class", "!HINT Stage", "!hint  stage"]) {
        it(`takes ${JSON.stringify(text)}`, () => assert.equal(pattern.test(text), true));
    }

    for (const text of ["!hint", "!hint Unlock Lake", "!hint_location 1", "!hints", "hello !hint", "!release"]) {
        it(`leaves ${JSON.stringify(text)} for the server`, () => {
            // A bare !hint is the server's own listing of your hints and points.
            assert.equal(pattern.test(text), false, "this would stop reaching Archipelago");
        });
    }
});

describe("what it asks for", () => {
    const src = readFileSync(MAIN_JS, "utf8");

    /** The real hint pickers, on a stub client that records what it says. */
    function loadHinter({ hinted = [], classRandomizer = 1, held = ["Boxer"] } = {}) {
        const methods = [
            "_hintNextStage(needs)",
            "_hintNextClass(needs)",
            "_hintedItemNames()",
            "_askServerToHint(itemName)",
        ].map((sig) => methodSource(src, sig));
        globalThis.Stage_Names = [];
        globalThis.Stage_Names[10] = "Castle";
        for (const [id, name] of [
            [2, "Grassland 1"],
            [3, "Grassland 2"],
            [4, "Grassland 3"],
        ]) {
            globalThis.Stage_Names[id] = name;
        }
        globalThis.window = { ArchipelagoMod: { rangerClassesUnlocked: new Set(held) } };
        const host = new Function(`return {
            RANGER_CLASSES: { 14000: "Boxer", 14001: "Gladiator", 14002: "Sniper" },
            slotData: null,
            client: null,
            said: [],
            logged: [],
            log(msg) { this.logged.push(msg); },
            ${methods.join(",\n")}
        };`)();
        host.slotData = { ranger_class_randomizer: classRandomizer };
        host.client = {
            players: { self: { slot: 1 } },
            items: {
                hints: hinted.map((name) => ({ found: false, item: { name, receiver: { slot: 1 } } })),
            },
            messages: { say: (text) => host.said.push(text) },
        };
        return host;
    }

    const NEEDS = {
        stage: 10,
        region: "Grassland",
        needsOwnUnlock: false,
        heldInRegion: 1,
        requiredInRegion: 3,
        missingStages: [4, 2, 3],
        classesHeld: 1,
        classesRequired: 2,
    };

    it("asks for the gate's own unlock before any region stage", () => {
        const host = loadHinter();
        host._hintNextStage({ ...NEEDS, needsOwnUnlock: true });
        assert.deepEqual(host.said, ["!hint Unlock Castle"]);
    });

    it("takes the lowest missing stage, so it reads in progression order", () => {
        const host = loadHinter();
        host._hintNextStage(NEEDS);
        assert.deepEqual(host.said, ["!hint Unlock Grassland 1"]);
    });

    it("skips a stage the room has already been told about", () => {
        const host = loadHinter({ hinted: ["Unlock Grassland 1", "Unlock Grassland 2"] });
        host._hintNextStage(NEEDS);
        assert.deepEqual(host.said, ["!hint Unlock Grassland 3"], "a hint was bought twice");
    });

    it("says so when every missing stage is already hinted", () => {
        const host = loadHinter({ hinted: ["Unlock Grassland 1", "Unlock Grassland 2", "Unlock Grassland 3"] });
        host._hintNextStage(NEEDS);
        assert.deepEqual(host.said, []);
        assert.match(host.logged[0], /already hinted/);
    });

    it("does not buy the gate's own unlock twice either", () => {
        const host = loadHinter({ hinted: ["Unlock Castle"] });
        host._hintNextStage({ ...NEEDS, needsOwnUnlock: true });
        assert.deepEqual(host.said, []);
    });

    it("only counts our own unfound hints", () => {
        const host = loadHinter();
        host.client.items.hints = [
            { found: true, item: { name: "Unlock Grassland 1", receiver: { slot: 1 } } },
            { found: false, item: { name: "Unlock Grassland 2", receiver: { slot: 2 } } },
        ];
        assert.deepEqual([...host._hintedItemNames()], []);
    });

    it("hints the first missing class in table order", () => {
        const host = loadHinter();
        host._hintNextClass(NEEDS);
        assert.deepEqual(host.said, ["!hint Unlock Gladiator Class"]);
    });

    it("skips a class already hinted", () => {
        const host = loadHinter({ hinted: ["Unlock Gladiator Class"] });
        host._hintNextClass(NEEDS);
        assert.deepEqual(host.said, ["!hint Unlock Sniper Class"]);
    });

    it("does not ask for a class item that is not in the pool", () => {
        // With Class Randomizer off there are none, and the server would only
        // reject the hint.
        const host = loadHinter({ classRandomizer: 0 });
        host._hintNextClass(NEEDS);
        assert.deepEqual(host.said, []);
        assert.match(host.logged[0], /Class Randomizer is off/);
    });

    it("goes through Archipelago, so it costs and shows like any hint", () => {
        assert.match(src, /this\.client\.messages\.say\(`!hint \$\{itemName\}`\)/);
    });
});
