import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
    base: "/",
    // The site's own version, so it can compare itself to the apworld that made a seed.
    define: {
        __SITE_VERSION__: JSON.stringify(version),
    },
    build: {
        outDir: "docs",
    },
});
