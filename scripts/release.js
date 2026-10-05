#!/usr/bin/env node
/**
 * Cut a site release, in the order that cannot be skipped by hand.
 *
 *     npm run release -- 1.8.12
 *
 * Bumps package.json, formats, lints, tests, rebuilds docs/ (the only time it
 * is rebuilt: Pages serves it from main), commits "Release version X", pushes,
 * waits for CI, then tags. Stops at the first failure and leaves the tree for
 * you to look at.
 */
import { execSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    console.error("usage: npm run release -- X.Y.Z");
    process.exit(2);
}

const run = (command) => {
    console.log(`> ${command}`);
    execSync(command, { stdio: "inherit" });
};
const read = (command) => execSync(command, { encoding: "utf8" }).trim();

if (read("git status --porcelain") !== "") {
    console.error("the working tree is not clean; commit or stash first");
    process.exit(1);
}
if (read("git rev-parse --abbrev-ref HEAD") !== "main") {
    console.error("releases are cut from main");
    process.exit(1);
}

run(`npm version ${version} --no-git-tag-version`);
run("npm run format");
run("npm run lint");
run("npm test");
run("npm run build");
run("git add -A");
run(`git commit -m "Release version ${version}"`);
run("git push");

// The run for this push, found by its commit: straight after a push the newest
// run on main is still the previous one, already green, and watching that would
// tag before CI had looked at the release. In-process sleep, because a shell
// `sleep` is not there when this runs from PowerShell.
const sleep = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
const head = read("git rev-parse HEAD");
let runId = "";
for (let attempt = 0; attempt < 12 && runId === ""; attempt++) {
    try {
        const runs = JSON.parse(read("gh run list --branch main --limit 5 --json databaseId,headSha"));
        runId = String(runs.find((run) => run.headSha === head)?.databaseId ?? "");
    } catch {
        runId = "";
    }
    if (runId === "") sleep(5);
}
if (runId === "") {
    console.error(`could not find the CI run for ${head}; tag by hand once it is green: git tag ${version}`);
    process.exit(1);
}
run(`gh run watch ${runId} --exit-status`);
run(`git tag ${version}`);
run(`git push origin ${version}`);
console.log(`released ${version}`);
