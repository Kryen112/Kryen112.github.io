// The XP a level needs.
//
// The level-up check and the XP bar each had their own copy of the arithmetic
// series and their own hard-coded thresholds for the last two levels, and the
// two disagreed once: the "no double level-up" cap used the series at level 98,
// which made level 99 unreachable. xpForLevel is now the only source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");
const src = readFileSync(GAME_JS, "utf8");

const xpForLevel = new Function(
    `${src.match(/function xpForLevel\(level\)\{[\s\S]*?\n\}/)[0]}
     return xpForLevel;`,
)();

describe("xpForLevel", () => {
    it("starts at nothing", () => {
        assert.equal(xpForLevel(1), 0);
    });

    it("follows the game's series below the cap", () => {
        assert.equal(xpForLevel(2), 1000);
        assert.equal(xpForLevel(3), 3000);
        for (let level = 1; level < 98; level++) {
            assert.equal(xpForLevel(level + 1) - xpForLevel(level), 1000 * level, `level ${level} to ${level + 1}`);
        }
    });

    it("has the game's own thresholds for the last two levels", () => {
        assert.equal(xpForLevel(98), 4753000);
        assert.equal(xpForLevel(99), 9999999);
    });

    it("puts a level that does not exist one above the ceiling", () => {
        assert.equal(xpForLevel(100), 10000000);
    });
});

describe("it is the only source of the thresholds", () => {
    it("no level threshold is hard-coded anywhere else", () => {
        assert.doesNotMatch(src, /4753000/, "a level-98 threshold is hard-coded outside xpForLevel");
    });

    it("the anti-cheat, the level up and the XP bar all read it", () => {
        const sites = src.match(/xp_for_prev_LV = xpForLevel\(xp_LV\);/g) ?? [];
        assert.equal(sites.length, 3, "a call site went back to its own arithmetic");
    });

    it("measures the cap against the last level up", () => {
        const clamps = src.match(/var xp_LV = minOf\(LV\[0\],98\);/g) ?? [];
        assert.equal(clamps.length, 3, "level 99 would be measured against a 100th level");
    });
});
