// How medals stack on the yaml multipliers.
//
// The Gold Medal multiplied the yaml's gold multiplier while the Iron and Bronze
// medals were added to theirs, so 5x XP with +100% of Iron Medals was 6x rather
// than the 10x that gold got. One helper now does all three.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");
const src = readFileSync(GAME_JS, "utf8");

const stackMedal = new Function(
    `${src.match(/function stackMedal\(yaml_mult,bonus_percent\)\{[\s\S]*?\n\}/)[0]}
     return stackMedal;`,
)();

describe("stackMedal", () => {
    it("is 100 percent with no multiplier and no medals", () => {
        assert.equal(stackMedal(1, 0), 100);
        assert.equal(stackMedal(undefined, 0), 100);
    });

    it("multiplies the medal bonus onto the yaml multiplier", () => {
        assert.equal(stackMedal(5, 100), 1000, "5x with +100% should be 10x, not 6x");
        assert.equal(stackMedal(2, 50), 300);
    });

    it("applies medals alone at 1x", () => {
        assert.equal(stackMedal(1, 40), 140);
    });
});

describe("every multiplier uses it", () => {
    for (const [what, name] of [
        ["XP", "exp_mult"],
        ["loot", "drop_rate_mult"],
        ["gold", "gold_value_mult"],
    ]) {
        it(`${what} stacks through stackMedal`, () => {
            assert.match(src, new RegExp(`${name} = stackMedal\\(`), `${what} went back to adding medals`);
        });
    }
});
