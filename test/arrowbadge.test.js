// The arrow badge over a Progressive Shop check.
//
// data/AP_arrow.gif is the tile such a check wears: the Archipelago logo with
// an arrow beside it, drawn in place of the plain logo. The logo tiles are
// opaque, so this replaces rather than overlays. Swapping that one file is the
// whole job -- nothing here names anything but the 24x24 the shop already uses.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GAME_JS = join(here, "..", "public", "game.js");
const MAIN_JS = join(here, "..", "src", "main.js");
const ARROW = join(here, "..", "public", "data", "AP_arrow.gif");

describe("the badge art", () => {
    it("ships, so a fresh checkout draws something", () => {
        assert.ok(statSync(ARROW).size > 0, "AP_arrow.gif is missing or empty");
    });

    it("is a GIF, like the other Archipelago tiles", () => {
        assert.equal(readFileSync(ARROW).subarray(0, 3).toString("latin1"), "GIF");
    });

    it("is 24x24, matching the logo it sits on", () => {
        // GIF header carries width and height as little-endian shorts at 6..9.
        const head = readFileSync(ARROW);
        assert.deepEqual([head.readUInt16LE(6), head.readUInt16LE(8)], [24, 24]);
    });
});

describe("loading it", () => {
    const src = readFileSync(GAME_JS, "utf8");

    it("is declared, fetched and decoded like the other tiles", () => {
        assert.match(src, /var AP_Arrow = new SR_Image;/);
        assert.match(src, /AP_Arrow\.IGset\("AP_arrow\.gif"\);/);
        assert.match(src, /imgToArray\(AP_Arrow\);/);
    });

    it("is drawn in place of the plain logo", () => {
        assert.match(src, /cell_progressive\? AP_Arrow :\(cell_blocked\? AP_Img_Grey :AP_Img\)/);
    });

    it("dims with the cell when the check is out of logic", () => {
        assert.match(src, /\(cell_progressive && cell_blocked\)\? 0xFF606060 :0xFFFFFFFF/);
    });
});

describe("shopCheckIsProgressive", () => {
    function load(mod) {
        const src = readFileSync(GAME_JS, "utf8");
        const start = src.indexOf("function shopCheckIsProgressive(itemId){");
        const end = src.indexOf("\n}", start) + 2;
        return new Function("window", `${src.slice(start, end)} return shopCheckIsProgressive;`)({
            ArchipelagoMod: mod,
        });
    }

    it("badges a Progressive Shop check", () => {
        assert.equal(load({ shopHints: 1, shopHintSpoiler: { 7: { progressiveShop: true } } })(7), true);
    });

    it("leaves an ordinary check alone", () => {
        assert.equal(load({ shopHints: 1, shopHintSpoiler: { 7: { progressiveShop: false } } })(7), false);
    });

    it("leaves an unscouted cell alone", () => {
        assert.equal(load({ shopHints: 1, shopHintSpoiler: {} })(7), false);
    });

    it("keeps the mystery when Shop Hints are off", () => {
        assert.equal(load({ shopHints: 0, shopHintSpoiler: { 7: { progressiveShop: true } } })(7), false);
    });
});

describe("what earns the badge", () => {
    const src = readFileSync(MAIN_JS, "utf8");

    it("is our own Progressive Shop items, from any Stick Ranger slot", () => {
        const body = src.slice(src.indexOf("    _isOurProgressiveShopItem(game, itemId) {"));
        assert.match(body.slice(0, body.search(/\n {4}\}/)), /game === "Stick Ranger" && this\._isProgressiveShopItem/);
    });

    it("is never worn by a disguised trap", () => {
        assert.match(src, /sprite: null, progressiveShop: false/);
    });
});
