import { Client, itemsHandlingFlags } from "archipelago.js";
import { itemColor, itemColorValue } from "./colors.js";
import { connectionFromQuery } from "./connection.js";
import { disguiseFor } from "./disguise.js";
import {
    SHOP_HINTS_ALL,
    SHOP_HINTS_OFF,
    resolveEnforceShopLogic,
    resolveProgressiveShop,
    resolveRingGold,
    resolveShopChecks,
    resolveShopHints,
} from "./options.js";
import { missingSlotDataKeys } from "./slotdata.js";
import { legacySeed, logicNotice, versionNotice } from "./version.js";

const CONNECTION_KEY = "StickRangerConnection";
// Set by vite.config.js from package.json; absent when main.js runs unbundled.
const SITE_VERSION = typeof __SITE_VERSION__ === "undefined" ? "0.0.0" : __SITE_VERSION__;
// Ring Link sends at most one Bounce this often, however much gold moved.
const RING_LINK_FLUSH_MS = 5000;

class APIntegration {
    constructor() {
        this.STAGE_COMPLETE_OFFSET = 10000;
        this.BOOK_OFFSET = 10100;
        this.ENEMY_OFFSET = 10200;
        this.LOC_OFFSET = 11000;
        this.ITEM_OFFSET = 12000;
        this.TRAPS_OFFSET = 13000;
        this.CLASS_OFFSET = 14000;
        this.PROGRESSIVE_SHOP_OFFSET = 15000;
        this.SHOP_OFFSET = 20000;
        this.RANGER_CLASSES = {
            14000: "Boxer",
            14001: "Gladiator",
            14002: "Sniper",
            14003: "Magician",
            14004: "Priest",
            14005: "Gunner",
            14006: "Whipper",
            14007: "Angel",
        };
        this.INV_START = 16;
        this.MOUSE_SLOT = 40;
        this.stagesToWin = [88];

        this._connected = false;
        this._disconnected = false;
        this.receivedItems = [];
        this.pendingItems = [];
        this._serverItemsQueue = [];
        this.prevStage = [...Stage_Status];
        this.winReported = false;
        this.lastSequence = -1;
        this.lastStage = -1;
        this._tickBusy = false;
        this.sendShopHints = false;
        this.shopHintsMode = SHOP_HINTS_OFF;
        this.isScouting = false;
        this.isScoutingShop = false;
        this.shopStockKey = "";
        // Per-connection id, so the server's echo of our own Bounce is dropped.
        this.ringSource = null;
        this.lastRingFlush = 0;
        this.excludedBookStages = [0, 20, 47, 70, 77]; // Town, Village, Resort, Forget Tree, Island
        this.bookHints = {};
        this.shopHints = {};
        this.randomizedBookCosts = {};
        this.slotData = {};
        this.deathLinkSent = false;
        this.deathLinkReceived = false;
        this.deathLinkPending = false;
        this.deathLinkSource = "";
        this.deathLinkTime = ""; // Currently unused
        this.deathLinkCause = "";
        this.pendingTraps = [];
        this.deathMouseItem = {};
        this.connectMouseItem = {};
        this.unlockForgetTree = false;

        this.host = document.getElementById("host");
        this.port = document.getElementById("port");
        this.slotName = document.getElementById("slotName");
        this.password = document.getElementById("password");
        this.connect = document.getElementById("connect");
        this.connectionBox = document.getElementById("connectionBox");
        this.connectionInfo = document.getElementById("connectionInfo");
        this.disconnect = document.getElementById("disconnect");
        this.chatLine = document.getElementById("chatLine");
        this.message = document.getElementById("message");
        this.send = document.getElementById("send");
        this.chatMessages = document.getElementById("chatMessages");
        this.apDiv = document.getElementById("APConnection");
        this.leftPanel = document.getElementById("left-panel");

        this._restoreConnectionInfo();

        this.connect.addEventListener("click", () => this._onConnectClick());
        const listenForEnter = (input) => {
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    this._onConnectClick();
                }
            });
        };
        listenForEnter(this.host);
        listenForEnter(this.port);
        listenForEnter(this.slotName);
        listenForEnter(this.password);

        let disconnectConfirmTimeout = null;
        let awaitingDisconnectConfirm = false;

        const resetDisconnectButton = () => {
            this.disconnect.textContent = "Disconnect";
            this.disconnect.style.color = "";
            awaitingDisconnectConfirm = false;
            if (disconnectConfirmTimeout) {
                clearTimeout(disconnectConfirmTimeout);
                disconnectConfirmTimeout = null;
            }
        };

        this.disconnect.addEventListener("click", (event) => {
            if (!awaitingDisconnectConfirm) {
                this.disconnect.textContent = "Are you sure?";
                this.disconnect.style.color = "red";
                awaitingDisconnectConfirm = true;

                disconnectConfirmTimeout = setTimeout(resetDisconnectButton, 10000);
            } else {
                this.client?.socket.disconnect();
                resetDisconnectButton();
            }

            event.stopPropagation();
        });

        document.addEventListener("click", (event) => {
            if (awaitingDisconnectConfirm && !this.disconnect.contains(event.target)) {
                resetDisconnectButton();
            }
        });

        this.send.addEventListener("click", () => this._onSendClick());
        this.message.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this._onSendClick();
            }
        });
        // The game reads keys off document, so anything typed in chat also
        // drives the rangers -- an "a" or "d" walks whoever is selected.
        for (const type of ["keydown", "keyup", "keypress"]) {
            this.message.addEventListener(type, (event) => event.stopPropagation());
        }

        window.ArchipelagoMod.explainBlockedStage = (stage) => this._explainBlockedStage(stage);
        window.addEventListener("beforeunload", () => this._onUnload());
        this._tick = this._tick.bind(this);
        requestAnimationFrame(this._tick);
    }

    /**
     * Last-used connection details, so you don't retype them every session.
     *
     * localStorage is per-browser and never leaves the machine, but it is
     * plaintext -- every read is wrapped because it throws outright in a private
     * window or with site data blocked, and a failure here must not stop you
     * connecting by hand.
     */
    _restoreConnectionInfo() {
        try {
            const saved = JSON.parse(localStorage.getItem(CONNECTION_KEY) || "{}");
            for (const field of ["host", "port", "slotName", "password"]) {
                if (typeof saved[field] === "string" && saved[field] !== "") {
                    this[field].value = saved[field];
                }
            }
        } catch {
            // no saved details, or storage is unavailable -- leave the defaults
        }
        this._applyLinkedConnectionInfo();
    }

    /**
     * Details from a room-page link win over what was saved, and are dropped
     * from the address bar once read, so a refresh after retyping the port by
     * hand keeps the retyped one rather than the link's.
     */
    _applyLinkedConnectionInfo() {
        const linked = connectionFromQuery(window.location.search);
        for (const [field, value] of Object.entries(linked)) {
            this[field].value = value;
        }
        if (Object.keys(linked).length === 0) {
            return;
        }
        try {
            history.replaceState(null, "", window.location.pathname + window.location.hash);
        } catch {
            // leave the address as it is; the form is already filled in
        }
    }

    _saveConnectionInfo() {
        try {
            localStorage.setItem(
                CONNECTION_KEY,
                JSON.stringify({
                    host: this.host.value,
                    port: this.port.value,
                    slotName: this.slotName.value,
                    password: this.password.value,
                }),
            );
        } catch {
            // storage unavailable; not worth interrupting the connection over
        }
    }

    /**
     * How many rows of the shop are open, i.e. how many Progressive Shop items
     * have arrived, one count per shop in the game's town order. Counted from
     * receivedItems rather than incremented, so a reconnect that replays the
     * whole item list cannot inflate it.
     */
    _refreshProgressiveShop() {
        const ids = window.ArchipelagoMod.shopProgression?.ids ?? [this.PROGRESSIVE_SHOP_OFFSET];
        window.ArchipelagoMod.progressiveShopItems = ids.map(
            (id) => this.receivedItems.filter((received) => received === id).length,
        );
    }

    /**
     * Any shop's Progressive item. Matched by range rather than by the seed's
     * id list, because an item can be applied before slot data has arrived.
     * The shop split kept matching Town's id alone here, so Village, Resort
     * and Island items were never recorded and those shops stayed empty.
     */
    _isProgressiveShopItem(id) {
        return id >= this.PROGRESSIVE_SHOP_OFFSET && id < this.PROGRESSIVE_SHOP_OFFSET + 999;
    }

    getStorageKey() {
        return `StickRangerSaveData:${this.client.players.self.team}:${this.client.players.self.slot}`;
    }

    async loadAPData() {
        console.log("Loading data...");

        const data = await this.client.storage.fetch(this.getStorageKey());

        if (data) {
            console.log("Found data: ", data);
            this.receivedItems = data.receivedItems ?? [];
            this.prevStage = data.stages ?? [...Stage_Status];
            this.bookHints = data.bookHints ?? {};
            this.shopHints = data.shopHints ?? {};
            this.randomizedBookCosts = data.randomizedBookCosts ?? {};
            this.deathMouseItem = data.deathMouseItem ?? {};
            this.connectMouseItem = data.connectMouseItem ?? {};
            window.ArchipelagoMod.enemyIdsSent = new Set(data.enemyIdsSent ?? []);
            window.ArchipelagoMod.shopIdsSent = new Set(data.shopIdsSent ?? []);
            window.ArchipelagoMod.pendingClassSwapItems = data.pendingClassSwapItems ?? [];
            GameLoad(data.save.replace(/\r\n|\r|\n/g, ""));
            this.restoreStagesBeaten(data.stages);
            window.ArchipelagoMod.forgetOpenGates?.();
        } else {
            console.log("No data found");
        }
    }

    async saveAPData() {
        console.log("Saving game...");

        if (this._connected) {
            Save_Code3 = genSaveCode(0);
            const payload = {
                receivedItems: this.receivedItems,
                stages: Stage_Status,
                save: GameSave("0"),
                bookHints: this.bookHints,
                shopHints: this.shopHints,
                randomizedBookCosts: this.randomizedBookCosts,
                deathMouseItem: this.deathMouseItem,
                connectMouseItem: this.connectMouseItem,
                enemyIdsSent: Array.from(window.ArchipelagoMod.enemyIdsSent ?? []),
                shopIdsSent: Array.from(window.ArchipelagoMod.shopIdsSent ?? []),
                pendingClassSwapItems: window.ArchipelagoMod.pendingClassSwapItems ?? [],
            };

            console.log("Saving payload: ");
            console.log(payload);

            await this.client.storage.prepare(this.getStorageKey(), {}).update(payload).commit(false);
        } else {
            console.log("Not connected yet");
        }
    }

    async _onConnectClick() {
        this.leftPanel.style.display = "block";
        this.connectionInfo.textContent =
            "Connected at: " + this.host.value + ":" + this.port.value + " - " + this.slotName.value;
        this._disconnected = false;
        this.apDiv.style.display = "none";
        this.connectionBox.style.display = "flex";
        await this._connect();
    }

    async _onDisconnect() {
        this.leftPanel.style.display = "none";
        this._connected = false;
        this._disconnected = true;
        this.apDiv.style.display = "flex";
        this.connectionBox.style.display = "none";
        this.chatLine.style.display = "none";
        this.log("Disconnected from multiworld server.", "info");
        Sequence_Step = 0;
        for (let s = 0; s < Stage_Count; s++) Stage_Status[s] = 0;
        Stage_Status[0] = Beaten | Unlocked;
        Stage_Status[1] = Unlocked;
        antiCheatSet();
    }

    /**
     * "!hint stage" and "!hint class": what the next locked gate still wants.
     *
     * You can see that Castle will not open, but not which of the twenty-odd
     * Grassland stages counts towards it, or how many ranger classes it is
     * short. The seed's logic knows both, so these ask it and then hint the
     * answer through Archipelago in the ordinary way, hint points and all.
     *
     * Anything else beginning with !hint -- a bare "!hint", "!hint Unlock
     * Lake" -- goes to the server untouched and means what it always did.
     *
     * Returns true when the message was handled here.
     */
    _handleHintCommand(text) {
        const match = /^!hint\s+(stage|class)$/i.exec(text);
        if (!match) return false;

        const needs = window.ArchipelagoMod.nextGateNeeds?.();
        if (!needs) {
            this.log(
                window.ArchipelagoMod.logic
                    ? "Every gate is already open; nothing left to ask for."
                    : "This seed did not ship its logic, so the next requirement cannot be worked out.",
                "info",
            );
            return true;
        }

        return match[1].toLowerCase() === "stage" ? this._hintNextStage(needs) : this._hintNextClass(needs);
    }

    /**
     * Names of our own items the room has already hinted and not yet found,
     * so a hint is never bought twice.
     */
    _hintedItemNames() {
        const mine = this.client.players.self.slot;
        return new Set(
            (this.client.items.hints ?? [])
                .filter((hint) => !hint.found && hint.item.receiver.slot === mine)
                .map((hint) => hint.item.name),
        );
    }

    _hintNextStage(needs) {
        const hinted = this._hintedItemNames();
        const gate = Stage_Names[needs.stage];
        // Its own unlock first: without that the region count does not matter.
        if (needs.needsOwnUnlock) {
            if (hinted.has(`Unlock ${gate}`)) {
                this.log(`Unlock ${gate} is already hinted; nothing else to ask for until it is found.`, "info");
                return true;
            }
            return this._askServerToHint(`Unlock ${gate}`);
        }
        if (needs.heldInRegion >= needs.requiredInRegion) {
            this.log(`${needs.region} is already unlocked enough for ${gate}.`, "info");
            return true;
        }
        // Lowest id first, so it reads in progression order, skipping what the
        // room has already been told.
        const next = [...needs.missingStages]
            .sort((a, b) => a - b)
            .find((stage) => !hinted.has(`Unlock ${Stage_Names[stage]}`));
        if (next === undefined) {
            this.log(`Every missing ${needs.region} stage is already hinted.`, "info");
            return true;
        }
        return this._askServerToHint(`Unlock ${Stage_Names[next]}`);
    }

    _hintNextClass(needs) {
        if (!this.slotData.ranger_class_randomizer) {
            this.log("Class Randomizer is off, so there are no class unlocks to hint.", "info");
            return true;
        }
        if (needs.classesHeld >= needs.classesRequired) {
            this.log(`You already have the ${needs.classesRequired} classes that gate wants.`, "info");
            return true;
        }
        const held = window.ArchipelagoMod.rangerClassesUnlocked;
        const hinted = this._hintedItemNames();
        const missing = Object.values(this.RANGER_CLASSES).filter((name) => !held.has(name));
        if (missing.length === 0) {
            this.log("You already hold every ranger class.", "info");
            return true;
        }
        const next = missing.find((name) => !hinted.has(`Unlock ${name} Class`));
        if (!next) {
            this.log("Every missing ranger class is already hinted.", "info");
            return true;
        }
        return this._askServerToHint(`Unlock ${next} Class`);
    }

    /**
     * Why a barred stage cannot be entered: the first shut gate on the way to
     * it, and what that gate still lacks. Enforce Logic used to refuse the
     * click in silence.
     */
    _explainBlockedStage(stage) {
        const name = Stage_Names[stage];
        const needs = window.ArchipelagoMod.blockedStageNeeds?.(stage);
        if (!needs) {
            this.log(`${name} is out of logic.`, "info");
            return;
        }
        const gate = Stage_Names[needs.stage];
        const wants = [];
        if (needs.needsOwnUnlock) wants.push(`Unlock ${gate}`);
        const stagesShort = needs.requiredInRegion - needs.heldInRegion;
        if (stagesShort > 0) wants.push(`${stagesShort} more ${needs.region} stage${stagesShort === 1 ? "" : "s"}`);
        const classesShort = needs.classesRequired - needs.classesHeld;
        if (classesShort > 0) wants.push(`${classesShort} more ranger class${classesShort === 1 ? "" : "es"}`);
        const reason = wants.length > 0 ? ` -- it still wants ${wants.join(", ")}.` : ".";
        this.log(`${name} is barred: ${gate} is not open yet${reason}`, "info");
    }

    /** Hand it to Archipelago as an ordinary !hint, so it costs and shows as one. */
    _askServerToHint(itemName) {
        this.log(`Asking for a hint: ${itemName}`, "info");
        this.client.messages.say(`!hint ${itemName}`);
        return true;
    }

    _onSendClick() {
        const text = this.message.value.trim();
        if (text.length === 0) {
            return;
        }

        if (this._handleHintCommand(text)) {
            this.message.value = "";
            return;
        }

        this.client.messages.say(text);
        if (text[0] === "/") {
            this.log(
                "Cannot issue command " + text.slice(1).split(" ")[0] + ". Client commands are not yet supported.",
            );
        }
        this.message.value = "";
    }

    log(msg, type = "info") {
        const container = document.createElement("div");
        const span = document.createElement("span");
        span.textContent = msg;
        if (type === "error") {
            span.style.color = "red";
        }
        container.appendChild(span);
        container.style.lineHeight = "16px";
        this.chatMessages.append(container);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    isNumber(value) {
        return typeof value === "number";
    }

    _onUnload() {
        this.client?.socket.disconnect();
    }

    restoreStagesBeaten(savedStages) {
        for (let i = 0; i < savedStages.length; i++) {
            Stage_Status[i] |= savedStages[i];
        }
        antiCheatSet();
        return Stage_Status;
    }

    createRandomizedBookCosts(randomizerMode) {
        const result = {};
        const stageCount = Stage_Status.length;

        switch (randomizerMode) {
            case 1: {
                for (let stage = 0; stage < stageCount; stage++) {
                    const min = 100 * stage;
                    const max = 4000 * stage;

                    const r = Math.pow(Math.random(), 1.5);
                    const scaled = min + r * (max - min);

                    result[stage] = Math.max(1, Math.floor(scaled));
                }
                return result;
            }
            case 2: {
                for (let stage = 0; stage < stageCount; stage++) {
                    result[stage] = Math.floor(Math.random() * 99999) + 1;
                }
                return result;
            }
            case 3: {
                for (let stage = 0; stage < stageCount; stage++) {
                    result[stage] = Math.floor(Math.random() * 999999) + 1;
                }
                return result;
            }
            case 0:
            default:
                return {};
        }
    }

    isEmpty(obj) {
        for (const prop in obj) {
            if (Object.hasOwn(obj, prop)) {
                return false;
            }
        }

        return true;
    }

    die(source, cause) {
        this.log(`You died from ${source}'s death${cause ? `: ${cause}` : ""}.`, "error");

        for (let i = 0; i < 4; i++) {
            LP_Current[i] = 0;
        }

        this.deathLinkSource = "";
        this.deathLinkTime = "";
        this.deathLinkCause = "";

        antiCheatSet();
    }

    /** Treat shop locations the server already has as sent.
     *
     *  The server's view outranks this browser's: a location checked from
     *  another machine, from a cleared save, or released by hand must not be
     *  offered as a check again, or the cell would keep showing the logo and
     *  buying it would spend gold on a location that is already gone. */
    adoptCheckedShopLocations() {
        for (const id of this.client?.room?.checkedLocations ?? []) {
            if (id >= this.SHOP_OFFSET && id < this.SHOP_OFFSET + 1000) {
                window.ArchipelagoMod.shopIdsSent.add(id - this.SHOP_OFFSET);
            }
        }
    }

    /** Whether this seed carries shop locations, which only Shop Checks creates.
     *  Used to recover seeds generated before the option reached slot_data. */
    seedHasShopLocations() {
        const all = this.client?.room?.allLocations ?? [];
        return all.some((id) => id >= this.SHOP_OFFSET && id < this.SHOP_OFFSET + 1000);
    }

    async _connect() {
        this.client = new Client();
        const host = this.host.value;
        const port = parseInt(this.port.value);
        const game = "Stick Ranger";
        const slot = this.slotName.value;
        const password = this.password.value;
        const url = `${host}:${port}`;

        this.client.socket.on("receivedItems", async (packet) => {
            const serverItems = packet.items.map((i) => i.item);

            // class unlocks
            const receivedItemsSet = new Set(this.receivedItems);
            serverItems.forEach((item) => {
                const name = this.RANGER_CLASSES[item];
                if (name) {
                    if (!receivedItemsSet.has(item)) {
                        this.receivedItems.push(item);
                    }
                    antiCheatSet();
                }
            });

            this._serverItemsQueue.push({ index: packet.index, items: serverItems });
        });

        this.client.socket.on("locationInfo", (locationInfoPacket) => {
            locationInfoPacket.locations.forEach((networkItem) => {
                // Per item: one hint that cannot be built must not cost the
                // rest of the packet theirs, which is how a single throw left a
                // run of shop cells with nothing to say.
                try {
                    if (networkItem.location >= this.SHOP_OFFSET) {
                        this.shopHints[networkItem.location - this.SHOP_OFFSET] = this._hintFor(networkItem);
                    } else if (
                        networkItem.location >= this.BOOK_OFFSET &&
                        networkItem.location < this.BOOK_OFFSET + 100
                    ) {
                        this.bookHints[networkItem.location - this.BOOK_OFFSET] = this._hintFor(networkItem);
                    }
                } catch (error) {
                    console.error("Could not read a hint for location", networkItem.location, error);
                }
            });
        });

        this.client.socket.on("printJSON", (printJSONPacket) => {
            const container = document.createElement("div");
            if (printJSONPacket.item) {
                const connectedPlayerId = this.slotData.player_id;
                printJSONPacket.data.forEach((el) => {
                    const span = document.createElement("span");
                    if (el.type === "player_id") {
                        const pid = Number(el.text);
                        span.textContent = this.client.players.findPlayer(pid)?.name;
                        if (pid === connectedPlayerId) {
                            span.style.color = "#ee00ee";
                        } else {
                            span.style.color = "#eee8cd";
                        }
                    } else if (el.type === "item_id") {
                        span.textContent = this.client.package.lookupItemName(
                            this.client.players.findPlayer(el.player).game,
                            Number(el.text),
                        );
                        span.style.color = itemColor(printJSONPacket.item.flags);
                    } else if (el.type === "location_id") {
                        span.textContent = this.client.package.lookupLocationName(
                            this.client.players.findPlayer(el.player).game,
                            Number(el.text),
                        );
                        span.style.color = "limegreen";
                    } else if (el.text) {
                        span.textContent = el.text;
                    }
                    container.appendChild(span);
                });
            } else if (printJSONPacket.type === "CommandResult") {
                const pre = document.createElement("pre");
                pre.textContent = printJSONPacket.data[0].text;
                pre.style.margin = 0;
                container.appendChild(pre);
            } else {
                const span = document.createElement("span");
                span.textContent = printJSONPacket.data[0].text;
                container.appendChild(span);
            }

            container.style.lineHeight = "16px";
            this.chatMessages.appendChild(container);
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        });

        this.client.deathLink.on("deathReceived", (source, time, cause) => {
            this.deathLinkReceived = true;
            this.deathLinkPending = true;
            this.deathLinkSource = source;
            this.deathLinkTime = time;
            this.deathLinkCause = cause;
        });

        this.client.socket.on("disconnected", async () => {
            this._onDisconnect();
        });

        this.client.socket.on("bounced", (packet) => {
            this._onRingLinkBounce(packet);
        });

        this.client.socket.on("invalidPacket", (packet) => {
            console.warn("Invalid packet");
            console.log(packet);
        });

        this.client.socket.on("connectionRefused", (packet) => {
            packet.errors.forEach((error) => {
                this.log(error + "; please verify your connection settings.", "error");
            });
        });

        try {
            window.ArchipelagoMod.pendingSave = false;
            window.ArchipelagoMod.pendingAPItemDrops = [];
            window.ArchipelagoMod.pendingAPShopDrops = [];
            window.ArchipelagoMod.pendingClassSwapItems = [];
            this.slotData = await this.client.login(url, slot, game, {
                password,
                itemsHandlingFlags: itemsHandlingFlags.all,
                tags: ["AP"],
                slotData: true,
            });
            console.log("Slot data: ", this.slotData);

            await this.loadAPData();
            this._connected = true;
            this._saveConnectionInfo();

            // Which apworld made the seed. LEGACY (remove after 2026-11): a seed
            // from before 1.8.12 carries no version, and every branch that
            // exists only for those checks this flag.
            const legacy = legacySeed(this.slotData);
            window.ArchipelagoMod.legacySeed = legacy;
            window.ArchipelagoMod.worldVersion = this.slotData.world_version ?? null;
            const notice = versionNotice(this.slotData.world_version, SITE_VERSION);
            if (notice) this.log(notice.text, notice.level);
            // An option wired through generation but never shipped runs at its
            // default here without a trace, which is how Shop Checks did
            // nothing for a week in 1.7.0. Say so instead.
            if (!legacy) {
                for (const key of missingSlotDataKeys(this.slotData)) {
                    this.log(`This seed does not carry "${key}"; that option runs at its default here.`, "error");
                }
            }

            this.setStagesToWinFromGoal();
            window.ArchipelagoMod.rangerClassRandomizer = this.slotData.ranger_class_randomizer ?? 0;
            window.ArchipelagoMod.rangerClassesUnlocked = this.getUnlockedClasses();
            window.ArchipelagoMod.shuffleBooks = this.slotData.shuffle_books ?? 0;
            window.ArchipelagoMod.shuffleEnemies = this.slotData.shuffle_enemies ?? 0;
            window.ArchipelagoMod.enemyIdsSent = window.ArchipelagoMod.enemyIdsSent ?? new Set([]);
            window.ArchipelagoMod.goldMultiplier = this.slotData.gold_multiplier ?? 1;
            window.ArchipelagoMod.xpMultiplier = this.slotData.xp_multiplier ?? 1;
            window.ArchipelagoMod.dropMultiplier = this.slotData.drop_multiplier ?? 1;
            this.shopHintsMode = resolveShopHints(this.slotData);
            this.sendShopHints = this.shopHintsMode !== SHOP_HINTS_OFF;
            window.ArchipelagoMod.itemColor = itemColorValue;
            window.ArchipelagoMod.bookHintSpoiler = this.bookHints ?? {};
            const bookCostRandomizer = this.slotData.randomize_book_costs ?? 0;
            window.ArchipelagoMod.bookCostRandomizer = bookCostRandomizer;
            if (this.isEmpty(this.randomizedBookCosts)) {
                this.randomizedBookCosts = this.createRandomizedBookCosts(bookCostRandomizer);
            }
            window.ArchipelagoMod.randomizedBookCosts = this.randomizedBookCosts ?? {};
            window.ArchipelagoMod.removeNullCompo = this.slotData.remove_null_compo ?? 1;
            window.ArchipelagoMod.removableCompos = this.slotData.removable_compos ?? 0;
            window.ArchipelagoMod.freeRespec = this.slotData.free_respec ?? 0;
            // How each shop opens, straight from the seed.
            // LEGACY (remove after 2026-11): absent on a seed from before the
            // shops had a track each.
            window.ArchipelagoMod.shopProgression = this.slotData.shop_progression ?? null;
            // The whole payload, for the console. An option missing here rather
            // than being 0 means the seed was generated before that option
            // existed, and no yaml setting can bring it back without a regen.
            window.ArchipelagoMod.slotData = this.slotData;
            // LEGACY (remove after 2026-11): seeds generated before 1.8.1 never
            // shipped this option, which left the feature dead: the locations
            // existed, so they showed up in the tracker, but the client read
            // the absent key as off and never sent one. The seed's own location
            // list says whether the shop is in play, so those runs recover
            // without regenerating.
            window.ArchipelagoMod.shopChecks = resolveShopChecks(this.slotData, () => this.seedHasShopLocations());
            if (legacy && this.slotData.shop_checks === undefined && window.ArchipelagoMod.shopChecks) {
                this.log("Shop Checks recovered from this seed's locations; buying sends checks again.", "info");
            }
            this.adoptCheckedShopLocations();
            // Neither means anything without shop checks: nothing in logic sits
            // behind a row then, so the shop is neither gated nor greyed.
            window.ArchipelagoMod.progressiveShop = resolveProgressiveShop(
                this.slotData,
                window.ArchipelagoMod.shopChecks,
            );
            window.ArchipelagoMod.enforceShopLogic = resolveEnforceShopLogic(
                this.slotData,
                window.ArchipelagoMod.shopChecks,
            );
            // The seed's own logic. LEGACY (remove after 2026-11): absent on a
            // seed generated before 1.8.0, in which case the map falls back to
            // plain unlocked/done colouring. A block in a shape this site does
            // not know is treated the same way, and said so.
            const logic = this.slotData.logic ?? null;
            const logicProblem = logicNotice(logic);
            if (logicProblem) this.log(logicProblem, "error");
            window.ArchipelagoMod.logic = logicProblem ? null : logic;
            window.ArchipelagoMod.enforceLogic = this.slotData.enforce_logic ?? 0;
            if (window.ArchipelagoMod.enforceLogic && !window.ArchipelagoMod.logic) {
                this.log(
                    "Enforce Logic is on, but this seed carries no logic this site can evaluate, so nothing is barred.",
                    "error",
                );
            }
            // Ring Link's payout, so nothing without Ring Link.
            window.ArchipelagoMod.ringGold = resolveRingGold(this.slotData);
            window.ArchipelagoMod.ringLink = this.slotData.ring_link ?? 0;
            window.ArchipelagoMod.ringLinkRatio = this.slotData.ring_link_ratio ?? 100;
            window.ArchipelagoMod.pendingRingLinkGold = 0;
            this.ringSource = Math.floor(Math.random() * 2 ** 31);
            this.lastRingFlush = Date.now();
            if (legacy && !window.ArchipelagoMod.logic) {
                this.log("This seed predates logic colouring; stages show as unlocked or done.", "info");
            }
            window.ArchipelagoMod.shopHints = this.sendShopHints;
            window.ArchipelagoMod.shopHintSpoiler = this.shopHints;
            this._refreshProgressiveShop();

            // One updateTags call for every link, because it replaces the whole
            // list -- setting them separately would have the last one win.
            const tags = ["AP"];
            if (window.ArchipelagoMod.ringLink) {
                tags.push("RingLink");
            }
            if (this.slotData.death_link) {
                this.client.deathLink.enableDeathLink();
                tags.push("DeathLink");
            }
            this.client.updateTags(tags);

            if (Item_Inv[this.MOUSE_SLOT]) {
                // Guard against having an item in hand on connect, if inventory was full on disconnect
                this.connectMouseItem = {
                    itemId: Item_Inv[this.MOUSE_SLOT],
                    compo1: Comp1_Inv[this.MOUSE_SLOT],
                    compo2: Comp2_Inv[this.MOUSE_SLOT],
                };

                Item_Inv[this.MOUSE_SLOT] = 0;
                Comp1_Inv[this.MOUSE_SLOT] = 0;
                Comp2_Inv[this.MOUSE_SLOT] = 0;
                antiCheatSet();
                await this.saveAPData();
                this.log(
                    "Storing mouse item (" +
                        Item_Catalogue[this.connectMouseItem.itemId][0] +
                        ") to be recovered when in-game again.",
                    "info",
                );
            }

            this.chatLine.style.display = "flex";
            antiCheatSet();
        } catch (error) {
            if (Array.isArray(error) && error[0]?.target instanceof WebSocket) {
                this.log(
                    "Cannot connect to: " +
                        error[0].target.url +
                        " Please check the hostname and port, or the server's online status.",
                    "error",
                );
            } else {
                this.log("Unknown error during connection: " + error, "error");
            }
            this._connected = false;
            Sequence_Step = 0;
            this.apDiv.style.display = "flex";
            this.connectionBox.style.display = "none";
            this.chatLine.style.display = "none";
        }
    }

    /**
     * The classes the team has, starting class included -- class_count() in the
     * apworld's rules.py counts it the same way.
     *
     * A Set, because every class item passes through _applyItem more than once
     * (the queue applies it, then the reconnect pass applies it again, on top of
     * whatever loadAPData already restored). An array would grow on every pass
     * and quietly satisfy class gates the generator never opened.
     */
    getUnlockedClasses() {
        const unlocked = new Set([this.slotData.ranger_class_selected]);
        for (const id of this.receivedItems) {
            const name = this.RANGER_CLASSES[id];
            if (name) {
                unlocked.add(name);
            }
        }
        return unlocked;
    }

    /**
     * Sets the stages required to win based on the selected goal.
     * Should be called whenever slotdata is updated (e.g., after connecting, or when slotdata changes).
     */
    setStagesToWinFromGoal() {
        // Mapping for goal options, as per server logic
        const goalStageMap = {
            0: [88], // Hell Castle
            1: [89], // Volcano
            2: [55], // Mountaintop
            3: [88, 89], // Hell Castle + Volcano
            4: [88, 55], // Hell Castle + Mountaintop
            5: [89, 55], // Volcano + Mountaintop
            6: [88, 89, 55], // All
        };
        const goal = this.slotData.goal ?? 0; // fallback to 0 if undefined
        this.stagesToWin = goalStageMap[goal] || [88];
    }

    async sendLocation(id) {
        if (this._disconnected || !this.client.authenticated) return;

        this.client.check(id);
        await this.saveAPData();
    }

    async _applyItem(id, firstTime) {
        // class unlocks
        const name = this.RANGER_CLASSES[id];
        if (name) {
            window.ArchipelagoMod.rangerClassesUnlocked.add(name);
            if (firstTime) {
                this.receivedItems.push(id);
            }
        }

        if (this._isProgressiveShopItem(id)) {
            if (firstTime) {
                this.receivedItems.push(id);
            }
            this._refreshProgressiveShop();
        }

        // location unlock
        if (id >= this.LOC_OFFSET && id < this.LOC_OFFSET + 999) {
            Stage_Status[id - this.LOC_OFFSET] |= Unlocked;
            if (firstTime) {
                this.receivedItems.push(id);
            }
            antiCheatSet();
        }

        // item grant
        else if (id >= this.ITEM_OFFSET && id < this.ITEM_OFFSET + 999 && firstTime) {
            const idx = id - this.ITEM_OFFSET;
            const slot = this._firstEmptyInvSlot();
            if (slot >= 0) {
                this.receivedItems.push(id);
                Item_Inv[slot] = idx;
                antiCheatSet();
            } else {
                this.pendingItems.push(id);
            }
        }

        // The map keeps its gate answers for a frame; an item can move them.
        window.ArchipelagoMod.forgetOpenGates?.();
        await this.saveAPData(); //TODO maybe only save if firsttime? it seems to save a lot of times on reconnect
    }

    isInPlayableSequenceStep() {
        return [12, 52, 53, 54, 55].includes(Sequence_Step);
    }

    async _applyTrap(id) {
        console.log("Applying trap: " + id);
        if (this.isInPlayableSequenceStep()) {
            this.receivedItems.push(id);
            switch (id) {
                case 13000: // Unequip items
                    this.unequipItems();
                    break;
                case 13001: // -50% gold
                    this.loseHalfGold();
                    break;
                case 13002: // Kill a Ranger
                    this.killRanger();
                    break;
                case 13003: // Freeze Rangers
                    this.freezeRangers();
                    break;
                case 13004: // Spawn enemies
                    this.spawnEnemies();
                    break;
                default:
                    break;
            }
        } else {
            this.pendingTraps.push(id);
        }

        await this.saveAPData();
        antiCheatSet();
    }

    unequipItems() {
        const equippedRangers = [4, 5, 6, 7].filter((i) => Item_Inv[i]);
        if (equippedRangers.length === 0) return;

        const shuffle = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        const moveItemWithCompos = (from, to) => {
            const item = Item_Inv[from];
            const comp1 = Comp1_Inv[from];
            const comp2 = Comp2_Inv[from];

            Item_Inv[to] = item;
            Comp1_Inv[to] = comp1;
            Comp2_Inv[to] = comp2;

            Item_Inv[from] = 0;
            Comp1_Inv[from] = 0;
            Comp2_Inv[from] = 0;
            antiCheatSet();
        };

        const unequipToMouse = () => {
            if (equippedRangers.length > 0 && Item_Inv[this.MOUSE_SLOT] === 0) {
                const selectedRanger = equippedRangers.shift();
                moveItemWithCompos(selectedRanger, this.MOUSE_SLOT);
                MP_Bar[selectedRanger] = 0;
                Players.PL_gladr_resid_count[selectedRanger] = 0;
                antiCheatSet();
            }
        };

        const emptySlots = [];
        for (let i = this.INV_START; i < Item_Inv.length; i++) {
            if (i !== this.MOUSE_SLOT && !Item_Inv[i]) {
                emptySlots.push(i);
            }
        }

        shuffle(equippedRangers);
        shuffle(emptySlots);

        if (emptySlots.length < 4 && Item_Inv[this.MOUSE_SLOT] === 0) {
            unequipToMouse();
        }

        const unequipCount = Math.min(emptySlots.length, equippedRangers.length);
        for (let i = 0; i < unequipCount; i++) {
            const selectedRanger = equippedRangers.shift();
            moveItemWithCompos(selectedRanger, emptySlots[i]);
            MP_Bar[selectedRanger] = 0;
            Players.PL_gladr_resid_count[selectedRanger] = 0;
            antiCheatSet();
        }
    }

    loseHalfGold() {
        const lostGold = Math.floor(Team_Gold / 2);
        // Not through the Ring Link seam: the trap is Archipelago's doing, and
        // broadcasting it would halve every linked player's gold too.
        window.ArchipelagoMod.applyTrapGold(-lostGold);
        this.log("You lost $" + lostGold + "!", "error");
        Indicators.INadd(
            Players.PL_joint[Selected_Player][0].x,
            Players.PL_joint[Selected_Player][0].y,
            0,
            "-$" + lostGold,
            0xff3f3f,
        );
        antiCheatSet();
    }

    killRanger() {
        const aliveRangers = [0, 1, 2, 3].filter((i) => LP_Current[i] > 0);

        if (aliveRangers.length === 0) {
            return;
        }

        const target = aliveRangers[Math.floor(Math.random() * aliveRangers.length)];
        LP_Current[target] = 0;
        antiCheatSet();
    }

    freezeRangers() {
        for (let i = 0; i < Stickmen_Slots; i++) {
            const randomTicks = Math.floor(Math.random() * 750) + 1;
            Players.PL_frozen_ticks[i] = randomTicks;
            antiCheatSet();
        }
    }

    /**
     * Enemy ids the trap is allowed to spawn.
     *
     * Excludes the invisible boss attacks, and diggers (species 17) -- a digger
     * spawned outside its own stage burrows and can leave the screen in a state
     * the player cannot clear.
     *
     * Built once and cached: picking from this list beats the old do/while,
     * which re-rolled until it missed the excluded ids.
     */
    _spawnableEnemyIds() {
        if (!this._spawnableIds) {
            const invisibleBossAttacks = new Set([40, 115, 163, 244, 333, 334, 335, 336, 337, 339]);
            this._spawnableIds = [];
            for (let id = 1; id <= 338; id++) {
                if (invisibleBossAttacks.has(id)) continue;
                if (EN_Info[id] && EN_Info[id][EN_Species] === 17) continue;
                this._spawnableIds.push(id);
            }
        }
        return this._spawnableIds;
    }

    spawnEnemies() {
        const spawnable = this._spawnableEnemyIds();
        const spawnAmount = this.randomRangeInt(3, 10);
        for (let i = 0; i < spawnAmount; i++) {
            const randomType = spawnable[this.randomRangeInt(0, spawnable.length - 1)];
            const en_xpos = Math.floor(Math.random() * ((Win_Width >> 3) - 4 - 12 + 1)) + 12;
            const en_ypos = fiftyfifty(Terrain.TR_low_surface[en_xpos], Terrain.TR_high_surface[en_xpos]);

            Enemies.ENadd(en_xpos, en_ypos, randomType);
        }
    }

    _firstEmptyInvSlot() {
        for (let i = this.INV_START; i < Item_Inv.length; i++) {
            if (i === this.MOUSE_SLOT) continue;
            if (!Item_Inv[i]) return i;
        }
        return -1;
    }

    async _flushPending() {
        let slot;
        while (this.pendingItems.length && (slot = this._firstEmptyInvSlot()) >= 0) {
            const id = this.pendingItems.shift();
            console.log("Receiving " + this.pendingItems.length + " items: ", id);
            this.receivedItems.push(id);
            const idx = id - this.ITEM_OFFSET;
            Item_Inv[slot] = idx;
            antiCheatSet();
            await this.saveAPData();
        }
    }

    /**
     * Scout locations, hinting the room only about what is worth hearing.
     *
     * An item's classification is not known until it has been scouted, so with
     * Shop Hints on important only this looks first with create_as_hint 0 --
     * which still fills our own display through the locationInfo handler --
     * and then scouts the progression and trap ones again to create the
     * hints. A seed with Shop Checks has 462 shop items, and hinting every one
     * of them buries everybody else's hints.
     */
    async _scoutAndHint(locations) {
        if (locations.length === 0) return;
        // Everything at once when the room may hear about all of it. A
        // disguised trap must never be hinted -- the hint carries its real
        // name -- so with Trap Disguise on even "all" has to look first.
        if (this.shopHintsMode === SHOP_HINTS_ALL && !this.slotData.trap_disguise) {
            await this.client.scout(locations, 2);
            return;
        }

        const scouted = await this.client.scout(locations, 0);
        const worthHinting = scouted.filter((item) => this._worthHinting(item)).map((item) => item.locationId);
        if (worthHinting.length > 0) {
            await this.client.scout(worthHinting, 2);
        }
    }

    /**
     * Whether the room is told about a scouted item: everything when Shop
     * Hints is on all, progression and traps when important only -- and never
     * a trap while Trap Disguise is on, since that hint would name it.
     */
    _worthHinting(item) {
        if (item.trap) return !this.slotData.trap_disguise;
        return this.shopHintsMode === SHOP_HINTS_ALL || item.progression;
    }

    /**
     * What a shop shelf or book page says is waiting at a location.
     *
     * With Trap Disguise on, a trap borrows some other item's name from the
     * room and wears it misspelled, and is coloured as progression to match --
     * a trap-red name would give the game away on its own.
     */
    _hintFor(networkItem) {
        const owner = this.client.players.findPlayer(networkItem.player);
        const hint = {
            player: owner.name,
            item: this.client.package.lookupItemName(owner.game, networkItem.item),
            itemClassification: networkItem.flags,
            sprite: this._stickRangerSprite(owner.game, networkItem.item),
        };

        const isTrap = (networkItem.flags & 0b100) !== 0;
        if (isTrap && this.slotData.trap_disguise) {
            // The base record is already built, so a disguise that cannot be
            // made costs the trap its cover and nothing else.
            try {
                const disguise = disguiseFor(networkItem.location, this._decoyNames(), this.client.room.seedName);
                if (disguise !== null) {
                    // Its own sprite would give it away, and wearing the sprite
                    // of what it pretends to be is a lie the shelf cannot take
                    // back.
                    hint.item = disguise;
                    hint.itemClassification = 0b001;
                    hint.sprite = null;
                }
            } catch (error) {
                console.error("Could not disguise the trap at", networkItem.location, error);
            }
        }

        // Progression and traps both wear the marked tile, from any game in the
        // room. Reading it off the classification we ended up with rather than
        // the one that arrived means a disguised trap still looks like the
        // progression item it is pretending to be.
        hint.marked = (hint.itemClassification & 0b101) !== 0;
        return hint;
    }

    /**
     * The catalogue id to draw for a hinted item, or null.
     *
     * Only Stick Ranger's own items have a sprite we can show, but any Stick
     * Ranger slot will do -- the item codes are the same in every one of them,
     * so another player's sword is drawn as our sword.
     */
    _stickRangerSprite(game, itemId) {
        if (game !== "Stick Ranger") return null;
        if (itemId < this.ITEM_OFFSET || itemId >= this.ITEM_OFFSET + 999) return null;
        return itemId - this.ITEM_OFFSET;
    }

    /**
     * Every item name in the room, for traps to hide behind. Built once --
     * the data package does not change mid-session, and there are thousands.
     */
    _decoyNames() {
        // Cached only once there is something to cache: an empty array is
        // truthy, so caching one before the data package arrived would leave
        // every trap undisguised for the rest of the session.
        if (this._decoys?.length) return this._decoys;

        const names = new Set();
        // The room knows which games are in it; the data package only knows how
        // to look one up. Asking the package for the list returned undefined,
        // which threw and took the whole hint out with it.
        for (const game of this.client.room.games ?? []) {
            const pkg = this.client.package.findPackage(game);
            for (const [name, id] of Object.entries(pkg?.item_name_to_id ?? {})) {
                // Our own traps stay out of it: a trap wearing a misspelled
                // trap name, coloured as progression, contradicts itself.
                if (game === "Stick Ranger" && id >= this.TRAPS_OFFSET && id < this.TRAPS_OFFSET + 1000) continue;
                names.add(name);
            }
        }
        this._decoys = [...names].sort();
        return this._decoys;
    }

    async scoutBooksOnShopOpen() {
        console.log("Scouting books");
        // TODO check if works in both states
        if (this.slotData.shuffle_books === 1) {
            // Book shuffle
            const unscouted = [];
            for (let i = 0; i < Stage_Status.length; i++) {
                if (this.excludedBookStages.includes(i)) {
                    continue;
                }

                if (Stage_Status[i] === 3 && !this.bookHints[i]) {
                    unscouted.push(this.BOOK_OFFSET + i);
                }
            }
            await this._scoutAndHint(unscouted);
            await this.saveAPData();
        }
    }

    /**
     * Scout everything the shop currently stocks, once per item.
     *
     * Cached in DataStorage next to bookHints, so the expensive pass is the
     * first shop visit -- later ones only scout rows that Progressive Shop has
     * opened since.
     */
    async scoutShopOnOpen() {
        if (!window.ArchipelagoMod.shopChecks || !this.sendShopHints) return;
        const town = window.ArchipelagoMod.shopTownIndex(Current_Stage);
        if (town < 0) return;

        const unscouted = window.ArchipelagoMod.shopStockedItemIds(town).filter(
            (id) => !this.shopHints[id] && !window.ArchipelagoMod.shopIdsSent.has(id),
        );
        if (unscouted.length === 0) return;

        console.log(`Scouting ${unscouted.length} shop items`);
        await this._scoutAndHint(unscouted.map((id) => id + this.SHOP_OFFSET));
        await this.saveAPData();
    }

    /**
     * Counters for Ring Link, readable from the console as
     * window.ArchipelagoMod.ringLinkStats.
     *
     * Every way a bounce can be discarded is counted separately, because when
     * the link goes quiet the useful question is which guard ate it -- the
     * packet arriving and being dropped looks identical from the outside to the
     * packet never arriving.
     */
    _ringLinkStats() {
        window.ArchipelagoMod.ringLinkStats ??= {
            // Compare this between the two clients: identical means every
            // packet from the other player is discarded as your own echo.
            source: null,
            sent: 0,
            sentGold: 0,
            received: 0,
            receivedGold: 0,
            droppedDisabled: 0,
            droppedWrongTag: 0,
            droppedOwnEcho: 0,
            droppedZero: 0,
            lastSentAt: null,
            lastReceivedAt: null,
            // Why a flush sent nothing.
            skippedOffline: 0,
            skippedDisabled: 0,
            skippedThrottled: 0,
            skippedEmpty: 0,
            skippedNoSource: 0,
        };
        return window.ArchipelagoMod.ringLinkStats;
    }

    /**
     * Inbound Ring Link: someone else's rings become gold here.
     *
     * Applied through applyRingLinkGold, which does not add to the pending
     * total, so it is never rebroadcast -- two linked Stick Rangers would
     * otherwise amplify each other without limit.
     */
    _onRingLinkBounce(packet) {
        const stats = this._ringLinkStats();
        if (!window.ArchipelagoMod.ringLink) {
            stats.droppedDisabled++;
            return;
        }
        if (!(packet.tags || []).includes("RingLink")) {
            stats.droppedWrongTag++;
            return;
        }

        const data = packet.data || {};
        // The server echoes our own Bounce back to us, so drop it. Comparing an
        // unset source would match every other player's packet, which is what a
        // stray reset did: both clients went null and threw each other away.
        if (this.ringSource !== null && data.source === this.ringSource) {
            stats.droppedOwnEcho++;
            return;
        }

        const rings = Number(data.amount);
        const gold = Number.isFinite(rings) ? Math.trunc(rings * (window.ArchipelagoMod.ringLinkRatio || 100)) : 0;
        if (gold === 0) {
            stats.droppedZero++;
            return;
        }

        stats.received++;
        stats.receivedGold += gold;
        stats.lastReceivedAt = new Date().toISOString();
        window.ArchipelagoMod.applyRingLinkGold(gold);
        this.log(`RingLink: ${rings > 0 ? "+" : ""}${rings} rings (${gold > 0 ? "+" : ""}$${gold})`, "info");
    }

    /**
     * Outbound Ring Link, on a timer rather than per gold change.
     *
     * Gold moves constantly here -- every enemy drop, every gun shot, every
     * thrown ring -- so one Bounce per change would be dozens a second. The
     * pending total is accumulated first and floored second, so ten $40 gun
     * shots become 4 rings rather than ten lots of zero, and the sub-ratio
     * remainder is kept for next time.
     */
    async _flushRingLink() {
        const stats = this._ringLinkStats();
        stats.source = this.ringSource;
        if (!this._connected || !this.client?.authenticated) {
            stats.skippedOffline++;
            return;
        }
        if (!window.ArchipelagoMod.ringLink) {
            // Nothing will ever send it, so do not let it accumulate all session.
            window.ArchipelagoMod.pendingRingLinkGold = 0;
            stats.skippedDisabled++;
            return;
        }
        // Without an id the other end cannot tell our packets from its own, so
        // stay quiet and be countable rather than poison the room.
        if (this.ringSource === null) {
            stats.skippedNoSource++;
            return;
        }
        if (Date.now() - this.lastRingFlush < RING_LINK_FLUSH_MS) {
            stats.skippedThrottled++;
            return;
        }

        const ratio = window.ArchipelagoMod.ringLinkRatio || 100;
        const pending = window.ArchipelagoMod.pendingRingLinkGold || 0;
        const rings = Math.trunc(pending / ratio);
        // Nothing to send yet: leave the timer alone so the next gold movement
        // goes out at once instead of waiting for the following window.
        if (rings === 0) {
            stats.skippedEmpty++;
            return;
        }

        // Both of these land before the await, so an overlapping tick sees them.
        this.lastRingFlush = Date.now();
        window.ArchipelagoMod.pendingRingLinkGold = pending - rings * ratio;
        stats.sent++;
        stats.sentGold += rings * ratio;
        stats.lastSentAt = new Date().toISOString();
        await this.client.socket.send({
            cmd: "Bounce",
            tags: ["RingLink"],
            data: { time: Date.now() / 1000, amount: rings, source: this.ringSource },
        });
    }

    _tick() {
        if (!this._disconnected) {
            // One tick body at a time. A body that awaits a scout or a save
            // spans frames, and a second one starting underneath it sees the
            // same "the sequence step just changed" and fires it again.
            if (!this._tickBusy) {
                this._tickBusy = true;
                this._doTickWork()
                    .catch((err) => {
                        console.error("Tick error:", err);
                    })
                    .finally(() => {
                        this._tickBusy = false;
                    });
            }
            // Ring Link is time-gated and self-contained, so it runs on its own
            // rather than last in _doTickWork. It used to sit behind four saves
            // and two location sends in a single promise: one slow save and the
            // flush never ran that tick, and as the save payload grew the link
            // quietly stopped sending with nothing in the console to show it.
            this._flushRingLink().catch((err) => {
                console.error("Ring Link flush error:", err);
            });
        }

        requestAnimationFrame(this._tick);
    }

    async _doTickWork() {
        if (this._connected && this.client && this.client.authenticated) {
            if (Sequence_Step === 6 && this.lastSequence === 4) {
                console.log("New game detected");
                this.receivedItems = [];
                if (this.slotData.ranger_class_randomizer === 1) {
                    this.unlockForgetTree = true;
                }
            }

            if (this.unlockForgetTree) {
                this.unlockForgetTree = false;
                Stage_Status[70] |= Unlocked;
                antiCheatSet();
            }

            if (Sequence_Step >= 6) {
                while (this._serverItemsQueue.length) {
                    const { index, items } = this._serverItemsQueue.shift();
                    const isReconnect = index === 0 && this.receivedItems.length > 0;

                    for (const id of items) {
                        // TODO Because of this we do _applyItem twice every time (also saving twice)
                        await this._applyItem(id, false);
                    }

                    if (isReconnect) {
                        const newItems = [...items];
                        for (const id of this.receivedItems) {
                            const index = newItems.indexOf(id);
                            if (index !== -1) newItems.splice(index, 1);
                        }
                        for (const id of newItems) {
                            if (id >= this.TRAPS_OFFSET && id < this.TRAPS_OFFSET + 10) {
                                await this._applyTrap(id);
                            } else {
                                await this._applyItem(id, true);
                            }
                        }
                    } else {
                        for (const id of items) {
                            if (id >= this.TRAPS_OFFSET && id < this.TRAPS_OFFSET + 10) {
                                await this._applyTrap(id);
                            } else {
                                await this._applyItem(id, true);
                            }
                        }
                    }
                }
            }

            // scan beaten/booked changes
            for (let i = 0; i < Stage_Status.length; i++) {
                if ((this.prevStage[i] & Beaten) === 0 && (Stage_Status[i] & Beaten) !== 0) {
                    console.log("Sending stage " + i + " as beaten"); // TODO do not send town stages
                    await this.sendLocation(i + this.STAGE_COMPLETE_OFFSET);
                } // TODO check if works in both states
                if (this.slotData.shuffle_books === 1) {
                    // Book shuffle
                    if ((this.prevStage[i] & Booked) === 0 && (Stage_Status[i] & Booked) !== 0) {
                        console.log("Sending stage " + i + " as booked");
                        await this.sendLocation(i + this.BOOK_OFFSET);
                    }
                }
            }
            this.prevStage = [...Stage_Status];

            // flush inventory
            await this._flushPending();

            if (this.isInPlayableSequenceStep() && this.pendingTraps.length !== 0) {
                while (this.pendingTraps.length > 0) {
                    this._applyTrap(this.pendingTraps.shift());
                }
            }

            // report win
            if (!this.winReported && this.stagesToWin.every((stageId) => (Stage_Status[stageId] & Beaten) === Beaten)) {
                this.winReported = true;
                this.client?.goal();
            }

            if (this.client.deathLink.enabled) {
                if (Sequence_Step >= 11 && Sequence_Step <= 13 && this.deathLinkPending) {
                    this.deathLinkPending = false;
                    this.die(this.deathLinkSource, this.deathLinkCause);
                }

                if (Sequence_Step === 30 && !this.deathLinkSent && !this.deathLinkReceived) {
                    this.log("DeathLink: Sending death to your friends...");
                    this.deathLinkSent = true;
                    this.client.deathLink.sendDeathLink(
                        this.slotData.player_name,
                        this.slotData.player_name + " was defeated in Stick Ranger.",
                    );
                }

                if (Sequence_Step < 6) {
                    this.deathLinkSent = false;
                    this.deathLinkReceived = false;
                    this.deathLinkPending = false;
                }
            }

            // On Game Over, place any item inside the Mouse Slot into a queue to go back into the inventory, and clear the trap queue
            if (Sequence_Step === 30) {
                if (Item_Inv[this.MOUSE_SLOT]) {
                    this.deathMouseItem = {
                        itemId: Item_Inv[this.MOUSE_SLOT],
                        compo1: Comp1_Inv[this.MOUSE_SLOT],
                        compo2: Comp2_Inv[this.MOUSE_SLOT],
                    };

                    Item_Inv[this.MOUSE_SLOT] = 0;
                    Comp1_Inv[this.MOUSE_SLOT] = 0;
                    Comp2_Inv[this.MOUSE_SLOT] = 0;
                    antiCheatSet();
                    await this.saveAPData();
                    this.log(
                        "Storing mouse item (" +
                            Item_Catalogue[this.deathMouseItem.itemId][0] +
                            ") to be recovered when in-game again.",
                        "info",
                    );
                }

                // Reset pending traps, to not trap the player upon connect again
                this.pendingTraps = [];
            }

            // Replace mouse item on death into inventory once it's all available
            if (this.isInPlayableSequenceStep() && this.deathMouseItem?.itemId > 0) {
                const firstEmptyInvSlot = this._firstEmptyInvSlot();
                if (firstEmptyInvSlot !== -1) {
                    Item_Inv[firstEmptyInvSlot] = this.deathMouseItem.itemId;
                    Comp1_Inv[firstEmptyInvSlot] = this.deathMouseItem.compo1;
                    Comp2_Inv[firstEmptyInvSlot] = this.deathMouseItem.compo2;
                    this.deathMouseItem = {};
                    antiCheatSet();
                    await this.saveAPData();
                    this.log(
                        "Mouse item (" + Item_Catalogue[Item_Inv[firstEmptyInvSlot]][0] + ") recovered into inventory.",
                        "info",
                    );
                }
            }

            // Replace mouse item on connect into inventory once it's all available
            if (this.isInPlayableSequenceStep() && this.connectMouseItem?.itemId > 0) {
                const firstEmptyInvSlot = this._firstEmptyInvSlot();
                if (firstEmptyInvSlot !== -1) {
                    Item_Inv[firstEmptyInvSlot] = this.connectMouseItem.itemId;
                    Comp1_Inv[firstEmptyInvSlot] = this.connectMouseItem.compo1;
                    Comp2_Inv[firstEmptyInvSlot] = this.connectMouseItem.compo2;
                    this.connectMouseItem = {};
                    antiCheatSet();
                    await this.saveAPData();
                    this.log(
                        "Mouse item (" + Item_Catalogue[Item_Inv[firstEmptyInvSlot]][0] + ") recovered into inventory.",
                        "info",
                    );
                }
            }

            // Replace class-swap items into inventory once it's all available
            if (this.isInPlayableSequenceStep() && window.ArchipelagoMod.pendingClassSwapItems.length > 0) {
                const firstEmptyInvSlot = this._firstEmptyInvSlot();
                if (firstEmptyInvSlot !== -1) {
                    const { itemId, compo1, compo2 } = window.ArchipelagoMod.pendingClassSwapItems.shift();
                    if ([3, 4, 5, 6, 58, 76, 188, 289].includes(itemId) && compo1 === 0 && compo2 === 0) return;
                    Item_Inv[firstEmptyInvSlot] = itemId;
                    Comp1_Inv[firstEmptyInvSlot] = compo1;
                    Comp2_Inv[firstEmptyInvSlot] = compo2;
                    antiCheatSet();
                    await this.saveAPData();
                    this.log(
                        "Equipped item (" +
                            Item_Catalogue[Item_Inv[firstEmptyInvSlot]][0] +
                            ") recovered into inventory after class swap.",
                        "info",
                    );
                }
            }

            if (Sequence_Step === 54 && !this.isScouting && this.sendShopHints && this.slotData.shuffle_books === 1) {
                this.isScouting = true;
                this.scoutBooksOnShopOpen();
            }

            if (Sequence_Step !== 54 && this.isScouting) {
                this.isScouting = false;
            }

            // Scout on opening the shop, and again whenever its stock grows
            // while you are still standing in it -- a Progressive Shop item
            // arriving mid-visit opens a row that has never been scouted, so it
            // would sit there as a blank logo until you walked out and back in.
            // scoutShopOnOpen only asks about rows it has not hinted already.
            const stockKey = (window.ArchipelagoMod.progressiveShopItems || []).join(",");
            if (Sequence_Step === 53 && (!this.isScoutingShop || stockKey !== this.shopStockKey)) {
                this.isScoutingShop = true;
                this.shopStockKey = stockKey;
                await this.scoutShopOnOpen();
            }

            if (Sequence_Step !== 53 && this.isScoutingShop) {
                this.isScoutingShop = false;
            }

            while (window.ArchipelagoMod.pendingAPShopDrops.length > 0) {
                const shopItemId = window.ArchipelagoMod.pendingAPShopDrops.shift();
                if (!window.ArchipelagoMod.shopIdsSent.has(shopItemId)) {
                    window.ArchipelagoMod.shopIdsSent.add(shopItemId);
                    await this.sendLocation(shopItemId + this.SHOP_OFFSET);
                }
            }

            while (window.ArchipelagoMod.pendingAPItemDrops.length > 0) {
                const enemyId = window.ArchipelagoMod.pendingAPItemDrops.shift();
                console.log("Sending enemy drop with id: ", enemyId);
                if (!window.ArchipelagoMod.enemyIdsSent.has(enemyId)) {
                    window.ArchipelagoMod.enemyIdsSent.add(enemyId);
                    await this.sendLocation(enemyId + this.ENEMY_OFFSET);
                }
            }

            if (window.ArchipelagoMod.pendingSave) {
                window.ArchipelagoMod.pendingSave = false;
                await this.saveAPData();
            }

            // Saving used to happen only when something crossed the network: a
            // check sent, an item received, a shop scouted. A run of stages
            // with none of those never saved at all, so a refresh threw away
            // everything earned since the last one. Leaving somewhere you can
            // change your game -- a stage or a town -- now saves as well, as
            // does moving to a different one.
            const left =
                this._isSomewhereThatChanges(this.lastSequence) && !this._isSomewhereThatChanges(Sequence_Step);
            if (left || this.lastStage !== Current_Stage) {
                this.lastStage = Current_Stage;
                await this.saveAPData();
            }
        }

        this.lastSequence = Sequence_Step;
    }

    /**
     * Whether this sequence step is somewhere the game can change under you.
     *
     * 12 is a stage, 51-59 the town and everything reached from it: the shop,
     * the book, the Forget Tree. Town counts because gold, items and levels all
     * move in there, and leaving it used not to save a thing.
     *
     * Walking between the town's own screens stays inside it, so shopping does
     * not write on every click.
     */
    _isSomewhereThatChanges(step) {
        return step === 12 || (step >= 51 && step <= 59);
    }

    randomRangeInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

window.ap = new APIntegration();
