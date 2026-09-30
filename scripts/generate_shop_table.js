#!/usr/bin/env node
/**
 * Regenerate the apworld's stick_ranger/shop.py from public/game.js.
 *
 * The table body and the SHOP_REQS tuple are replaced in place; everything else
 * in the file (its docstring, the class, the comments) is kept. With --check
 * nothing is written and the exit code says whether the file is current.
 *
 *     node scripts/generate_shop_table.js            # rewrite ../AP_Stick_Ranger/stick_ranger/shop.py
 *     node scripts/generate_shop_table.js --check    # exit 1 if it is out of date
 *     node scripts/generate_shop_table.js path/to/shop.py
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProgression, readGameJs, readShopReqs, renderShopReqs, renderShopTable, shopTable } from "./shoptable.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args.includes("--check");
const shopPy =
    args.find((a) => !a.startsWith("--")) ?? join(here, "..", "..", "AP_Stick_Ranger", "stick_ranger", "shop.py");
const itemsPy = join(dirname(shopPy), "items.py");

const src = readGameJs(join(here, "..", "public", "game.js"));
const current = readFileSync(shopPy, "utf8");
const progression = parseProgression(readFileSync(itemsPy, "utf8"));

function splice(text, startMarker, endMarker, body) {
    const start = text.indexOf(startMarker);
    if (start === -1) throw new Error(`${startMarker.trim()} not found in ${shopPy}`);
    const bodyStart = start + startMarker.length;
    const end = text.indexOf(endMarker, bodyStart);
    return text.slice(0, bodyStart) + body + text.slice(end);
}

let next = splice(
    current,
    "shop_table: dict[int, ShopLocationDict] = {\n",
    "\n}",
    renderShopTable(shopTable(src, progression)),
);
next = splice(next, "SHOP_REQS: tuple[int, ...] = (\n", "\n)", renderShopReqs(readShopReqs(src)));

if (next === current) {
    console.log(`${shopPy} is current`);
} else if (check) {
    console.error(`${shopPy} is out of date; run scripts/generate_shop_table.js`);
    process.exit(1);
} else {
    writeFileSync(shopPy, next, "utf8");
    console.log(`wrote ${shopPy}`);
}
