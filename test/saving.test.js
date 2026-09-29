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

describe("saving on a stage transition", () => {
    // _tick is defined above _doTickWork, so this runs to the end of the file.
    const tick = src.slice(src.indexOf("async _doTickWork() {"));

    it("saves when play ends", () => {
        assert.match(tick, /this\.lastSequence === 12 && Sequence_Step !== 12/);
    });

    it("saves when the stage changes", () => {
        assert.match(tick, /this\.lastStage !== Current_Stage/);
    });

    it("remembers the stage it saved at, so it fires once", () => {
        const block = tick.slice(tick.indexOf("const leftPlay"));
        assert.ok(
            block.indexOf("this.lastStage = Current_Stage;") < block.indexOf("await this.saveAPData()"),
            "the stage is recorded after saving, so every frame would save again",
        );
    });

    it("starts from a stage that cannot match, so the first one saves", () => {
        assert.match(src, /this\.lastStage = -1;/);
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
