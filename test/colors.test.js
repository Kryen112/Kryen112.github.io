// Item flags are a bitfield. The old switch compared the whole value against
// 1/2/4, so every combined classification fell through to the filler colour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { itemColor, itemColorValue } from "../src/colors.js";

const PROGRESSION = "#9f79ee";
const USEFUL = "#4f94cd";
const TRAP = "#ed7b6e";
const FILLER = "#09cbcb";

describe("itemColor", () => {
    it("maps the plain classifications", () => {
        assert.equal(itemColor(0), FILLER);
        assert.equal(itemColor(0b001), PROGRESSION);
        assert.equal(itemColor(0b010), USEFUL);
        assert.equal(itemColor(0b100), TRAP);
    });

    it("treats combined flags as progression first", () => {
        // 3 = progression + useful. This is the case players reported as
        // "a progressive item isn't rendering as progressive".
        assert.equal(itemColor(0b011), PROGRESSION);
        assert.equal(itemColor(0b101), PROGRESSION);
        assert.equal(itemColor(0b111), PROGRESSION);
    });

    it("prefers useful over trap when both are set", () => {
        assert.equal(itemColor(0b110), USEFUL);
    });

    it("never returns filler for a flagged item", () => {
        for (let flags = 1; flags <= 0b111; flags++) {
            assert.notEqual(itemColor(flags), FILLER, `flags ${flags} fell through to filler`);
        }
    });
});

// game.js draws on a canvas, so it needs the colour as a number. It cannot
// import this module, so main.js hands it over on window.ArchipelagoMod -- one
// table, so the book page, the shop and the message log cannot drift.
describe("itemColorValue", () => {
    it("matches the message log colour", () => {
        for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
            assert.equal(itemColorValue(flags), parseInt(itemColor(flags).slice(1), 16));
        }
    });

    it("treats the flags as a bitfield", () => {
        assert.equal(itemColorValue(0b011), itemColorValue(0b001), "progression+useful is progression");
        assert.equal(itemColorValue(0b101), itemColorValue(0b001), "progression+trap is progression");
        assert.notEqual(itemColorValue(0), itemColorValue(1));
    });

    it("is a plain 24-bit number", () => {
        for (const flags of [0, 1, 2, 4]) {
            const v = itemColorValue(flags);
            assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffff, `bad colour ${v}`);
        }
    });
});

describe("the canvas UI uses that one table", () => {
    const GAME = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js"), "utf8");

    it("book and shop hints both go through apItemColor", () => {
        assert.match(GAME, /itemTextColour = apItemColor\(bookOfStage\.itemClassification\)/);
        assert.match(GAME, /apItemColor\(shop_hint\.itemClassification\)/);
    });

    it("no hard-coded classification colours are left", () => {
        for (const hex of ["9F79EE", "4f94CD", "ED7B6E", "09CBCB"]) {
            assert.doesNotMatch(GAME, new RegExp(hex, "i"), `${hex} is still hard-coded in game.js`);
        }
    });
});
