// Recording every shop's Progressive item when it arrives.
//
// The shop split gave Village, Resort and Island their own items, but
// _applyItem kept matching Town's id alone. The other three were never written
// to receivedItems, which is what the per-shop counts are rebuilt from, so
// those shops said "No items in stock" however many of their items you held.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const MAIN_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
const PROGRESSION = { ids: [15000, 15001, 15002, 15003], steps: [33, 15, 9, 33], first: [0, 1, 1, 1] };

/** Pull a method out of main.js by its signature, up to its closing brace. */
function methodSource(src, signature) {
    const start = src.indexOf(`    ${signature} {`);
    assert.ok(start !== -1, `could not find ${signature} in main.js`);
    const rest = src.slice(start);
    const end = rest.search(/\n {4}\}/);
    assert.ok(end !== -1, `could not find the end of ${signature}`);
    return rest.slice(0, end + 6);
}

/** The real _applyItem and its shop helpers, on a stub client with a fake window. */
function loadReceiver(shopProgression) {
    const src = readFileSync(MAIN_JS, "utf8");
    const methods = ["async _applyItem(id, firstTime)", "_isProgressiveShopItem(id)", "_refreshProgressiveShop()"].map(
        (signature) => methodSource(src, signature),
    );
    const fakeWindow = { ArchipelagoMod: { shopProgression, rangerClassesUnlocked: new Set() } };
    const host = new Function(
        "window",
        `return {
            RANGER_CLASSES: {},
            LOC_OFFSET: 11000,
            ITEM_OFFSET: 12000,
            PROGRESSIVE_SHOP_OFFSET: 15000,
            receivedItems: [],
            pendingItems: [],
            async saveAPData() {},
            ${methods.join(",\n")}
        };`,
    )(fakeWindow);
    return { host, mod: fakeWindow.ArchipelagoMod };
}

describe("recording Progressive Shop items", () => {
    let host, mod;
    beforeEach(() => {
        ({ host, mod } = loadReceiver(PROGRESSION));
    });

    it("counts Village, Resort and Island items, not only Town's", async () => {
        for (const id of [15001, 15002, 15003, 15003]) await host._applyItem(id, true);
        assert.deepEqual(host.receivedItems, [15001, 15002, 15003, 15003]);
        assert.deepEqual(mod.progressiveShopItems, [0, 1, 1, 2]);
    });

    it("still counts Town's", async () => {
        await host._applyItem(15000, true);
        assert.deepEqual(mod.progressiveShopItems, [1, 0, 0, 0]);
    });

    it("does not inflate a count when a reconnect replays the item", async () => {
        await host._applyItem(15003, true);
        await host._applyItem(15003, false);
        assert.deepEqual(host.receivedItems, [15003]);
        assert.deepEqual(mod.progressiveShopItems, [0, 0, 0, 1]);
    });

    it("leaves the neighbouring class and shop-check ranges alone", () => {
        assert.equal(host._isProgressiveShopItem(14007), false);
        assert.equal(host._isProgressiveShopItem(20003), false);
    });

    it("counts the single item of a seed from before the shops split", async () => {
        ({ host, mod } = loadReceiver(null));
        await host._applyItem(15000, true);
        assert.deepEqual(mod.progressiveShopItems, [1]);
    });
});
