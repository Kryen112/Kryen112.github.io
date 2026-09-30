// Which apworld made the seed, and what the site says about it.
//
// Seeds from apworld 1.8.12 on say which version made them. Before that the
// client guessed from which slot_data keys were missing, and every one of those
// guesses is now a LEGACY branch with a removal date.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
    LEGACY_SUPPORT_ENDS,
    SUPPORTED_LOGIC_VERSION,
    compareVersions,
    legacySeed,
    logicNotice,
    versionNotice,
} from "../src/version.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("compareVersions", () => {
    it("orders dotted versions numerically, not as text", () => {
        assert.equal(compareVersions("1.8.12", "1.8.9"), 1, "12 sorted before 9 as text");
        assert.equal(compareVersions("1.8.9", "1.8.12"), -1);
        assert.equal(compareVersions("1.8.12", "1.8.12"), 0);
    });

    it("treats a missing part as zero", () => {
        assert.equal(compareVersions("1.8", "1.8.0"), 0);
        assert.equal(compareVersions("2", "1.9.9"), 1);
    });
});

describe("legacySeed", () => {
    it("is a seed with no world_version", () => {
        assert.equal(legacySeed({}), true);
        assert.equal(legacySeed({ world_version: "1.8.12" }), false);
        assert.equal(legacySeed(null), true);
    });
});

describe("versionNotice", () => {
    it("says nothing when the seed and the site match", () => {
        assert.equal(versionNotice("1.8.12", "1.8.12"), null);
    });

    it("is an error when the seed is newer than the site", () => {
        const notice = versionNotice("1.9.0", "1.8.12");
        assert.equal(notice.level, "error");
        assert.match(notice.text, /1\.9\.0/);
        assert.match(notice.text, /1\.8\.12/);
    });

    it("only informs when the seed is older", () => {
        assert.equal(versionNotice("1.8.12", "1.9.0").level, "info");
    });

    it("names the support end for a seed with no version", () => {
        const notice = versionNotice(undefined, "1.8.12");
        assert.equal(notice.level, "info");
        assert.match(notice.text, new RegExp(LEGACY_SUPPORT_ENDS));
    });
});

describe("logicNotice", () => {
    it("accepts the version this site evaluates", () => {
        assert.equal(logicNotice({ version: SUPPORTED_LOGIC_VERSION, gates: [] }), null);
    });

    it("treats a block with no version as the first one", () => {
        // 1.8.0 through 1.8.11 shipped the block without a version field.
        assert.equal(logicNotice({ gates: [] }), null);
    });

    it("refuses a shape it does not know, and says which", () => {
        const text = logicNotice({ version: SUPPORTED_LOGIC_VERSION + 1 });
        assert.match(text, new RegExp(`version ${SUPPORTED_LOGIC_VERSION + 1}`));
    });

    it("has nothing to say about a seed with no logic at all", () => {
        assert.equal(logicNotice(null), null);
    });
});

describe("the legacy branches are marked", () => {
    // The point of the flag is that every branch kept for old seeds can be
    // found in one search and removed together.
    const files = ["public/game.js", "src/main.js", "src/options.js"].map((f) =>
        readFileSync(join(here, "..", f), "utf8"),
    );

    it("every LEGACY marker carries the removal date", () => {
        for (const src of files) {
            const markers = src.split("\n").filter((l) => /LEGACY[ :(]/.test(l) && !l.includes("marked LEGACY"));
            for (const line of markers) {
                assert.match(line, /remove after 2026-11/, `undated legacy branch: ${line.trim()}`);
            }
        }
    });

    it("the removal date is the one the version module states", () => {
        assert.equal(LEGACY_SUPPORT_ENDS, "2026-11");
    });

    it("main.js sets the flag the game reads", () => {
        assert.match(files[1], /window\.ArchipelagoMod\.legacySeed = legacy;/);
        assert.match(files[0], /function legacySeed\(\)\{ return !!window\.ArchipelagoMod\.legacySeed; \}/);
    });
});
