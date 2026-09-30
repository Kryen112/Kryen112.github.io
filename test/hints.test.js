// Shop Hints on "important only": what the room is told, not what you see.
//
// An item's classification is unknown until it has been scouted, so the filter
// has to look first without creating hints (create_as_hint 0) and then scout the
// progression and trap ones again to make them. Our own display is filled by the
// locationInfo handler either way, so the player still sees everything.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SHOP_HINTS_ALL, SHOP_HINTS_IMPORTANT_ONLY, resolveShopHints } from "../src/options.js";

const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");

/** The real _scoutAndHint, on a client that records what it was asked to scout. */
function loadScout({ mode, disguise = 0 }, catalogue = {}) {
    const src = readFileSync(MAIN_JS, "utf8");
    const start = src.indexOf("    async _scoutAndHint(locations) {");
    assert.ok(start !== -1, "could not find _scoutAndHint in main.js");
    const rest = src.slice(start);
    const body = rest.slice(0, rest.search(/\n {4}\}/) + 6);
    const worthStart = src.indexOf("    _worthHinting(item) {");
    assert.ok(worthStart !== -1, "could not find _worthHinting in main.js");
    const worthRest = src.slice(worthStart);
    const worth = worthRest.slice(0, worthRest.search(/\n {4}\}/) + 6);

    const calls = [];
    const host = new Function(
        "SHOP_HINTS_ALL",
        `return { slotData: null, client: null, shopHintsMode: null, ${body}, ${worth} };`,
    )(SHOP_HINTS_ALL);
    host.shopHintsMode = mode;
    host.slotData = { trap_disguise: disguise };
    host.client = {
        async scout(locations, createHint) {
            calls.push({ locations: [...locations], createHint });
            return locations.map((locationId) => ({
                locationId,
                progression: !!catalogue[locationId]?.progression,
                trap: !!catalogue[locationId]?.trap,
            }));
        },
    };
    return { host, calls };
}

// 100 progression, 101 trap, 102 useful, 103 filler
const CATALOGUE = { 100: { progression: true }, 101: { trap: true }, 102: {}, 103: {} };
const ALL = [100, 101, 102, 103];

describe("hinting all", () => {
    it("hints everything in one pass, as before", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_ALL }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.deepEqual(calls, [{ locations: ALL, createHint: 2 }]);
    });
});

describe("hinting important only", () => {
    it("looks without telling the room, then hints only what matters", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_IMPORTANT_ONLY }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.equal(calls.length, 2, "expected a silent look then a hinting pass");
        assert.deepEqual(calls[0], { locations: ALL, createHint: 0 }, "the first pass must not hint");
        assert.deepEqual(calls[1], { locations: [100, 101], createHint: 2 }, "useful/filler leaked");
    });

    it("still scouts the filler, so the player sees it locally", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_IMPORTANT_ONLY }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.deepEqual(calls[0].locations, ALL, "the player would stop seeing filler items");
    });

    it("says nothing at all when nothing is worth hinting", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_IMPORTANT_ONLY }, { 102: {}, 103: {} });
        await host._scoutAndHint([102, 103]);
        assert.equal(calls.length, 1, "a hinting pass ran with nothing to hint");
        assert.equal(calls[0].createHint, 0);
    });

    it("hints a trap the same as progression", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_IMPORTANT_ONLY }, { 101: { trap: true } });
        await host._scoutAndHint([101]);
        assert.deepEqual(calls[1].locations, [101]);
    });
});

// A disguised trap must never be hinted: the hint would carry its real name
// into the room feed and this client's own log, which undoes the disguise.
describe("with Trap Disguise on", () => {
    it("hints everything but the traps when hinting all", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_ALL, disguise: 1 }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.equal(calls.length, 2, "hinting all in one pass would name the trap");
        assert.deepEqual(calls[0], { locations: ALL, createHint: 0 });
        assert.deepEqual(calls[1], { locations: [100, 102, 103], createHint: 2 }, "the trap was hinted");
    });

    it("hints only progression when important only", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_IMPORTANT_ONLY, disguise: 1 }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.deepEqual(calls[1], { locations: [100], createHint: 2 });
    });

    it("says nothing when only traps were scouted", async () => {
        const { host, calls } = loadScout({ mode: SHOP_HINTS_ALL, disguise: 1 }, { 101: { trap: true } });
        await host._scoutAndHint([101]);
        assert.equal(calls.length, 1);
    });
});

describe("either way", () => {
    for (const mode of [SHOP_HINTS_ALL, SHOP_HINTS_IMPORTANT_ONLY]) {
        it(`does not touch the network for an empty list (mode ${mode})`, async () => {
            const { host, calls } = loadScout({ mode }, CATALOGUE);
            await host._scoutAndHint([]);
            assert.deepEqual(calls, []);
        });
    }
});

// Shop Hints is one choice now: off, important only, all. Seeds from before
// 1.8.12 carry the old toggle pair instead, and a 1 there means "on".
describe("resolveShopHints", () => {
    it("reads the choice off a current seed", () => {
        for (const value of [0, 1, 2]) {
            assert.equal(resolveShopHints({ world_version: "1.8.12", shop_hints: value }), value);
        }
    });

    it("defaults a current seed to all", () => {
        assert.equal(resolveShopHints({ world_version: "1.8.12" }), SHOP_HINTS_ALL);
    });

    it("reads the old toggle pair off a legacy seed", () => {
        assert.equal(resolveShopHints({ shop_hints: 1 }), SHOP_HINTS_ALL, "a legacy 1 is on, not important only");
        assert.equal(resolveShopHints({ shop_hints: 1, important_hints_only: 1 }), SHOP_HINTS_IMPORTANT_ONLY);
        assert.equal(resolveShopHints({ shop_hints: 0, important_hints_only: 1 }), 0);
        assert.equal(resolveShopHints({}), 0, "a legacy seed with no key used to mean off");
    });
});
