// What an option means once the others are taken into account.
//
// Progressive Shop and Enforce Shop Logic only mean something with Shop Checks,
// and Gold per Thrown Ring is Ring Link's payout. Current seeds ship those
// zeroed already; the client applies the same rule so an older seed cannot gate
// a shop that holds no checks, or pay out rings that go nowhere.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveEnforceShopLogic, resolveProgressiveShop, resolveRingGold } from "../src/options.js";

const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");

describe("the shop options need Shop Checks", () => {
    it("Progressive Shop is read when the shop holds checks", () => {
        assert.equal(resolveProgressiveShop({ progressive_shop: 1 }, 1), 1);
        assert.equal(resolveProgressiveShop({ progressive_shop: 0 }, 1), 0);
    });

    it("Progressive Shop is nothing without them", () => {
        assert.equal(resolveProgressiveShop({ progressive_shop: 1 }, 0), 0, "a shop with no checks was gated");
    });

    it("Enforce Shop Logic follows the same rule", () => {
        assert.equal(resolveEnforceShopLogic({ enforce_shop_logic: 1 }, 1), 1);
        assert.equal(resolveEnforceShopLogic({ enforce_shop_logic: 1 }, 0), 0, "a shop with no checks was greyed");
    });

    it("a missing key is off", () => {
        assert.equal(resolveProgressiveShop({}, 1), 0);
        assert.equal(resolveEnforceShopLogic({}, 1), 0);
    });
});

describe("Gold per Thrown Ring needs Ring Link", () => {
    it("pays out with Ring Link on", () => {
        assert.equal(resolveRingGold({ ring_link: 1, ring_gold: 50 }), 50);
    });

    it("pays nothing with Ring Link off", () => {
        assert.equal(resolveRingGold({ ring_link: 0, ring_gold: 50 }), 0, "a gold faucet with nowhere to send it");
        assert.equal(resolveRingGold({ ring_gold: 50 }), 0);
    });
});

describe("_connect reads them through the resolvers", () => {
    const src = readFileSync(MAIN_JS, "utf8");

    it("resolves the shop options after Shop Checks is known", () => {
        const checks = src.indexOf("window.ArchipelagoMod.shopChecks = resolveShopChecks(");
        const progressive = src.indexOf("window.ArchipelagoMod.progressiveShop = resolveProgressiveShop(");
        const enforce = src.indexOf("window.ArchipelagoMod.enforceShopLogic = resolveEnforceShopLogic(");
        assert.ok(
            checks !== -1 && progressive > checks && enforce > checks,
            "a shop option is resolved before Shop Checks is",
        );
    });

    it("resolves the ring payout", () => {
        assert.match(src, /window\.ArchipelagoMod\.ringGold = resolveRingGold\(this\.slotData\);/);
    });
});
