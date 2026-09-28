// Important Hints Only: what the room is told, not what you see.
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

const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");

/** The real _scoutAndHint, on a client that records what it was asked to scout. */
function loadScout(slotData, catalogue = {}) {
    const src = readFileSync(MAIN_JS, "utf8");
    const start = src.indexOf("    async _scoutAndHint(locations) {");
    assert.ok(start !== -1, "could not find _scoutAndHint in main.js");
    const rest = src.slice(start);
    const body = rest.slice(0, rest.search(/\n {4}\}/) + 6);

    const calls = [];
    const host = new Function(`return { slotData: null, client: null, ${body} };`)();
    host.slotData = slotData;
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

describe("with the option off", () => {
    it("hints everything in one pass, as before", async () => {
        const { host, calls } = loadScout({ important_hints_only: 0 }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.deepEqual(calls, [{ locations: ALL, createHint: 2 }]);
    });
});

describe("with the option on", () => {
    it("looks without telling the room, then hints only what matters", async () => {
        const { host, calls } = loadScout({ important_hints_only: 1 }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.equal(calls.length, 2, "expected a silent look then a hinting pass");
        assert.deepEqual(calls[0], { locations: ALL, createHint: 0 }, "the first pass must not hint");
        assert.deepEqual(calls[1], { locations: [100, 101], createHint: 2 }, "useful/filler leaked");
    });

    it("still scouts the filler, so the player sees it locally", async () => {
        const { host, calls } = loadScout({ important_hints_only: 1 }, CATALOGUE);
        await host._scoutAndHint(ALL);
        assert.deepEqual(calls[0].locations, ALL, "the player would stop seeing filler items");
    });

    it("says nothing at all when nothing is worth hinting", async () => {
        const { host, calls } = loadScout({ important_hints_only: 1 }, { 102: {}, 103: {} });
        await host._scoutAndHint([102, 103]);
        assert.equal(calls.length, 1, "a hinting pass ran with nothing to hint");
        assert.equal(calls[0].createHint, 0);
    });

    it("hints a trap the same as progression", async () => {
        const { host, calls } = loadScout({ important_hints_only: 1 }, { 101: { trap: true } });
        await host._scoutAndHint([101]);
        assert.deepEqual(calls[1].locations, [101]);
    });
});

describe("either way", () => {
    for (const important of [0, 1]) {
        it(`does not touch the network for an empty list (option ${important})`, async () => {
            const { host, calls } = loadScout({ important_hints_only: important }, CATALOGUE);
            await host._scoutAndHint([]);
            assert.deepEqual(calls, []);
        });
    }
});
