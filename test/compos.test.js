// Removable Compos.
//
// In the base game a compo is in for good once fitted, so a good one sunk into a
// starter weapon is gone. With the option on, clicking a filled slot with an
// empty hand lifts it back onto the cursor.
//
// The cross that blocks a store-bought second slot is not a compo and must stay
// where it is -- Remove Null Compo is the option for that, and lifting the cross
// out would quietly hand you a free slot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");
const NULL_SLOT = 59;
const MOUSE = 40; // Inv_Last

/** The real compoCanBeRemoved and liftCompo, on stub inventories. */
function loadCompos() {
    const src = readFileSync(GAME_JS, "utf8");
    const start = src.indexOf("function compoCanBeRemoved(compo){");
    const end = src.indexOf("function restrictSlots(");
    assert.ok(start !== -1 && end > start, "could not find the compo helpers in game.js");

    const state = {
        Item_Inv: Array(41).fill(0),
        Comp1_Inv: Array(41).fill(0),
        Comp2_Inv: Array(41).fill(0),
    };
    const mod = { removableCompos: 0 };
    const api = new Function(
        "window",
        "Item_Inv",
        "Comp1_Inv",
        "Comp2_Inv",
        "Inv_Last",
        "Null_Slot",
        `${src.slice(start, end)}
         return { compoCanBeRemoved, liftCompo };`,
    )({ ArchipelagoMod: mod }, state.Item_Inv, state.Comp1_Inv, state.Comp2_Inv, MOUSE, NULL_SLOT);
    return { state, mod, ...api };
}

describe("compoCanBeRemoved", () => {
    let env;
    beforeEach(() => {
        env = loadCompos();
        env.mod.removableCompos = 1;
    });

    it("says no while the option is off", () => {
        env.mod.removableCompos = 0;
        assert.equal(env.compoCanBeRemoved(300), false);
    });

    it("says yes for a fitted compo with an empty hand", () => {
        assert.equal(env.compoCanBeRemoved(300), true);
    });

    it("says no for an empty slot", () => {
        assert.equal(env.compoCanBeRemoved(0), false);
    });

    it("leaves the blocking cross alone", () => {
        assert.equal(env.compoCanBeRemoved(NULL_SLOT), false, "lifting the cross frees the slot");
    });

    it("says no while something is already held", () => {
        // Otherwise the click would overwrite whatever is on the cursor.
        env.state.Item_Inv[MOUSE] = 123;
        assert.equal(env.compoCanBeRemoved(300), false);
    });
});

describe("liftCompo", () => {
    let env;
    const WEAPON = 5;
    beforeEach(() => {
        env = loadCompos();
        env.mod.removableCompos = 1;
    });

    it("moves the first slot's compo onto the cursor", () => {
        env.state.Comp1_Inv[WEAPON] = 300;
        env.liftCompo(WEAPON, 0);
        assert.equal(env.state.Item_Inv[MOUSE], 300, "the compo did not reach the cursor");
        assert.equal(env.state.Comp1_Inv[WEAPON], 0, "the slot is still occupied");
    });

    it("moves the second slot's compo onto the cursor", () => {
        env.state.Comp2_Inv[WEAPON] = 301;
        env.liftCompo(WEAPON, 1);
        assert.equal(env.state.Item_Inv[MOUSE], 301);
        assert.equal(env.state.Comp2_Inv[WEAPON], 0);
    });

    it("does not disturb the other slot", () => {
        env.state.Comp1_Inv[WEAPON] = 300;
        env.state.Comp2_Inv[WEAPON] = 301;
        env.liftCompo(WEAPON, 0);
        assert.equal(env.state.Comp2_Inv[WEAPON], 301, "the second compo was lost");
    });

    it("hands over a bare compo, with nothing stuck to it", () => {
        env.state.Comp1_Inv[WEAPON] = 300;
        env.state.Comp1_Inv[MOUSE] = 999;
        env.state.Comp2_Inv[MOUSE] = 998;
        env.liftCompo(WEAPON, 0);
        assert.deepEqual([env.state.Comp1_Inv[MOUSE], env.state.Comp2_Inv[MOUSE]], [0, 0]);
    });

    it("round-trips: what comes out is what went in", () => {
        env.state.Comp1_Inv[WEAPON] = 42;
        env.liftCompo(WEAPON, 0);
        const held = env.state.Item_Inv[MOUSE];
        env.state.Comp1_Inv[WEAPON] = held; // as the insert path would
        assert.equal(env.state.Comp1_Inv[WEAPON], 42, "the compo changed on the way out");
    });
});

describe("the click path", () => {
    const src = readFileSync(GAME_JS, "utf8");

    it("tries removal before insertion on both compo rows", () => {
        const removals = src.match(/if \(compoCanBeRemoved\(Comp[12]_Inv\[compo_weapon\]\)\)\{/g) ?? [];
        assert.equal(removals.length, 2, "one of the compo rows cannot be emptied");
    });

    it("keeps insertion as the fallback", () => {
        const inserts = src.match(/\} else if \(getVal\(Item_Inv\[Inv_Last\],Item_Class_ID\)==Class_Compo/g) ?? [];
        assert.equal(inserts.length, 2, "fitting a compo no longer works");
    });
});
