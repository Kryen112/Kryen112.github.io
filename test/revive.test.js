// Reviving a wiped party.
//
// Four Kill a Ranger traps in town end the party where Game Over never fires.
// The revive button works with nobody standing, and is free then -- the code
// used to charge whatever gold was left while the comment said it was free.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const GAME_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game.js");
const src = readFileSync(GAME_JS, "utf8");

describe("a wiped party", () => {
    const start = src.indexOf("const party_wiped =");
    const block = src.slice(start, src.indexOf("Players.PLadd(Displayed_Object", start));

    it("is recognised by every ranger being at zero LP", () => {
        assert.match(block, /LP_Current\[0\]\+LP_Current\[1\]\+LP_Current\[2\]\+LP_Current\[3\] == 0/);
    });

    it("revives for free", () => {
        assert.match(block, /revival_cost = party_wiped\? 0 :/, "a wiped party is charged again");
    });

    it("still pays the usual price otherwise", () => {
        assert.match(block, /maxOf\(floor\(Team_Gold\/10\),10\*LV\[0\]\)/);
    });
});
