// Trap disguises. A trap in a shop or book wears some other item's name with
// its spelling knocked askew, so it reads as real at a glance.
//
// The whole thing is derived from the location id and nothing is stored, so the
// property that matters most is stability: the same shelf must show the same
// name after a reconnect, a reload, or a second look.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { disguiseFor, hashString, misspell, seededRandom } from "../src/disguise.js";

const NAMES = [
    "Unlock Lake",
    "Unlock Grassland 1",
    "Progressive Island Shop",
    "Unlock Sniper Class",
    "Mothwing Cloak",
    "Progressive Sword",
    "Unlock Volcano",
    "Unlock Hell Castle",
    "Unlock Ice Castle",
];

describe("disguiseFor", () => {
    it("gives a location the same face every time", () => {
        for (const location of [20003, 10101, 20556]) {
            const first = disguiseFor(location, NAMES);
            assert.equal(first, disguiseFor(location, NAMES), `location ${location} drifted`);
        }
    });

    it("does not give every location the same face", () => {
        const seen = new Set();
        for (let location = 20003; location < 20103; location++) seen.add(disguiseFor(location, NAMES));
        assert.ok(seen.size > 20, `only ${seen.size} distinct disguises across 100 locations`);
    });

    it("never hands back a name spelled correctly", () => {
        const real = new Set(NAMES);
        for (let location = 20003; location < 20203; location++) {
            const disguise = disguiseFor(location, NAMES);
            assert.ok(!real.has(disguise), `${disguise} is a real item name`);
        }
    });

    it("keeps the real name when there is nothing to hide behind", () => {
        assert.equal(disguiseFor(20003, []), null);
        assert.equal(disguiseFor(20003, null), null);
    });

    it("still reads as an item name", () => {
        for (let location = 20003; location < 20103; location++) {
            const disguise = disguiseFor(location, NAMES);
            assert.match(disguise, /^[A-Za-z0-9 ]+$/, `${disguise} does not read as a name`);
            assert.ok(disguise.length > 3, `${disguise} is too short to pass`);
        }
    });
});

describe("misspell", () => {
    const rng = () => seededRandom(hashString("fixed"))();

    it("leaves numbers alone, so shelves stay distinguishable", () => {
        for (let seed = 0; seed < 50; seed++) {
            const out = misspell("Unlock Grassland 1", seededRandom(seed));
            assert.match(out, / 1$/, `${out} lost its number`);
        }
    });

    it("keeps the leading word when there is another to bend", () => {
        // "Unlock" and "Progressive" open half the item list; bending those is
        // what gives a disguise away.
        let kept = 0;
        for (let seed = 0; seed < 50; seed++) {
            if (misspell("Unlock Volcano", seededRandom(seed)).startsWith("Unlock ")) kept++;
        }
        assert.equal(kept, 50, "the common prefix was mangled");
    });

    it("bends a single word rather than giving up", () => {
        const out = misspell("Volcano", seededRandom(7));
        assert.notEqual(out, "Volcano");
    });

    it("never triples a letter", () => {
        for (let seed = 0; seed < 200; seed++) {
            const out = misspell("Unlock Hell Castle", seededRandom(seed));
            assert.doesNotMatch(out, /(.)\1\1/i, `${out} triples a letter`);
        }
    });

    it("never doubles the first letter of a word", () => {
        for (let seed = 0; seed < 200; seed++) {
            const out = misspell("Progressive Town Shop", seededRandom(seed));
            assert.doesNotMatch(out, /(^|\s)(.)\2/i, `${out} doubles a word's first letter`);
        }
    });

    it("returns names with no wordy part untouched", () => {
        assert.equal(misspell("42", rng), "42");
        assert.equal(misspell("", rng), "");
    });
});

describe("the hint record", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");
    const body = src.slice(src.indexOf("    _hintFor(networkItem) {"));
    const method = body.slice(0, body.search(/\n {4}\}/));

    it("only disguises traps", () => {
        assert.match(method, /networkItem\.flags & 0b100/, "the trap flag is not what is tested");
        assert.match(method, /if \(!isTrap \|\| !this\.slotData\.trap_disguise\) return hint;/);
    });

    it("recolours the disguise, or the red name gives it away", () => {
        assert.match(method, /itemClassification: 0b001/, "a disguised trap still reads as a trap");
    });

    it("falls back to the real name when no disguise could be made", () => {
        assert.match(method, /if \(disguise === null\) return hint;/);
    });
});
