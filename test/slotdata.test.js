// Recovering Shop Checks on a seed that never shipped the option.
//
// The apworld built the shop locations but left shop_checks out of slot_data,
// so every 1.7.0 and 1.8.0 seed told the client the feature was off. The
// locations still existed, so players saw them in the tracker and released them
// by hand. The client now falls back to the one thing the seed does carry: only
// Shop Checks creates locations in the shop range.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
const SHOP_OFFSET = 20000;

/** Pull a method out of main.js by name, up to its closing brace. */
function methodSource(src, name) {
    const start = src.indexOf(`    ${name}() {`);
    assert.ok(start !== -1, `could not find ${name} in main.js`);
    const rest = src.slice(start);
    const end = rest.search(/\n {4}\}/);
    assert.ok(end !== -1, `could not find the end of ${name}`);
    return rest.slice(0, end + 6);
}

/** The real seedHasShopLocations and adoptCheckedShopLocations, on a stub client. */
function loadDetector(allLocations, checkedLocations = []) {
    const src = readFileSync(MAIN_JS, "utf8");
    const methods = ["seedHasShopLocations", "adoptCheckedShopLocations"].map((n) => methodSource(src, n));
    const host = new Function(`return { SHOP_OFFSET: ${SHOP_OFFSET}, client: null, ${methods.join(",\n")} };`)();
    host.client = allLocations === null ? null : { room: { allLocations, checkedLocations } };
    return host;
}

/** The real resolution expression out of _connect, so `??` cannot quietly become `||`. */
function resolveShopChecks(slotData, allLocations) {
    const src = readFileSync(MAIN_JS, "utf8");
    const line = src.match(/window\.ArchipelagoMod\.shopChecks = (this\.slotData[^;]+);/);
    assert.ok(line, "could not find the shopChecks resolution in main.js");
    const host = loadDetector(allLocations);
    host.slotData = slotData;
    return new Function("host", `return ${line[1].replace(/this\./g, "host.")};`)(host);
}

describe("seedHasShopLocations", () => {
    it("sees a seed built with shop checks", () => {
        assert.equal(loadDetector([10001, 10500, 20003, 20556]).seedHasShopLocations(), true);
    });

    it("is false for a seed with only stage, book and enemy checks", () => {
        assert.equal(loadDetector([10001, 10200, 10538]).seedHasShopLocations(), false);
    });

    it("does not mistake a neighbouring range for the shop", () => {
        assert.equal(loadDetector([19999, 21000, 21500]).seedHasShopLocations(), false);
    });

    it("survives being asked before the room exists", () => {
        assert.equal(loadDetector(null).seedHasShopLocations(), false);
    });
});

describe("resolving shop checks from slot data", () => {
    const withShop = [10001, 20003];
    const withoutShop = [10001];

    it("uses the option when the seed ships it", () => {
        assert.equal(resolveShopChecks({ shop_checks: 1 }, withShop), 1);
    });

    it("respects the option being deliberately off", () => {
        assert.equal(
            resolveShopChecks({ shop_checks: 0 }, withShop),
            0,
            "a seed that says off must stay off even if shop locations exist",
        );
    });

    it("recovers a seed that never shipped the option", () => {
        assert.equal(resolveShopChecks({}, withShop), 1);
    });

    it("stays off for an old seed that genuinely has no shop checks", () => {
        assert.equal(resolveShopChecks({}, withoutShop), 0);
    });
});

describe("adoptCheckedShopLocations", () => {
    function adopt(checked) {
        const host = loadDetector([], checked);
        globalThis.window = { ArchipelagoMod: { shopIdsSent: new Set() } };
        host.adoptCheckedShopLocations();
        return globalThis.window.ArchipelagoMod.shopIdsSent;
    }

    it("marks a shop location the server already has as sent", () => {
        assert.deepEqual([...adopt([20003, 20556])], [3, 556]);
    });

    it("ignores checks outside the shop range", () => {
        assert.deepEqual([...adopt([10001, 10538, 19999, 21000])], []);
    });

    it("keeps a manually released run buyable", () => {
        // The reported case: every shop check released by hand while the client
        // thought the feature was off. Those cells must stop offering a check,
        // or buying would spend gold on a location that is already gone.
        const sent = adopt(Array.from({ length: 462 }, (_, i) => 20003 + i));
        assert.equal(sent.size, 462);
        assert.ok(sent.has(3), "an already-released item would still show the logo");
    });
});
