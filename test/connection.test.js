// A room-page link fills in the connect form.
//
// The apworld's launcher component opens the site with the room's host, port
// and slot name in the query string; the form takes those over whatever was
// saved from last time, and ignores anything it does not understand.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { connectionFromQuery } from "../src/connection.js";

describe("connectionFromQuery", () => {
    it("maps the room link's details onto the form fields", () => {
        assert.deepEqual(connectionFromQuery("?host=archipelago.gg&port=56476&slot=KryenSR"), {
            host: "archipelago.gg",
            port: "56476",
            slotName: "KryenSR",
        });
    });

    it("decodes an escaped slot name", () => {
        assert.deepEqual(connectionFromQuery("?slot=Thomas+SR"), { slotName: "Thomas SR" });
        assert.deepEqual(connectionFromQuery("?slot=Thomas%20SR"), { slotName: "Thomas SR" });
    });

    it("returns nothing for a plain visit", () => {
        assert.deepEqual(connectionFromQuery(""), {});
        assert.deepEqual(connectionFromQuery("?other=1"), {});
    });

    it("skips blank and non-numeric values", () => {
        assert.deepEqual(connectionFromQuery("?host=&port=abc&slot=%20"), {});
    });

    it("never reads a password from the address", () => {
        assert.deepEqual(connectionFromQuery("?password=hunter2&slot=KryenSR"), { slotName: "KryenSR" });
    });
});
