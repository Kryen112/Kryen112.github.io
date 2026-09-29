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
        assert.match(method, /if \(isTrap && this\.slotData\.trap_disguise\)/);
    });

    it("recolours the disguise, or the red name gives it away", () => {
        assert.match(method, /hint\.itemClassification = 0b001;/, "a disguised trap still reads as a trap");
    });

    it("falls back to the real name when no disguise could be made", () => {
        assert.match(method, /if \(disguise !== null\)/);
    });
});

// Where the decoy names come from.
//
// This asked the data package for the room's game list, which it does not have:
// client.package.games is undefined, so the loop threw. The throw happened
// inside the locationInfo handler, so the trap went undisguised AND every
// location after it in that packet lost its hint text too.
describe("_decoyNames", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");

    function load(room, packages) {
        const body = src.slice(src.indexOf("    _decoyNames() {"));
        const method = body.slice(0, body.search(/\n {4}\}/) + 6);
        const host = new Function(`return { _decoys: undefined, client: null, ${method} };`)();
        host.client = { room, package: { findPackage: (g) => packages[g] ?? null } };
        return host;
    }

    const PACKAGES = {
        "Stick Ranger": { item_name_to_id: { "Unlock Lake": 1, "Unlock Volcano": 2 } },
        "Hollow Knight": { item_name_to_id: { "Mothwing Cloak": 3 } },
    };

    it("reads the game list off the room, not the data package", () => {
        assert.match(src, /this\.client\.room\.games/, "the package has no game list");
        assert.doesNotMatch(src, /this\.client\.package\.games/, "this is undefined and throws");
    });

    it("collects names from every game in the room", () => {
        const host = load({ games: ["Stick Ranger", "Hollow Knight"] }, PACKAGES);
        assert.deepEqual(host._decoyNames(), ["Mothwing Cloak", "Unlock Lake", "Unlock Volcano"]);
    });

    it("survives a room that has not told us its games yet", () => {
        const host = load({}, PACKAGES);
        assert.deepEqual(host._decoyNames(), [], "an empty list must not throw");
    });

    it("survives a game with no package", () => {
        const host = load({ games: ["Some Game"] }, {});
        assert.deepEqual(host._decoyNames(), []);
    });

    it("does not cache an empty result", () => {
        // An empty array is truthy, so caching one before the data package
        // arrived would leave every trap undisguised for the whole session.
        const host = load({ games: [] }, PACKAGES);
        assert.deepEqual(host._decoyNames(), []);
        host.client.room = { games: ["Stick Ranger"] };
        assert.deepEqual(host._decoyNames(), ["Unlock Lake", "Unlock Volcano"]);
    });

    it("caches once it has something", () => {
        const host = load({ games: ["Stick Ranger"] }, PACKAGES);
        const first = host._decoyNames();
        host.client.room = { games: ["Hollow Knight"] };
        assert.equal(host._decoyNames(), first, "it rebuilt the list unnecessarily");
    });
});

describe("one bad hint does not cost the others", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");

    it("builds each hint inside its own try", () => {
        const handler = src.slice(src.indexOf('socket.on("locationInfo"'));
        const body = handler.slice(0, handler.indexOf("});\n\n"));
        assert.match(body, /try \{/, "a single throw still empties the rest of the packet");
        assert.match(body, /catch \(error\)/);
    });
});
