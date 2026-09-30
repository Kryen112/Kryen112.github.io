// When the game reaches Archipelago's server.
//
// Saving used to be a side effect of talking to the server: a check sent, an
// item received, a shop scouted. Play a run of stages with none of those and
// nothing was ever written, so a refresh threw away every level and item earned
// since the last one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
const src = readFileSync(MAIN_JS, "utf8");

describe("saving on a transition", () => {
    // _tick is defined above _doTickWork, so this runs to the end of the file.
    const tick = src.slice(src.indexOf("async _doTickWork() {"));

    it("saves when you leave somewhere your game can change", () => {
        assert.match(
            tick,
            /_isSomewhereThatChanges\(this\.lastSequence\) && !this\._isSomewhereThatChanges\(Sequence_Step\)/,
        );
    });

    it("saves when the stage changes", () => {
        assert.match(tick, /this\.lastStage !== Current_Stage/);
    });

    it("remembers the stage it saved at, so it fires once", () => {
        const block = tick.slice(tick.indexOf("const left ="));
        assert.ok(
            block.indexOf("this.lastStage = Current_Stage;") < block.indexOf("await this.saveAPData()"),
            "the stage is recorded after saving, so every frame would save again",
        );
    });

    it("starts from a stage that cannot match, so the first one saves", () => {
        assert.match(src, /this\.lastStage = -1;/);
    });
});

describe("what counts as somewhere your game can change", () => {
    const body = src.slice(src.indexOf("    _isSomewhereThatChanges(step) {"));
    const inside = new Function("step", body.slice(body.indexOf("{") + 1, body.search(/\n {4}\}/)));

    it("counts a stage", () => assert.equal(inside(12), true));

    for (const [step, what] of [
        [51, "walking in"],
        [52, "standing in it"],
        [53, "the shop"],
        [54, "the book"],
        [55, "the Forget Tree"],
        [59, "walking out"],
    ]) {
        it(`counts the town: ${what}`, () => {
            // Gold, items and levels all move in a town, and leaving one used
            // not to save a thing.
            assert.equal(inside(step), true, `step ${step} is treated as outside`);
        });
    }

    for (const [step, what] of [
        [6, "the world map"],
        [13, "the fade out of a stage"],
        [20, "the pause screen"],
        [30, "game over"],
        [3, "class select"],
    ]) {
        it(`does not count ${what}`, () => assert.equal(inside(step), false));
    }

    it("does not save while you browse a town", () => {
        // Moving between the town's own screens stays inside it, so shopping
        // does not write on every click.
        for (const [from, to] of [
            [52, 53],
            [53, 52],
            [52, 54],
            [53, 55],
        ]) {
            assert.ok(inside(from) && inside(to), `${from} -> ${to} would save`);
        }
    });
});

describe("tick bodies never overlap", () => {
    // A body that awaits a scout or a save spans frames; a second body under
    // it would see the same transition and save, scout or send twice.
    const tick = src.slice(src.indexOf("    _tick() {"), src.indexOf("\n    }", src.indexOf("    _tick() {")));

    it("skips the frame while the last body is still running", () => {
        assert.match(tick, /if \(!this\._tickBusy\) \{/);
        assert.match(tick, /this\._tickBusy = true;/);
    });

    it("frees the next frame whether the body resolved or threw", () => {
        assert.match(tick, /\.finally\(\(\) => \{\s*\n\s*this\._tickBusy = false;/);
    });

    it("starts free", () => {
        assert.match(src, /this\._tickBusy = false;\n/);
    });
});

describe("the other reasons to save are still there", () => {
    // These were the only ones, and the point is to add to them, not replace.
    for (const [what, needle] of [
        ["sending a check", "    async sendLocation(id) {"],
        ["receiving an item", "    async _applyItem(id, firstTime) {"],
        ["connecting", "    async _connect() {"],
    ]) {
        it(`still saves after ${what}`, () => {
            const start = src.indexOf(needle);
            assert.ok(start !== -1, `could not find ${what}`);
            const next = src.slice(start + 10).search(/\n {4}(async )?[A-Za-z_]+\(/);
            const body = src.slice(start, start + 10 + next);
            assert.match(body, /saveAPData\(\)/, `${what} no longer saves`);
        });
    }
});
