// Recovering Shop Checks on a seed that never shipped the option.
//
// The apworld built the shop locations but left shop_checks out of slot_data,
// so every 1.7.0 and 1.8.0 seed told the client the feature was off. The
// locations still existed, so players saw them in the tracker and released them
// by hand. The client now falls back to the one thing the seed does carry: only
// Shop Checks creates locations in the shop range.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveShopChecks as resolve } from "../src/options.js";
import { SLOT_DATA_OPTIONS, missingSlotDataKeys } from "../src/slotdata.js";

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

/** The resolver _connect uses, on the real location detector. */
function resolveShopChecks(slotData, allLocations) {
    const host = loadDetector(allLocations);
    return resolve(slotData, () => host.seedHasShopLocations());
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

    it("does not guess for a seed that says which apworld made it", () => {
        // A modern seed always ships the key; a missing one is a bug to
        // report, not a case to paper over.
        assert.equal(resolveShopChecks({ world_version: "1.8.12" }, withShop), 0);
    });

    it("is what _connect uses", () => {
        const src = readFileSync(MAIN_JS, "utf8");
        assert.match(src, /window\.ArchipelagoMod\.shopChecks = resolveShopChecks\(this\.slotData/);
    });
});

// The list of options the apworld ships. Both repos keep one, and this pins
// ours against the apworld's whenever that checkout sits beside this one.
describe("the slot data option list", () => {
    it("has no duplicates", () => {
        assert.equal(new Set(SLOT_DATA_OPTIONS).size, SLOT_DATA_OPTIONS.length);
    });

    it("reports what a seed is missing", () => {
        const seed = Object.fromEntries(SLOT_DATA_OPTIONS.map((k) => [k, 0]));
        assert.deepEqual(missingSlotDataKeys(seed), []);
        delete seed.shop_checks;
        assert.deepEqual(missingSlotDataKeys(seed), ["shop_checks"]);
        assert.deepEqual(missingSlotDataKeys(null), SLOT_DATA_OPTIONS);
    });

    it("matches the apworld's when it is checked out", (t) => {
        const constants = join(
            dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "AP_Stick_Ranger",
            "stick_ranger",
            "constants.py",
        );
        if (!existsSync(constants)) return t.skip("no AP_Stick_Ranger checkout beside this repo");
        const py = readFileSync(constants, "utf8");
        const block = (name) => {
            const start = py.indexOf(name);
            assert.ok(start !== -1, `${name} not found in constants.py`);
            return py.slice(
                start,
                py.indexOf("\n)", start) === -1
                    ? undefined
                    : py.indexOf("\n]", start) === -1
                      ? py.indexOf("\n)", start)
                      : Math.min(...[py.indexOf("\n)", start), py.indexOf("\n]", start)].filter((i) => i !== -1)),
            );
        };
        const strings = (text) => [...text.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
        const classes = strings(block("CLASS_REQ_OPTIONS: list[str] = ["));
        const stages = strings(block("STAGE_SETTINGS: list[tuple[str, str, str, str]] = [")).filter((s) =>
            s.startsWith("stages_req_for_"),
        );
        const listed = block("SLOT_DATA_OPTIONS: tuple[str, ...] = (");
        const expected = [];
        for (const line of listed.split("\n").slice(1)) {
            if (line.includes("*CLASS_REQ_OPTIONS")) expected.push(...classes);
            else if (line.includes("STAGE_SETTINGS")) expected.push(...stages);
            else expected.push(...strings(line));
        }
        assert.deepEqual(SLOT_DATA_OPTIONS, expected, "the two repos disagree on what slot_data carries");
    });

    it("is checked at connect for a seed that says its version", () => {
        const src = readFileSync(MAIN_JS, "utf8");
        assert.match(src, /if \(!legacy\) \{\s*\n\s*for \(const key of missingSlotDataKeys\(this\.slotData\)\)/);
    });
});

// Half this project's confusing bug reports have been "is the option reaching
// the client?", and the answer has never been readable without a code change.
describe("the slot data is readable from the console", () => {
    const src = readFileSync(MAIN_JS, "utf8");

    it("is handed over whole, as a frozen copy", () => {
        // A live reference would let a poke from the console change the
        // client's behaviour mid-session.
        assert.match(src, /window\.ArchipelagoMod\.slotData = Object\.freeze\(\{ \.\.\.this\.slotData \}\);/);
    });

    it("is not defaulted, so a missing option stays missing", () => {
        // `?? {}` would hide the difference between "off" and "not in the seed",
        // which is the distinction worth reading.
        assert.doesNotMatch(src, /window\.ArchipelagoMod\.slotData = [^;]*\?\?/);
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

    it("runs again whenever the room reports new checks, not only at connect", () => {
        // A second client on this slot, or a !collect, checks shop locations
        // mid-session; the cell would otherwise keep its logo until a reconnect.
        const src = readFileSync(MAIN_JS, "utf8");
        assert.match(src, /this\.client\.room\.on\("locationsChecked", \(\) => this\.adoptCheckedShopLocations\(\)\)/);
    });
});
