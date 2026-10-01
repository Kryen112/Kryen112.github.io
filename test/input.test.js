// Keys that stay held walk a ranger forever.
//
// The game reads movement off Is_Key_Held[97] ("a") and [100] ("d"), and the
// manual walk in each class function runs before the target check -- so a stuck
// key makes the selected ranger walk and attack in the same frame. That is the
// only path that produces both at once, which is how a Sniper ends up strolling
// into melee while still shooting.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GAME_JS = join(here, "..", "public", "game.js");
const MAIN_JS = join(here, "..", "src", "main.js");

/** The real keyup handler and blur listener out of game.js, on stub globals. */
function loadInput() {
    const src = readFileSync(GAME_JS, "utf8");
    const start = src.indexOf("function releaseKey(key){");
    const blur = src.indexOf('window.addEventListener("blur"');
    assert.ok(start !== -1 && blur > start, "could not find the key handlers in game.js");
    const code = src.slice(start, src.indexOf("});", blur) + 3);

    const Is_Key_Held = Array(256).fill(false);
    const Arr256_4 = Array(256).fill(0);
    const Arr256_5 = Array(256).fill(0);
    const doc = {
        hidden: false,
        handlers: {},
        addEventListener(type, fn) {
            this.handlers[type] = fn;
        },
    };
    const win = {
        handlers: {},
        addEventListener(type, fn) {
            this.handlers[type] = fn;
        },
    };
    new Function("document", "window", "Is_Key_Held", "Arr256_4", "Arr256_5", "Mouse_In_Window", code)(
        doc,
        win,
        Is_Key_Held,
        Arr256_4,
        Arr256_5,
        false,
    );
    return { doc, win, Is_Key_Held };
}

describe("keyup releases the key whatever Shift is doing", () => {
    let env;
    beforeEach(() => {
        env = loadInput();
    });

    it("clears 'a' released while Shift is held", () => {
        env.Is_Key_Held[97] = true; // pressed unshifted
        env.doc.onkeyup({ keyCode: 65, shiftKey: true }); // released with Shift down
        assert.equal(env.Is_Key_Held[97], false, "the ranger would walk left forever");
    });

    it("clears 'd' released while Shift is held", () => {
        env.Is_Key_Held[100] = true;
        env.doc.onkeyup({ keyCode: 68, shiftKey: true });
        assert.equal(env.Is_Key_Held[100], false, "the ranger would walk right forever");
    });

    it("still clears the ordinary unshifted release", () => {
        env.Is_Key_Held[97] = true;
        env.doc.onkeyup({ keyCode: 65, shiftKey: false });
        assert.equal(env.Is_Key_Held[97], false);
    });

    it("clears the shifted index too, so neither can orphan the other", () => {
        env.Is_Key_Held[65] = true;
        env.doc.onkeyup({ keyCode: 65, shiftKey: false });
        assert.equal(env.Is_Key_Held[65], false);
    });
});

describe("losing focus drops every held key", () => {
    it("clears the array on blur", () => {
        const env = loadInput();
        env.Is_Key_Held[97] = true;
        env.Is_Key_Held[100] = true;
        assert.ok(env.win.handlers.blur, "nothing listens for blur, so alt-tab leaves keys held");
        env.win.handlers.blur();
        assert.deepEqual(
            [env.Is_Key_Held[97], env.Is_Key_Held[100]],
            [false, false],
            "alt-tabbing mid-walk would leave the ranger walking",
        );
    });

    it("clears the array when the tab is hidden", () => {
        // A tab switch does not always blur the window, but it hides the document.
        const env = loadInput();
        env.Is_Key_Held[97] = true;
        assert.ok(env.doc.handlers.visibilitychange, "nothing listens for the tab being hidden");
        env.doc.hidden = true;
        env.doc.handlers.visibilitychange();
        assert.equal(env.Is_Key_Held[97], false, "switching tabs mid-walk would leave the ranger walking");
    });

    it("leaves keys alone when the tab becomes visible again", () => {
        const env = loadInput();
        env.Is_Key_Held[97] = true;
        env.doc.hidden = false;
        env.doc.handlers.visibilitychange();
        assert.equal(env.Is_Key_Held[97], true);
    });
});

// Focus has to move with the player: into the chat to type, back to the game to
// play. The game's mousedown handler prevents the default inside the canvas,
// which also stopped a click from moving focus, so the message box kept every
// key; and a clicked Send button kept focus, so a space pressed it again and
// still reached the game.
describe("the chat gives the keyboard back", () => {
    const src = readFileSync(MAIN_JS, "utf8");

    function methodSource(signature) {
        const start = src.indexOf(`    ${signature} {`);
        assert.ok(start !== -1, `could not find ${signature} in main.js`);
        const rest = src.slice(start);
        return rest.slice(0, rest.search(/\n {4}\}/) + 6);
    }

    function loadChat() {
        const methods = ["_onSendClick()", "_leaveChatOnCanvasClick(event)"].map(methodSource);
        const message = {
            value: "",
            focused: false,
            focus() {
                this.focused = true;
            },
            blur() {
                this.focused = false;
            },
        };
        const said = [];
        const host = new Function(`return {
            message: null,
            canvas: { id: "cv" },
            client: { messages: { say: (t) => this.said.push(t) } },
            said: [],
            log() {},
            _handleHintCommand() { return false; },
            ${methods.join(",\n")}
        };`)();
        host.message = message;
        host.client = { messages: { say: (t) => said.push(t) } };
        return { host, message, said };
    }

    it("hands focus back to the message box after Send is clicked", () => {
        const { host, message, said } = loadChat();
        message.value = "hello";
        host._onSendClick();
        assert.deepEqual(said, ["hello"]);
        assert.equal(message.value, "");
        assert.equal(message.focused, true, "the Send button would keep the keyboard");
    });

    it("does the same after a hint command", () => {
        const { host, message } = loadChat();
        host._handleHintCommand = () => true;
        message.value = "!hint stage";
        host._onSendClick();
        assert.equal(message.focused, true);
    });

    it("blurs the chat when the game canvas is clicked", () => {
        const { host, message } = loadChat();
        message.focused = true;
        globalThis.document = { activeElement: message, body: {} };
        host._leaveChatOnCanvasClick({ target: host.canvas });
        assert.equal(message.focused, false, "keys would keep going into the chat");
    });

    it("leaves focus alone for a click elsewhere", () => {
        const { host, message } = loadChat();
        message.focused = true;
        globalThis.document = { activeElement: message, body: {} };
        host._leaveChatOnCanvasClick({ target: { id: "host" } });
        assert.equal(message.focused, true);
    });

    it("survives nothing being focused", () => {
        const { host } = loadChat();
        globalThis.document = { activeElement: null, body: {} };
        assert.doesNotThrow(() => host._leaveChatOnCanvasClick({ target: host.canvas }));
    });

    it("listens in the capture phase, ahead of the game's own handler", () => {
        assert.match(
            src,
            /document\.addEventListener\("mousedown", \(event\) => this\._leaveChatOnCanvasClick\(event\), true\);/,
        );
    });

    it("lets Escape leave the chat", () => {
        const block = src.slice(src.indexOf('this.message.addEventListener("keydown"'), src.indexOf("mousedown"));
        assert.match(block, /event\.key === "Escape"[\s\S]*this\.message\.blur\(\)/);
    });
});

describe("chat keystrokes stay out of the game", () => {
    it("the chat input stops key events reaching document", () => {
        const src = readFileSync(MAIN_JS, "utf8");
        const start = src.indexOf('this.message.addEventListener("keydown"');
        assert.ok(start !== -1, "could not find the chat input handlers");
        const block = src.slice(start, start + 600);
        for (const type of ["keydown", "keyup", "keypress"]) {
            assert.match(
                block,
                new RegExp(`${type}`),
                `${type} from chat still reaches the game, so typing walks a ranger`,
            );
        }
        assert.match(block, /stopPropagation\(\)/, "chat keys are not stopped");
    });
});
