// Book Cost Randomizer mode 4: vanilla prices divided by ten.
//
// Modes 1-3 roll their own price; mode 4 keeps the vanilla one and divides it,
// so the divide happens after the price is settled. The same entry_cost feeds
// the affordability check, the charge and the price on the button, so dividing
// it once keeps all three honest.
//
// Vanilla prices start at 500, so a tenth is never small enough to need a floor.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GAME_JS = join(here, "..", "public", "game.js");

// The rule as the game applies it.
const cheapen = (cost) => Math.floor(cost / 10);

describe("the price it charges", () => {
    it("is a tenth, rounded down", () => {
        assert.equal(cheapen(1000), 100);
        assert.equal(cheapen(89000), 8900);
        assert.equal(cheapen(1555), 155);
    });

    it("stays well clear of zero on the cheapest book there is", () => {
        // 500 in randomizer mode, 1000 otherwise.
        assert.equal(cheapen(500), 50);
        assert.equal(cheapen(1000), 100);
    });
});

describe("where the divide sits", () => {
    const src = readFileSync(GAME_JS, "utf8");
    const block = src.slice(src.indexOf("// Modes 1-3 roll their own price"));
    const beforeUse = block.slice(0, block.indexOf("isMouseHoveredCenter"));
    const afterDivide = block.slice(block.indexOf("isMouseHoveredCenter"));

    it("leaves the rolled modes to roll their own price", () => {
        assert.match(
            beforeUse,
            /bookCostRandomizer >= 1 && window\.ArchipelagoMod\.bookCostRandomizer <= 3/,
            "mode 4 would take a rolled price and divide that instead of the vanilla one",
        );
    });

    it("divides only in mode 4", () => {
        assert.match(beforeUse, /bookCostRandomizer == 4/);
        assert.match(beforeUse, /entry_cost = floor\(entry_cost\/10\)/);
    });

    it("comes before the price is checked, charged or shown", () => {
        for (const use of ["Team_Gold>=entry_cost", "gainGold(-entry_cost)", '"$"+entry_cost']) {
            assert.ok(afterDivide.includes(use), `${use} no longer follows the divide`);
        }
    });
});
