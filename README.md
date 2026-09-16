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

`test/logic.test.js` pins `in_logic()` against the same stage ids the apworld
uses for its "stages required for <boss>" gates. The apworld has the matching
test in `stick_ranger/test/test_data.py`, so if either side's region lists drift
one of the two repos goes red instead of the world map quietly telling players a
stage is in logic when Archipelago disagrees.

`public/game.js` is deliberately excluded from ESLint and Prettier: it is
ha55ii's Stick Ranger with the Archipelago hooks grafted in, and reformatting it
would bury every future change in whitespace noise.

## Building for Production

To generate a production build (for GitHub Pages deployment):

```bash
npm run build
```

This will regenerate the /docs folder, which is served as the live site at:
[https://kryen112.github.io/](https://kryen112.github.io/)

## Contributing

Contributions and improvements are welcome!