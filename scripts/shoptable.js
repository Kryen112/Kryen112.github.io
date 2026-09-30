/**
 * The apworld's shop table, derived from public/game.js.
 *
 * Each purchasable item is one check. An item sold in more than one town is
 * listed against the most accessible town that stocks it (Town, then Village,
 * Resort, Island), at the lowest normalised row it occupies there; that row's
 * Progressive Shop cost is the check's `req`. The apworld's stick_ranger/shop.py
 * is generated from this (scripts/generate_shop_table.js) and pinned against it
 * (test/shoptable.test.js).
 */
import { readFileSync } from "node:fs";

export const TOWNS = ["Town", "Village", "Resort", "Island"];
export const SHOP_TIERS = 33;
export const LOCATION_OFFSET = 20000;

/** A block of game.js from a marker to the first line that is just `];`. */
function arrayLiteral(src, marker) {
    const start = src.indexOf(marker);
    if (start === -1) throw new Error(`${marker} not found in game.js`);
    const open = src.indexOf("[", start);
    const end = src.indexOf("\n];", open);
    return src.slice(open, end + 2);
}

/** Shop_Items: towns -> columns -> rows of catalogue ids. */
export function readShopItems(src) {
    return new Function(`return ${arrayLiteral(src, "var Shop_Items = [")};`)();
}

/** Shop_Reqs: the stage each Town row waits for, by stage id. */
export function readShopReqs(src) {
    const match = src.match(/var Shop_Reqs = \[([^\]]*)\]/);
    if (!match) throw new Error("Shop_Reqs not found in game.js");
    return match[1].split(",").map((n) => parseInt(n, 10));
}

/** Catalogue id -> { name, level } from the Item_Catalogue lines. */
export function readCatalogue(src) {
    const items = new Map();
    for (const match of src.matchAll(/Item_Catalogue\[(\d+)\] = \["([^"]*)"\s*,(\d+)\s*,/g)) {
        items.set(Number(match[1]), { name: match[2], level: Number(match[3]) });
    }
    return items;
}

export const shopTier = (row, columnLength) => Math.floor((row * SHOP_TIERS) / columnLength);

/** Progressive items a row costs, as shopReq in game.js computes it. */
export const shopReq = (row, columnLength, steps, first) => Math.floor((row * steps) / columnLength) + first;

/** "mach punch" -> "Mach Punch"; "GreatSword" and "3-round" keep their own shape. */
export function displayName(name, level) {
    const words = name
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    return level > 0 ? `${words} ${level}` : words;
}

/**
 * Every shop check, keyed by location id: { name, region, tier, req }.
 * `progression` is { steps, first } per town, as items.py lists them.
 */
export function shopTable(src, progression) {
    const shopItems = readShopItems(src);
    const catalogue = readCatalogue(src);
    const table = new Map();
    shopItems.forEach((columns, townIndex) => {
        const town = TOWNS[townIndex];
        columns.forEach((column) => {
            column.forEach((id, row) => {
                if (!id) return;
                const tier = shopTier(row, column.length);
                const req = shopReq(row, column.length, progression.steps[townIndex], progression.first[townIndex]);
                const current = table.get(id);
                // First town wins; within a town, the lowest tier, then the lowest req.
                if (current && (current.townIndex < townIndex || (current.townIndex === townIndex && current.tier <= tier && current.req <= req)))
                    return;
                if (current && current.townIndex === townIndex && current.tier < tier) return;
                const item = catalogue.get(id);
                if (!item) throw new Error(`catalogue has no item ${id}`);
                table.set(id, { name: `${town} Shop: ${displayName(item.name, item.level)}`, region: town, tier, req, townIndex });
            });
        });
    });
    return new Map(
        [...table.entries()]
            .sort(([a], [b]) => a - b)
            .map(([id, { name, region, tier, req }]) => [LOCATION_OFFSET + id, { name, region, tier, req }]),
    );
}

/** The entries in stick_ranger/shop.py, keyed by location id. */
export function parseShopPy(text) {
    const entries = new Map();
    const pattern = /(\d+): \{"name": "([^"]+)", "region": "(\w+)", "tier": (\d+), "req": (\d+)\}/g;
    for (const match of text.matchAll(pattern)) {
        entries.set(Number(match[1]), { name: match[2], region: match[3], tier: Number(match[4]), req: Number(match[5]) });
    }
    return entries;
}

/** SHOP_PROGRESSION_STEPS and _FIRST out of items.py, in town order. */
export function parseProgression(itemsPy) {
    const dict = (name) => {
        const start = itemsPy.indexOf(`${name}: dict[str, int] = {`);
        if (start === -1) throw new Error(`${name} not found in items.py`);
        const block = itemsPy.slice(start, itemsPy.indexOf("\n}", start));
        return TOWNS.map((town) => Number(block.match(new RegExp(`"${town}": (\\d+)`))[1]));
    };
    return { steps: dict("SHOP_PROGRESSION_STEPS"), first: dict("SHOP_PROGRESSION_FIRST") };
}

/** Render the table as the body of shop.py's `shop_table` literal. */
export function renderShopTable(table) {
    const lines = [];
    for (const [id, { name, region, tier, req }] of table) {
        lines.push(`    ${id}: {"name": "${name}", "region": "${region}", "tier": ${tier}, "req": ${req}},`);
    }
    return lines.join("\n");
}

export function renderShopReqs(reqs) {
    const rows = [];
    for (let i = 0; i < reqs.length; i += 20) {
        rows.push(`    ${reqs.slice(i, i + 20).join(", ")},`);
    }
    return rows.join("\n");
}

export const readGameJs = (path) => readFileSync(path, "utf8");
