// Item flags are a bitfield. The old switch compared the whole value against
// 1/2/4, so every combined classification fell through to the filler colour.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { itemColor } from "../src/colors.js";

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
