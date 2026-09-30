# Kryen112.github.io

This repository hosts the **online version of the Archipelago integration for Stick Ranger**.

For the full source code of the integration and detailed explanation, see the main project repository:  
[https://github.com/Kryen112/AP_Stick_Ranger](https://github.com/Kryen112/AP_Stick_Ranger)

## Running Locally

To set up a local development environment using [Vite](https://vitejs.dev/):

1. Install [Node.js](https://nodejs.org/) (LTS recommended)
2. Clone this repository
3. Run:

```bash
npm install
npm run dev
```

4. Then open http://localhost:5173 in your browser.

## Checks

```bash
npm run lint          # ESLint over src/ and test/
npm run format:check  # Prettier
npm test              # the Archipelago logic block in public/game.js
```

The client carries no logic tables of its own: it evaluates the description
the apworld ships in slot_data, and `test/logic.test.js` covers that evaluator.
Two things are pinned across the repos when
[AP_Stick_Ranger](https://github.com/Kryen112/AP_Stick_Ranger) is checked out
beside this one (they skip otherwise): the list of options slot_data carries
(`test/slotdata.test.js`) and the shop table (`test/shoptable.test.js`, which
also checks that `scripts/generate_shop_table.js` would write the apworld's
`shop.py` exactly as it is).

Anything that touches archipelago.js gets a behaviour test against a stub
client; a regex over the source is only ever a tripwire for something a test
cannot reach, never a stand-in for a feature.

`public/game.js` is deliberately excluded from ESLint and Prettier: it is
ha55ii's Stick Ranger with the Archipelago hooks grafted in, and reformatting it
would bury every future change in whitespace noise.

## Releasing

`docs/` is the built site and is served by GitHub Pages straight from `main`, so
committing a rebuilt `docs/` is the deployment. It is rebuilt once per release,
not per feature commit, by the release script:

```bash
npm run release -- 1.8.12
```

That bumps `package.json`, formats, lints, tests, rebuilds `docs/`, commits
"Release version 1.8.12", pushes, waits for CI to go green, and tags. It stops at
the first failure. The apworld is released separately and only when it changes;
the site tells a player when a seed was made by an apworld newer than the site.

## Contributing

Contributions and improvements are welcome!