// The shop-check state machine and the Progressive Shop stock gate, lifted out
// of public/game.js. Both are easy to get subtly wrong: the tier has to be
// normalised because shop columns are not all the same depth, and a cell has to
// go back to showing the Archipelago logo if the purchase was never collected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";

const GAME_JS = "C:/Users/kryen/Documents/Archipelago-play/Kryen112.github.io/public/game.js";

function loadShopHelpers(shopItems) {
    const src = readFileSync(GAME_JS, "utf8");
    const start = src.indexOf("const SHOP_TIERS = 33;");
    const end = src.indexOf("window.ArchipelagoMod.shopStockedItemIds = shopStockedItemIds;");
    assert.ok(start !== -1 && end > start, "could not find the shop helpers in game.js");

    const fakeWindow = { ArchipelagoMod: {} };
    const build = new Function(
        "window",
        "Shop_Items",
        "Stage_Status",
        "Shop_Reqs",
        "Stage_Count",
        `${src.slice(start, end)}
         return { shopTier, shopItemIsCheck, shopCellUnlocked, shopTownIndex, shopStockedItemIds };`,
    );
    const api = build(fakeWindow, shopItems, [3, 1], [1, 1], 2);
    return { mod: fakeWindow.ArchipelagoMod, ...api };
}

// Town column of 33 (like the real Town) and one of 78 (like Island).
const SHOP = [[Array.from({ length: 33 }, (_, i) => 100 + i)], [Array.from({ length: 78 }, (_, i) => 200 + i)]];

describe("shopTier", () => {
    const { shopTier } = loadShopHelpers(SHOP);

    it("is the row itself for a 33-deep column", () => {
        for (const row of [0, 1, 16, 32]) assert.equal(shopTier(row, 33), row);
    });

    it("normalises deeper columns onto the same 0..32 scale", () => {
        assert.equal(shopTier(0, 78), 0);
        assert.equal(shopTier(77, 78), 32);
    });

    it("never exceeds 32, so 32 items always open a column fully", () => {
        for (const depth of [9, 15, 33, 48, 78]) {
            assert.equal(shopTier(depth - 1, depth), Math.floor(((depth - 1) * 33) / depth));
            assert.ok(shopTier(depth - 1, depth) <= 32, `depth ${depth} exceeds the scale`);
        }
    });
});

describe("shopCellUnlocked", () => {
    let api;
    beforeEach(() => {
        api = loadShopHelpers(SHOP);
    });

    it("uses stage progress when Progressive Shop is off", () => {
        api.mod.progressiveShop = 0;
        assert.equal(api.shopCellUnlocked(0, 0, 0, 1), true);
        assert.equal(api.shopCellUnlocked(0, 0, 5, 1), false);
        // The vanilla gate only ever applied to the first Town.
        assert.equal(api.shopCellUnlocked(1, 0, 70, 1), true);
    });

    it("gates every town once Progressive Shop is on", () => {
        api.mod.progressiveShop = 1;
        api.mod.progressiveShopItems = 0;
        assert.equal(api.shopCellUnlocked(1, 0, 70, 1), false, "Island should be gated too");
    });

    it("opens the deepest column fully at 32 items", () => {
        api.mod.progressiveShop = 1;
        api.mod.progressiveShopItems = 32;
        const level = 1 + 32;
        for (const row of [0, 40, 77]) {
            assert.equal(api.shopCellUnlocked(1, 0, row, level), true, `row ${row} still locked`);
        }
    });
});

describe("shopItemIsCheck", () => {
    let api;
    beforeEach(() => {
        api = loadShopHelpers(SHOP);
        api.mod.shopChecks = 1;
        api.mod.shopIdsSent = new Set();
        api.mod.shopBoughtThisVisit = new Set();
    });

    it("is false when the option is off", () => {
        api.mod.shopChecks = 0;
        assert.equal(api.shopItemIsCheck(100), false);
    });

    it("is true for an item whose check has not been sent", () => {
        assert.equal(api.shopItemIsCheck(100), true);
    });

    it("stops being a check once bought, before the drop is collected", () => {
        api.mod.shopBoughtThisVisit.add(100);
        assert.equal(api.shopItemIsCheck(100), false);
    });

    it("goes back to being a check if the visit ends uncollected", () => {
        api.mod.shopBoughtThisVisit.add(100);
        api.mod.shopBoughtThisVisit.clear(); // what entering a town does
        assert.equal(api.shopItemIsCheck(100), true);
    });

    it("stays bought once the check has actually been sent", () => {
        api.mod.shopIdsSent.add(100);
        api.mod.shopBoughtThisVisit.clear();
        assert.equal(api.shopItemIsCheck(100), false);
    });

    it("ignores empty cells", () => {
        assert.equal(api.shopItemIsCheck(0), false);
    });
});

describe("shopTownIndex", () => {
    const { shopTownIndex } = loadShopHelpers(SHOP);

    it("maps the four shop towns", () => {
        assert.deepEqual([0, 20, 47, 77].map(shopTownIndex), [0, 1, 2, 3]);
    });

    it("rejects the Forget Tree and ordinary stages", () => {
        assert.equal(shopTownIndex(70), -1); // Forget Tree has no shop
        assert.equal(shopTownIndex(5), -1);
    });
});
