import js from "@eslint/js";
import globals from "globals";

// public/game.js is deliberately not linted: it is ha55ii's Stick Ranger with
// the Archipelago hooks grafted in, and its house style (var, globals, ==,
// fallthrough) is the original's. The Archipelago-specific parts of it are
// covered by test/logic.test.js instead.
export default [
    js.configs.recommended,
    {
        files: ["src/**/*.js", "test/**/*.js", "*.js"],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                // Supplied by public/game.js, which loads before the client.
                Stage_Status: "readonly",
                Stage_Count: "readonly",
                Current_Stage: "readonly",
                Unlocked: "readonly",
                Beaten: "readonly",
                Booked: "readonly",
                Sequence_Step: "writable",
                Save_Code1: "writable",
                Save_Code3: "writable",
                Item_Inv: "readonly",
                Comp1_Inv: "readonly",
                Comp2_Inv: "readonly",
                Item_Catalogue: "readonly",
                Team_Gold: "writable",
                LP_Current: "readonly",
                MP_Bar: "readonly",
                Players: "readonly",
                Enemies: "readonly",
                EN_Info: "readonly",
                EN_Species: "readonly",
                Indicators: "readonly",
                Terrain: "readonly",
                Stickmen_Slots: "readonly",
                Selected_Player: "readonly",
                Win_Width: "readonly",
                GameLoad: "readonly",
                GameSave: "readonly",
                genSaveCode: "readonly",
                antiCheatSet: "readonly",
                fiftyfifty: "readonly",
            },
        },
        rules: {
            eqeqeq: ["warn", "smart"],
            "no-var": "error",
            "prefer-const": "warn",
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
        },
    },
];
