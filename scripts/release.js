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

// Let the push register before asking for its run.
let runId = "";
for (let attempt = 0; attempt < 6 && runId === ""; attempt++) {
    try {
        runId = read("gh run list --branch main --limit 1 --json databaseId --jq \".[0].databaseId\"");
    } catch {
        runId = "";
    }
    if (runId === "") execSync("sleep 5");
}
if (runId === "") {
    console.error("could not find the CI run; tag by hand once it is green: git tag " + version);
    process.exit(1);
}
run(`gh run watch ${runId} --exit-status`);
run(`git tag ${version}`);
run(`git push origin ${version}`);
console.log(`released ${version}`);
