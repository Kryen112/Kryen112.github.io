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

// Castle wants 3 Grassland unlocks and 2 classes; Submarine Shrine follows it.
const LOGIC = {
    regions: { Grassland: [2, 3, 4, 5, 6], Sea: [21, 22, 23] },
    gates: [
        { stage: 10, region: "Grassland", after: null, stages: 3, classes: 2 },
        { stage: 29, region: "Sea", after: 10, stages: 2, classes: 3 },
    ],
};

/** The real nextGateNeeds, over a stubbed world. */
function loadNeeds({ held = [], classes = 1, logic = LOGIC, open = {} } = {}) {
    const src = readFileSync(GAME_JS, "utf8");
    const start = src.indexOf("function nextGateNeeds(){");
    const end = src.indexOf("\n}", start) + 2;
    const mod = { rangerClassesUnlocked: new Set(Array.from({ length: classes }, (_, i) => `c${i}`)) };
    return new Function(
        "window",
        "logicDescription",
        "openGates",
        "unlocked",
        `${src.slice(start, end)} return nextGateNeeds;`,
    )(
        { ArchipelagoMod: mod },
        () => logic,
        () => open,
        (stage) => held.includes(stage),
    );
}

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

describe("which messages the command takes", () => {
    const pattern = /^!hint(?:\s+(stage|class))?$/i;

    for (const [text, taken] of [
        ["!hint", true],
        ["!hint stage", true],
        ["!hint class", true],
        ["!HINT Stage", true],
        ["!hint  stage", true],
    ]) {
        it(`takes ${JSON.stringify(text)}`, () => assert.equal(pattern.test(text), taken));
    }

    for (const text of ["!hint Unlock Lake", "!hint_location 1", "!hints", "hello !hint", "!release"]) {
        it(`leaves ${JSON.stringify(text)} for the server`, () => {
            assert.equal(pattern.test(text), false, "this would stop reaching Archipelago");
        });
    }
});

describe("what it asks for", () => {
    const src = readFileSync(MAIN_JS, "utf8");

    it("asks for the gate's own unlock before any region stage", () => {
        // Without that one, the region count does not matter.
        const body = src.slice(src.indexOf("    _hintNextStage(needs) {"));
        const method = body.slice(0, body.search(/\n {4}\}/));
        assert.ok(
            method.indexOf("needs.needsOwnUnlock") < method.indexOf("needs.missingStages"),
            "it would hint a region stage while the boss unlock is still missing",
        );
    });

    it("takes the lowest missing stage, so it reads in progression order", () => {
        assert.match(src, /\[\.\.\.needs\.missingStages\]\.sort\(\(a, b\) => a - b\)\[0\]/);
    });

    it("goes through Archipelago, so it costs and shows like any hint", () => {
        assert.match(src, /this\.client\.messages\.say\(`!hint \$\{itemName\}`\)/);
    });

    it("bare !hint only reports, and spends nothing", () => {
        const body = src.slice(src.indexOf("    _describeNextGate(needs) {"));
        const method = body.slice(0, body.search(/\n {4}\}/));
        assert.doesNotMatch(method, /_askServerToHint/, "the summary should not spend hint points");
    });
});
