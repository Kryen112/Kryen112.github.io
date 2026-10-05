// Trap disguises. A trap in a shop or book wears some other item's name with
// its spelling knocked askew, so it reads as real at a glance.
//
// The whole thing is derived from the seed and the location id and nothing is
// stored, so the property that matters most is stability: the same shelf must
// show the same name after a reconnect, a reload, or a second look -- and a
// different seed must not show the same one, or a face could be learned.
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

    it("gives the same location a different face in a different seed", () => {
        const faces = new Set();
        for (const seed of ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e"]) {
            faces.add(disguiseFor(20003, NAMES, seed));
        }
        assert.ok(faces.size > 1, "the face could be learned across seeds");
    });

    it("keeps the face within a seed", () => {
        assert.equal(disguiseFor(20003, NAMES, "seed-a"), disguiseFor(20003, NAMES, "seed-a"));
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
    const slice = (signature) => {
        const body = src.slice(src.indexOf(`    ${signature} {`));
        return body.slice(0, body.search(/\n {4}\}/));
    };
    const hintFor = slice("_hintFor(networkItem)");
    const disguise = slice("_disguise(hint, location)");

    it("only disguises traps", () => {
        assert.match(hintFor, /networkItem\.flags & 0b100/, "the trap flag is not what is tested");
        assert.match(
            hintFor,
            /if \(isTrap && this\.slotData\.trap_disguise\) this\._disguise\(hint, networkItem\.location\);/,
        );
    });

    it("recolours the disguise, or the red name gives it away", () => {
        assert.match(disguise, /hint\.itemClassification = 0b001;/, "a disguised trap still reads as a trap");
    });

    it("falls back to the real name when no disguise could be made", () => {
        assert.match(disguise, /if \(disguise !== null\)/);
    });

    it("is seeded by the room, so a face cannot be learned across games", () => {
        assert.match(disguise, /disguiseFor\(location, this\._decoyNames\(\), this\.client\.room\.seedName\)/);
    });

    it("keeps the base record when the disguise throws", () => {
        // The try sits around the disguise alone, so an undisguised trap is
        // the worst a failure can do -- not a shelf with nothing to say.
        assert.doesNotMatch(hintFor, /try \{/, "the try covers the base record too");
        assert.match(disguise, /catch \(error\) \{\s*\n\s*console\.error\("Could not disguise/);
    });
});

// Records are saved to the server and a scouted cell is never scouted again, so
// a trap recorded while the disguise was broken kept its real name for the rest
// of that seed. On connect, any saved trap record is disguised after the fact.
describe("saved trap records are disguised on connect", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");

    function load({ disguiseOn = 1, shopHints = {}, bookHints = {} } = {}) {
        const methods = ["_redisguiseSavedHints()", "_disguise(hint, location)", "_decoyNames()"].map((sig) => {
            const body = src.slice(src.indexOf(`    ${sig} {`));
            return body.slice(0, body.search(/\n {4}\}/) + 6);
        });
        const host = new Function(
            "disguiseFor",
            `return { SHOP_OFFSET: 20000, BOOK_OFFSET: 10100, TRAPS_OFFSET: 13000, _decoys: undefined, slotData: null, client: null, shopHints: null, bookHints: null, ${methods.join(",\n")} };`,
        )(disguiseFor);
        host.slotData = { trap_disguise: disguiseOn };
        host.shopHints = shopHints;
        host.bookHints = bookHints;
        host.client = {
            room: { games: ["Stick Ranger", "Hollow Knight"], seedName: "seed-a" },
            package: {
                findPackage: (game) =>
                    ({
                        "Stick Ranger": { itemTable: { "Unlock Lake": 11014, "Kill a Ranger": 13002 } },
                        "Hollow Knight": { itemTable: { "Mothwing Cloak": 3 } },
                    })[game] ?? null,
            },
        };
        return host;
    }

    const bareTrap = () => ({
        player: "s",
        item: "Kill a Ranger",
        itemClassification: 0b100,
        sprite: null,
        marked: true,
    });

    it("dresses a saved trap that still wears its real name", () => {
        const host = load({ shopHints: { 270: bareTrap() } });
        host._redisguiseSavedHints();
        const hint = host.shopHints[270];
        assert.notEqual(hint.item, "Kill a Ranger", "the trap kept its real name");
        assert.equal(hint.itemClassification, 0b001);
        assert.equal(hint.marked, true);
    });

    it("gives it the same face a fresh scout would", () => {
        const host = load({ shopHints: { 270: bareTrap() } });
        host._redisguiseSavedHints();
        assert.equal(host.shopHints[270].item, disguiseFor(20270, host._decoyNames(), "seed-a"));
    });

    it("covers book records too", () => {
        const host = load({ bookHints: { 5: bareTrap() } });
        host._redisguiseSavedHints();
        assert.notEqual(host.bookHints[5].item, "Kill a Ranger");
    });

    it("leaves records that are not traps alone", () => {
        const sword = { player: "s", item: "Iron Sword 1", itemClassification: 0b000, sprite: 8, marked: false };
        const host = load({ shopHints: { 8: sword } });
        host._redisguiseSavedHints();
        assert.deepEqual(host.shopHints[8], sword);
    });

    it("leaves an already disguised record alone", () => {
        const dressed = { player: "s", item: "Unlock Laek", itemClassification: 0b001, sprite: null, marked: true };
        const host = load({ shopHints: { 270: dressed } });
        host._redisguiseSavedHints();
        assert.equal(host.shopHints[270].item, "Unlock Laek");
    });

    it("does nothing with Trap Disguise off", () => {
        const host = load({ disguiseOn: 0, shopHints: { 270: bareTrap() } });
        host._redisguiseSavedHints();
        assert.equal(host.shopHints[270].item, "Kill a Ranger");
    });

    it("runs right after the save is loaded", () => {
        assert.match(src, /await this\.loadAPData\(\);\s*\n\s*this\._redisguiseSavedHints\(\);/);
    });
});

// Where the decoy names come from.
//
// Two mistakes about archipelago.js in a row left the pool empty. This first
// asked the data package for the room's game list, which it does not have, and
// threw. Then it asked each PackageMetadata for item_name_to_id, which is the
// raw package's field, not the metadata's: the pool came back empty, no error,
// and every trap stood on the shelf under its own name. The stubs here carry
// the real shape, itemTable, for that reason.
describe("_decoyNames", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");

    function load(room, packages) {
        const body = src.slice(src.indexOf("    _decoyNames() {"));
        const method = body.slice(0, body.search(/\n {4}\}/) + 6);
        const host = new Function(`return { _decoys: undefined, client: null, TRAPS_OFFSET: 13000, ${method} };`)();
        host.client = { room, package: { findPackage: (g) => packages[g] ?? null } };
        return host;
    }

    const PACKAGES = {
        "Stick Ranger": { itemTable: { "Unlock Lake": 1, "Unlock Volcano": 2, "Kill a Ranger": 13002 } },
        "Hollow Knight": { itemTable: { "Mothwing Cloak": 3 } },
    };

    it("reads the game list off the room, not the data package", () => {
        assert.match(src, /this\.client\.room\.games/, "the package has no game list");
        assert.doesNotMatch(src, /this\.client\.package\.games/, "this is undefined and throws");
    });

    it("reads each package's itemTable, which is what findPackage hands back", () => {
        assert.doesNotMatch(
            src,
            /item_name_to_id/,
            "PackageMetadata has no item_name_to_id; the pool comes back empty",
        );
        const archipelago = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "archipelago.js", "dist", "index.d.ts"),
            "utf8",
        );
        assert.match(archipelago, /findPackage\(game: string\): PackageMetadata \| null;/);
        assert.match(archipelago, /readonly itemTable: Readonly<Record<string, number>>;/);
    });

    it("collects names from every game in the room", () => {
        const host = load({ games: ["Stick Ranger", "Hollow Knight"] }, PACKAGES);
        assert.deepEqual(host._decoyNames(), ["Mothwing Cloak", "Unlock Lake", "Unlock Volcano"]);
    });

    it("leaves our own traps out of the pool", () => {
        // A trap wearing a misspelled trap name, coloured as progression,
        // contradicts itself.
        const host = load({ games: ["Stick Ranger"] }, PACKAGES);
        assert.ok(!host._decoyNames().includes("Kill a Ranger"), "a trap can wear another trap's name");
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
