// The apworld's shop table against the client's Shop_Items.
//
// shop.py lists each item once, at the most accessible town and lowest row it
// occupies; the client's Enforce Shop Logic gates every cell. A cell may sit at
// a stricter gate than the listing -- buying it from a stricter cell is never
// required -- but never a looser one, or the shop would sell a check logic does
// not consider reachable. None of this is visible from either repo alone, so
// this runs only when the apworld is checked out beside this one.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
    TOWNS,
    parseProgression,
    parseShopPy,
    readShopItems,
    readShopReqs,
    renderShopReqs,
    renderShopTable,
    shopTable,
    shopTier,
} from "../scripts/shoptable.js";

const here = dirname(fileURLToPath(import.meta.url));
const GAME_JS = join(here, "..", "public", "game.js");
const APWORLD = join(here, "..", "..", "AP_Stick_Ranger", "stick_ranger");
const SHOP_PY = join(APWORLD, "shop.py");
const ITEMS_PY = join(APWORLD, "items.py");

// Tier thresholds behind which a boss gate sits, as SHOP_TIER_GATES lists them.
const GATE_THRESHOLDS = [9, 14, 18, 23];
const gateRank = (tier) => GATE_THRESHOLDS.filter((t) => tier >= t).length;

describe("the client's own tables", () => {
    const src = readFileSync(GAME_JS, "utf8");

    it("stock 462 distinct items across four towns", () => {
        const shopItems = readShopItems(src);
        assert.equal(shopItems.length, TOWNS.length);
        const ids = new Set(shopItems.flat(2).filter(Boolean));
        assert.equal(ids.size, 462);
    });

    it("have one Shop_Reqs entry per stage", () => {
        assert.equal(readShopReqs(src).length, 90);
    });
});

describe("shop.py against Shop_Items", () => {
    if (!existsSync(SHOP_PY)) {
        it.skip("no AP_Stick_Ranger checkout beside this repo", () => {});
        return;
    }
    const src = readFileSync(GAME_JS, "utf8");
    const listed = parseShopPy(readFileSync(SHOP_PY, "utf8"));
    const progression = parseProgression(readFileSync(ITEMS_PY, "utf8"));
    const derived = shopTable(src, progression);
    const shopItems = readShopItems(src);

    it("lists every stocked item once, and nothing else", () => {
        assert.deepEqual(
            [...listed.keys()].sort((a, b) => a - b),
            [...derived.keys()],
        );
    });

    it("lists each item at the most accessible town and lowest row, with that row's cost", () => {
        for (const [id, entry] of derived) {
            const { region, tier, req } = listed.get(id);
            assert.deepEqual([region, tier, req], [entry.region, entry.tier, entry.req], `location ${id}`);
        }
    });

    it("names each check as the generator would", () => {
        for (const [id, entry] of derived) {
            assert.equal(listed.get(id).name, entry.name, `location ${id}`);
        }
    });

    it("is what the generator would write", () => {
        // The generator splices the table body and SHOP_REQS into shop.py and
        // leaves the rest; if this fails, run scripts/generate_shop_table.js.
        const shopPy = readFileSync(SHOP_PY, "utf8");
        const body = shopPy.slice(
            shopPy.indexOf("shop_table: dict[int, ShopLocationDict] = {\n") +
                "shop_table: dict[int, ShopLocationDict] = {\n".length,
            shopPy.indexOf("\n}", shopPy.indexOf("shop_table: dict[int, ShopLocationDict] = {\n")),
        );
        assert.equal(body, renderShopTable(derived));
        const reqs = shopPy.slice(
            shopPy.indexOf("SHOP_REQS: tuple[int, ...] = (\n") + "SHOP_REQS: tuple[int, ...] = (\n".length,
            shopPy.indexOf("\n)", shopPy.indexOf("SHOP_REQS: tuple[int, ...] = (\n")),
        );
        assert.equal(reqs, renderShopReqs(readShopReqs(src)));
    });

    it("never sells a check from a cell at a looser gate than it is listed at", () => {
        // Enforce Shop Logic greys cells by their own tier. A cell at a lower
        // gate than the listing would sell the check before logic counted it.
        for (const [id, { tier }] of listed) {
            const catalogueId = id - 20000;
            shopItems.forEach((columns) => {
                columns.forEach((column) => {
                    column.forEach((cell, row) => {
                        if (cell !== catalogueId) return;
                        assert.ok(
                            gateRank(shopTier(row, column.length)) >= gateRank(tier),
                            `location ${id} is sold from a cell at a looser gate than shop.py lists`,
                        );
                    });
                });
            });
        }
    });
});
