// Enforce Shop Logic: the shop's half of Enforce Logic.
//
// The shop stocks by Progressive items, but Archipelago also wants the world
// open far enough before it counts on a deep row. With the option off those two
// simply disagree and the sale goes through; with it on the row is greyed out
// and cannot be bought.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");

// Stand-ins for the gate evaluator, so these tests are about the shop rule only.
function loadShopLogic(openGatesResult) {
    const src = readFileSync(GAME_JS, "utf8");
    const start = src.indexOf("function shopTierInLogic(tier){");
    const end = src.indexOf("\n}", src.indexOf("function shopCellBlocked")) + 2;
    assert.ok(start !== -1 && end > start, "could not find the shop logic helpers");

    const mod = { enforceShopLogic: 0 };
    const api = new Function(
        "window",
        "logicDescription",
        "openGates",
        "shopTier",
        "Shop_Items",
        `${src.slice(start, end)}
         return { shopTierInLogic, shopCellBlocked };`,
    )(
        { ArchipelagoMod: mod },
        () => loadShopLogic.logic,
        () => openGatesResult,
        (row, len) => Math.floor((row * 33) / len),
        [[Array.from({ length: 33 }, (_, i) => 100 + i)]],
    );
    return { mod, ...api };
}

// tier 9+ -> Castle (10), 14+ -> Submarine Shrine (29), 18+ -> Pyramid (42),
// 23+ -> Ice Castle (63), highest threshold first.
const SHOP_GATES = [
    [23, 63],
    [18, 42],
    [14, 29],
    [9, 10],
];

describe("shopTierInLogic", () => {
    beforeEach(() => {
        loadShopLogic.logic = { shop_gates: SHOP_GATES };
    });

    it("lets the opening rows through with nothing open", () => {
        const { shopTierInLogic } = loadShopLogic({});
        for (const tier of [0, 4, 8]) assert.equal(shopTierInLogic(tier), true, `tier ${tier}`);
    });

    it("holds tier 9 until Castle", () => {
        assert.equal(loadShopLogic({}).shopTierInLogic(9), false);
        assert.equal(loadShopLogic({ 10: true }).shopTierInLogic(9), true);
    });

    it("picks the deepest matching gate, not the first threshold passed", () => {
        // Castle open but nothing else: a tier 23 row still waits for Ice Castle.
        const open = { 10: true, 29: true, 42: true };
        assert.equal(loadShopLogic(open).shopTierInLogic(22), true, "tier 22 needs Pyramid");
        assert.equal(loadShopLogic(open).shopTierInLogic(23), false, "tier 23 needs Ice Castle");
        assert.equal(loadShopLogic({ ...open, 63: true }).shopTierInLogic(23), true);
    });

    it("maps every threshold to its own gate", () => {
        for (const [threshold, stage] of SHOP_GATES) {
            assert.equal(loadShopLogic({}).shopTierInLogic(threshold), false, `tier ${threshold}`);
            const open = Object.fromEntries(SHOP_GATES.map(([, s]) => [s, true]));
            assert.equal(loadShopLogic(open).shopTierInLogic(threshold), true, `stage ${stage}`);
        }
    });

    it("allows everything on a seed that ships no shop gates", () => {
        loadShopLogic.logic = { gates: [] };
        const { shopTierInLogic } = loadShopLogic({});
        for (const tier of [0, 9, 32]) assert.equal(shopTierInLogic(tier), true);
    });
});

describe("shopCellBlocked", () => {
    beforeEach(() => {
        loadShopLogic.logic = { shop_gates: SHOP_GATES };
    });

    it("blocks nothing while the option is off", () => {
        const api = loadShopLogic({});
        api.mod.enforceShopLogic = 0;
        assert.equal(api.shopCellBlocked(0, 0, 32), false, "a sale was refused with the option off");
    });

    it("blocks an out-of-logic row with the option on", () => {
        const api = loadShopLogic({});
        api.mod.enforceShopLogic = 1;
        assert.equal(api.shopCellBlocked(0, 0, 32), true);
    });

    it("leaves the opening rows buyable with the option on", () => {
        const api = loadShopLogic({});
        api.mod.enforceShopLogic = 1;
        assert.equal(api.shopCellBlocked(0, 0, 0), false);
    });

    it("unblocks once the gate opens", () => {
        const api = loadShopLogic({ 10: true, 29: true, 42: true, 63: true });
        api.mod.enforceShopLogic = 1;
        assert.equal(api.shopCellBlocked(0, 0, 32), false);
    });
});

describe("the buy path honours it", () => {
    const src = readFileSync(GAME_JS, "utf8");

    it("refuses the purchase when blocked", () => {
        assert.match(src, /Team_Gold>=buy_price && Clicked && !shop_blocked/);
    });

    it("says why instead of showing a price", () => {
        assert.match(src, /shop_blocked\)\s*\n\s*centeredText\([^)]*"Out of logic"/);
    });

    it("greys the icon rather than hiding it", () => {
        assert.match(src, /cell_blocked\? AP_Img_Grey :AP_Img/);
        assert.match(src, /cell_blocked\? 0xFF606060 :getVal\(cell_sprite,Item_Color\)/);
    });
});
