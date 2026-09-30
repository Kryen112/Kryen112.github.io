// The marked tile: a shop check holding progression or a trap, from any game.
//
// data/AP_marked.gif is the tile such a check wears: the Archipelago logo with
// a mark beside it, drawn in place of the plain logo. The logo tiles are
// opaque, so this replaces rather than overlays. Swapping that one file is the
// whole job -- nothing here names anything but the 24x24 the shop already uses.
//
// Progression and traps share the tile on purpose: a disguised trap poses as
// progression, so one tile for both keeps the disguise intact.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GAME_JS = join(here, "..", "public", "game.js");
const MAIN_JS = join(here, "..", "src", "main.js");
const TILE = join(here, "..", "public", "data", "AP_marked.gif");

describe("the marked tile art", () => {
    it("ships, so a fresh checkout draws something", () => {
        assert.ok(statSync(TILE).size > 0, "AP_marked.gif is missing or empty");
    });

    it("is a GIF, like the other Archipelago tiles", () => {
        assert.equal(readFileSync(TILE).subarray(0, 3).toString("latin1"), "GIF");
    });

    it("is 24x24, matching the logo it replaces", () => {
        // GIF header carries width and height as little-endian shorts at 6..9.
        const head = readFileSync(TILE);
        assert.deepEqual([head.readUInt16LE(6), head.readUInt16LE(8)], [24, 24]);
    });
});

describe("loading it", () => {
    const src = readFileSync(GAME_JS, "utf8");

    it("is declared, fetched and decoded like the other tiles", () => {
        assert.match(src, /var AP_Marked = new SR_Image;/);
        assert.match(src, /AP_Marked\.IGset\("AP_marked\.gif"\);/);
        assert.match(src, /imgToArray\(AP_Marked\);/);
    });

    it("is drawn in place of the plain logo", () => {
        assert.match(src, /cell_marked\? AP_Marked :\(cell_blocked\? AP_Img_Grey :AP_Img\)/);
    });

    it("dims with the cell when the check is out of logic", () => {
        assert.match(src, /\(cell_marked && cell_blocked\)\? 0xFF606060 :0xFFFFFFFF/);
    });
});

describe("shopCheckIsMarked", () => {
    function load(mod) {
        const src = readFileSync(GAME_JS, "utf8");
        const start = src.indexOf("function shopCheckIsMarked(itemId){");
        const end = src.indexOf("\n}", start) + 2;
        return new Function("window", `${src.slice(start, end)} return shopCheckIsMarked;`)({
            ArchipelagoMod: mod,
        });
    }
    const withHint = (marked) => ({ shopHints: 1, shopHintSpoiler: { 7: { marked } } });

    it("marks a check the seed called important", () => {
        assert.equal(load(withHint(true))(7), true);
    });

    it("leaves an ordinary check alone", () => {
        assert.equal(load(withHint(false))(7), false);
    });

    it("leaves an unscouted cell alone", () => {
        assert.equal(load({ shopHints: 1, shopHintSpoiler: {} })(7), false);
    });

    it("keeps the mystery when Shop Hints are off", () => {
        assert.equal(load({ shopHints: 0, shopHintSpoiler: { 7: { marked: true } } })(7), false);
    });
});

describe("what earns the tile", () => {
    const src = readFileSync(MAIN_JS, "utf8");
    const body = src.slice(src.indexOf("    _hintFor(networkItem) {"));
    const method = body.slice(0, body.search(/\n {4}\}/));

    it("is progression or a trap, whatever game it belongs to", () => {
        assert.match(src, /hint\.marked = \(hint\.itemClassification & 0b101\) !== 0;/);
    });

    it("is read after any disguise, so a disguised trap still matches", () => {
        assert.ok(
            method.indexOf("hint.itemClassification = 0b001;") < method.indexOf("hint.marked ="),
            "the tile is decided before the disguise, so a disguised trap could stand out",
        );
    });

    it("no longer singles out Progressive Shop items", () => {
        assert.doesNotMatch(src, /_isOurProgressiveShopItem/);
    });
});

describe("the classifications that miss out", () => {
    // Useful and filler keep the plain logo: the tile is there to say "this
    // matters", and marking everything would say nothing.
    const marked = (flags) => (flags & 0b101) !== 0;

    it("marks progression", () => assert.equal(marked(0b001), true));
    it("marks traps", () => assert.equal(marked(0b100), true));
    it("marks progression that is also useful", () => assert.equal(marked(0b011), true));
    it("skips useful", () => assert.equal(marked(0b010), false));
    it("skips filler", () => assert.equal(marked(0b000), false));
});
