// The shop-check state machine and the Progressive Shop stock gate, lifted out
// of public/game.js. Both are easy to get subtly wrong: the tier has to be
// normalised because shop columns are not all the same depth, and a cell has to
// go back to showing the Archipelago logo if the purchase was never collected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");

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

    it("still reads a seed from before the shops had a track each", () => {
        // Those seeds send one count for all shops and charge nothing for row 0.
        api.mod.progressiveShop = 1;
        api.mod.progressiveShopItems = [32];
        for (const row of [0, 40, 77]) {
            assert.equal(api.shopCellUnlocked(1, 0, row, 33), true, `row ${row} still locked`);
        }
    });
});

// One track per shop. The seed ships the numbers, so the stock the player sees
// is the stock the fill assumed.
const FOUR_TOWNS = [
    [Array.from({ length: 33 }, (_, i) => 100 + i)], // Town
    [Array.from({ length: 15 }, (_, i) => 200 + i)], // Village
    [Array.from({ length: 9 }, (_, i) => 300 + i)], // Resort
    [Array.from({ length: 78 }, (_, i) => 400 + i)], // Island
];
const PROGRESSION = { ids: [15000, 15001, 15002, 15003], steps: [33, 15, 9, 33], first: [0, 1, 1, 1] };

describe("per-shop progressive stock", () => {
    let api;
    function held(counts) {
        api.mod.progressiveShopItems = counts;
    }
    beforeEach(() => {
        api = loadShopHelpers(FOUR_TOWNS);
        api.mod.progressiveShop = 1;
        api.mod.shopProgression = PROGRESSION;
    });

    it("starts Village, Resort and Island with nothing in stock", () => {
        held([0, 0, 0, 0]);
        for (const town of [1, 2, 3]) {
            assert.equal(api.shopCellUnlocked(town, 0, 0, 1), false, `town ${town} row 0 is stocked`);
        }
    });

    it("leaves Town's first row open, because that is where you start", () => {
        held([0, 0, 0, 0]);
        assert.equal(api.shopCellUnlocked(0, 0, 0, 1), true, "Town should start with stock");
    });

    it("opens one shop without opening the others", () => {
        held([32, 0, 0, 0]);
        assert.equal(api.shopCellUnlocked(0, 0, 32, 1), true, "Town should be fully open");
        assert.equal(api.shopCellUnlocked(1, 0, 0, 1), false, "Village opened for free");
        assert.equal(api.shopCellUnlocked(3, 0, 0, 1), false, "Island opened for free");
    });

    it("opens each shop fully at its own count", () => {
        held([32, 15, 9, 33]);
        for (const [town, row] of [
            [0, 32],
            [1, 14],
            [2, 8],
            [3, 77],
        ]) {
            assert.equal(api.shopCellUnlocked(town, 0, row, 1), true, `town ${town} row ${row} locked`);
        }
    });

    it("never opens a row one item early", () => {
        for (const [town, row, needs] of [
            [0, 32, 32],
            [1, 0, 1],
            [1, 14, 15],
            [2, 8, 9],
            [3, 77, 33],
        ]) {
            const counts = [0, 0, 0, 0];
            counts[town] = needs - 1;
            held(counts);
            assert.equal(api.shopCellUnlocked(town, 0, row, 1), false, `town ${town} row ${row} early`);
            counts[town] = needs;
            held(counts);
            assert.equal(api.shopCellUnlocked(town, 0, row, 1), true, `town ${town} row ${row} late`);
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

// The shop cell and the detail pane for an uncollected check.
//
// Item 564 (the Archipelago logo) carries a drop icon but no inventory icon, so
// drawing the cell out of item.gif rendered nothing. And the hint line sat at
// shop_top+36 with the AT row at +40, four pixels into it, while a long item or
// player name ran straight over the item grid at shop_left+120.
describe("shop check presentation", () => {
    const src = readFileSync(GAME_JS, "utf8");

    it("draws the logo from AP_Img, not a sprite index", () => {
        const block = src.slice(src.indexOf("var cell_is_check = shopItemIsCheck(cell_item)"));
        const cell = block.slice(0, block.indexOf("Display_Mode2 = 0;"));
        assert.match(cell, /cell_marked\? AP_Arrow :\(cell_blocked\? AP_Img_Grey :AP_Img\)/, "the cell renders blank");
    });

    it("the AP logo has no inventory icon, which is why AP_Img is needed", () => {
        const entry = src.match(/Item_Catalogue\[564\] = \[([^\]]*)\]/);
        assert.ok(entry, "could not find the AP logo catalogue entry");
        const fields = entry[1].split(",").map((f) => f.trim());
        assert.equal(fields[4], "0", "Item_Ico_Big is no longer 0; the workaround may be stale");
    });

    it("does not draw weapon stats over the hint line", () => {
        const pane = src.slice(src.indexOf("var shop_is_check = shopItemIsCheck(shop_item);"));
        const branch = pane.slice(0, pane.indexOf("} else if (UI_weapClass==Class_Compo){"));
        assert.doesNotMatch(branch, /"AT "/, "the AT row is still drawn for a check");
        assert.doesNotMatch(branch, /shop_top\+36/, "the hint still sits 4px above the AT row");
    });
});

describe("wrapText", () => {
    const wrapText = new Function(
        `${readFileSync(GAME_JS, "utf8").match(/function wrapText\(message,cols\)\{[\s\S]*?\n\}/)[0]}
         return wrapText;`,
    )();

    it("keeps every line inside the pane", () => {
        for (const s of ["Progressive Shop Upgrade", "AP Item", "a".repeat(50), ""]) {
            for (const line of wrapText(s, 17)) assert.ok(line.length <= 17, `too wide: ${line}`);
        }
    });

    it("breaks on spaces when it can", () => {
        assert.deepEqual(wrapText("Progressive Sword", 17), ["Progressive Sword"]);
        assert.deepEqual(wrapText("Progressive Sword Upgrade", 17), ["Progressive Sword", "Upgrade"]);
    });

    it("splits a word longer than the pane instead of overflowing", () => {
        assert.deepEqual(wrapText("Supercalifragilistic", 10), ["Supercalif", "ragilistic"]);
    });

    it("loses no characters", () => {
        const text = "Some Long Item Name (SomePlayerName)";
        assert.equal(wrapText(text, 17).join(" ").replace(/\s+/g, " "), text);
    });

    it("returns nothing for empty text", () => {
        assert.deepEqual(wrapText("", 17), []);
    });
});

// A seed generated before the shops had a track each sends one Progressive Shop
// item covering all four, and no shop_progression in its slot data. Counting
// that per town found nothing for Village, Resort and Island, so those shops
// stayed shut however many items the player held.
describe("a seed from before the shops split", () => {
    function load(held) {
        const api = loadShopHelpers(FOUR_TOWNS);
        api.mod.progressiveShop = 1;
        api.mod.shopProgression = null; // what an old seed sends
        api.mod.progressiveShopItems = held;
        return api;
    }

    it("opens every town from the one shared count", () => {
        const api = load([4]);
        for (const town of [0, 1, 2, 3]) {
            assert.equal(api.shopCellUnlocked(town, 0, 1, 1), true, `town ${town} stayed shut`);
        }
    });

    it("still gates on that count", () => {
        const api = load([0]);
        assert.equal(api.shopCellUnlocked(3, 0, 20, 1), false, "a deep row opened for free");
    });

    it("keeps its first row free everywhere, as it always did", () => {
        const api = load([0]);
        for (const town of [0, 1, 2, 3]) {
            assert.equal(api.shopCellUnlocked(town, 0, 0, 1), true, `town ${town} row 0 closed`);
        }
    });

    it("does not leak into a seed that ships its own numbers", () => {
        const api = loadShopHelpers(FOUR_TOWNS);
        api.mod.progressiveShop = 1;
        api.mod.shopProgression = PROGRESSION;
        api.mod.progressiveShopItems = [32, 0, 0, 0];
        assert.equal(api.shopCellUnlocked(3, 0, 0, 1), false, "Town's items opened Island");
    });
});

// Scouting has to keep up with stock that grows while you are standing in the
// shop. A Progressive Shop item arriving mid-visit opens a row that was never
// scouted, so it showed an Archipelago logo with nothing behind it until you
// walked out and back in.
describe("re-scouting a shop that grows while you are in it", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");
    const tick = src.slice(src.indexOf("const stockKey ="), src.indexOf("const stockKey =") + 600);

    it("keys off how many Progressive items are held", () => {
        assert.match(tick, /window\.ArchipelagoMod\.progressiveShopItems \|\| \[\]\)\.join/);
    });

    it("scouts again when that changes, not only on opening", () => {
        assert.match(tick, /!this\.isScoutingShop \|\| stockKey !== this\.shopStockKey/);
    });

    it("remembers what it last scouted, so it does not loop", () => {
        assert.match(tick, /this\.shopStockKey = stockKey;/);
    });

    it("leaves _applyItem out of it", () => {
        const applyItem = src.slice(src.indexOf("    async _applyItem("));
        const body = applyItem.slice(0, applyItem.indexOf("\n    isInPlayableSequenceStep()"));
        assert.doesNotMatch(body, /scoutShopOnOpen/, "item handling should not know about the shop screen");
    });

    it("the hint check lives with the scout, not at each call site", () => {
        assert.match(src, /shopChecks \|\| !this\.sendShopHints\) return;/);
    });
});

// A shop check holding a Stick Ranger item is drawn as that item rather than
// the Archipelago logo, so a shelf reads at a glance. Item codes are identical
// in every Stick Ranger slot, so another player's sword is drawn as our sword.
describe("shopCheckSprite", () => {
    function load(mod) {
        const src = readFileSync(GAME_JS, "utf8");
        const start = src.indexOf("function shopCheckSprite(itemId){");
        const end = src.indexOf("\n}", start) + 2;
        return new Function("window", `${src.slice(start, end)} return shopCheckSprite;`)({
            ArchipelagoMod: mod,
        });
    }

    const WITH_SPRITE = { shopHints: 1, shopHintSpoiler: { 300: { sprite: 42 } } };

    it("draws the item a Stick Ranger check is holding", () => {
        assert.equal(load(WITH_SPRITE)(300), 42);
    });

    it("falls back to the logo for another game's item", () => {
        assert.equal(load({ shopHints: 1, shopHintSpoiler: { 300: { sprite: null } } })(300), -1);
    });

    it("falls back to the logo for an unscouted cell", () => {
        assert.equal(load({ shopHints: 1, shopHintSpoiler: {} })(300), -1);
    });

    it("keeps the mystery when Shop Hints are off", () => {
        assert.equal(load({ ...WITH_SPRITE, shopHints: 0 })(300), -1, "the sprite gave the item away");
    });

    it("survives having never been handed any hints", () => {
        assert.equal(load({ shopHints: 1 })(300), -1);
    });

    it("treats catalogue id 0 as a real sprite, not as absent", () => {
        assert.equal(load({ shopHints: 1, shopHintSpoiler: { 300: { sprite: 0 } } })(300), 0);
    });
});

describe("the sprite on the hint record", () => {
    const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
    const src = readFileSync(MAIN_JS, "utf8");
    const body = src.slice(src.indexOf("    _stickRangerSprite(game, itemId) {"));
    const method = body.slice(0, body.search(/\n {4}\}/));

    it("only maps Stick Ranger's own items", () => {
        assert.match(method, /game !== "Stick Ranger"/);
    });

    it("only maps the filler range, where the catalogue lives", () => {
        assert.match(method, /itemId < this\.ITEM_OFFSET \|\| itemId >= this\.ITEM_OFFSET \+ 999/);
    });

    it("a disguised trap keeps the logo", () => {
        // Its own sprite would give it away, and wearing the sprite of what it
        // pretends to be is a lie the shelf cannot take back.
        assert.match(src, /hint\.sprite = null;/);
    });
});

// Resort sells each weapon twice in one column: cheap with its compo slot
// blocked, and ten times the price with it open. Both cells are the same
// catalogue item, so they are the same check -- and buying either settled the
// other, leaving the second cell looking like a check that stopped being one.
describe("a shop that sells the same item twice", () => {
    function load(shopItems) {
        const src = readFileSync(GAME_JS, "utf8");
        const start = src.indexOf("function shopCellIsFirstOf(town_stage, column, row){");
        const end = src.indexOf("\n}", start) + 2;
        return new Function("Shop_Items", `${src.slice(start, end)} return shopCellIsFirstOf;`)(shopItems);
    }

    // One town, one column, the same item on both rows.
    const TWICE = [[[270, 270, 0]]];

    it("gives the check to the first cell", () => {
        assert.equal(load(TWICE)(0, 0, 0), true);
    });

    it("does not give it to the second", () => {
        assert.equal(load(TWICE)(0, 0, 1), false, "both cells would claim the same check");
    });

    it("leaves a shop with no duplicates entirely alone", () => {
        const once = [
            [
                [10, 11, 12],
                [13, 14, 15],
            ],
        ];
        for (const [c, r] of [
            [0, 0],
            [0, 2],
            [1, 1],
        ]) {
            assert.equal(load(once)(0, c, r), true, `column ${c} row ${r} was demoted`);
        }
    });

    it("finds the first across columns, not only within one", () => {
        const across = [
            [
                [10, 11],
                [10, 12],
            ],
        ];
        assert.equal(load(across)(0, 0, 0), true);
        assert.equal(load(across)(0, 1, 0), false, "the same item claimed two checks");
    });

    it("is what the cell and the buy button both ask", () => {
        const src = readFileSync(GAME_JS, "utf8");
        assert.match(
            src,
            /cell_is_check = shopItemIsCheck\(cell_item\) && shopCellIsFirstOf\(town_stage,Menu_Column,r\)/,
        );
        assert.match(
            src,
            /shop_is_check = shopItemIsCheck\(shop_item\) && shopCellIsFirstOf\(town_stage,Menu_Column,item_cell\)/,
            "the buy path would still treat the duplicate as a check",
        );
    });
});
