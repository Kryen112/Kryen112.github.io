import { Client, itemsHandlingFlags } from "archipelago.js";

// --- IndexedDB helpers ---
function openDB() {
    return new Promise((res, rej) => {
        const req = indexedDB.open("StickRangerAP", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("savegames");
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}

async function getState(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction("savegames", "readonly");
        const req = tx.objectStore("savegames").get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}

async function setState(key, val) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction("savegames", "readwrite");
        tx.objectStore("savegames").put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}
// ---------------------------

class APIntegration {
    constructor() {
        this.STAGE_COMPLETE_OFFSET = 10000;
        this.BOOK_OFFSET = 10100;
        this.LOC_OFFSET = 11000;
        this.ITEM_OFFSET = 12000;
        this.INV_START = 16;
        this.MOUSE_SLOT = 40;
        this.STAGE_TO_WIN = 88; // Hell Castle ID

        this._pendingConnect = false;
        this._connected = false;
        this.receivedItems = [];
        this.pendingItems = [];
        this.prevStage = [...Stage_Status];
        this.winReported = false;
        this.lastSequence = -1;
        this.storageKey = "";
        this.sendShopHints = false;
        this.isScouting = false;
        this.excludedBookStages = [0, 20, 47, 70, 77]; // Town, Village, Resort, Forget Tree, Island
        this.bookHints = {};
        this.randomizedBookCosts = {};
        this.slotData = {};

        this.host = document.getElementById("host");
        this.port = document.getElementById("port");
        this.slotName = document.getElementById("slotName");
        this.password = document.getElementById("password");
        this.connect = document.getElementById("connect");
        this.chat = document.getElementById("chat");
        this.apDiv = document.getElementById("APConnection");

        this.connect.addEventListener("click", () => this._onConnectClick());
        window.addEventListener("beforeunload", () => this._onUnload());
        this._tick = this._tick.bind(this);
        requestAnimationFrame(this._tick);
    }

    async _onConnectClick() {
        this.storageKey = [this.host.value, this.port.value, "Stick Ranger", this.slotName.value].join(":");

        const saved = await getState(this.storageKey);
        if (saved) {
            this.receivedItems = saved.receivedItems;
            this.bookHints = saved.bookHints ?? {};
            this.randomizedBookCosts = saved.randomizedBookCosts ?? {};
            GameLoad(saved.save.replace(/\r\n|\r|\n/g, ""));
        }

        this._pendingConnect = true;
        this.apDiv.style.display = "none";
        this.log("Waiting for the game to enter the map...", "info");
    }

    log(msg, type = "info") {
        const container = document.createElement("div");
        container.textContent = msg;
        if (type === "error") {
            container.style.color = "red";
        }
        this.chat.append(container);
        this.chat.scrollTop = this.chat.scrollHeight;
    }

    async saveState() {
        if (!this.storageKey) return;
        await setState(this.storageKey, {
            receivedItems: this.receivedItems,
            stages: Stage_Status,
            save: GameSave("0"),
            bookHints: this.bookHints ?? {},
            randomizedBookCosts: this.randomizedBookCosts ?? {},
        });
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

    async _connect() {
        this.client = new Client();
        const host = this.host.value;
        const port = parseInt(this.port.value);
        const game = "Stick Ranger";
        const slot = this.slotName.value;
        const password = this.password.value;
        const url = `${host}:${port}`;

        this.storageKey = [host, port, game, slot].join(":");

        this.client.socket.on("receivedItems", async (packet) => {
            console.log(packet);
            if (packet.items.length > 1 || (packet.items.length === 1 && packet.items[0].item === this.receivedItems[0])) {
                const serverItems = packet.items.map((i) => i.item);

                for (const id of serverItems) {
                    await this._applyItem(id, false);
                }

                let difference = serverItems.filter((item) => !this.receivedItems.includes(item));
                for (const id of difference) {
                    await this._applyItem(id, true);
                }
            } else {
                await this._applyItem(packet.items[0].item, true);
            }
        });

        this.client.socket.on("locationInfo", (locationInfoPacket) => {
            locationInfoPacket.locations.forEach((networkItem) => {
                if (networkItem.location >= this.BOOK_OFFSET && networkItem.location < this.BOOK_OFFSET + 100) {
                    const stageIndex = networkItem.location - this.BOOK_OFFSET;
                    this.bookHints[stageIndex] = {
                        player: this.client.players.findPlayer(networkItem.player).name,
                        item: this.client.package.lookupItemName(this.client.players.findPlayer(networkItem.player).game, networkItem.item),
                        itemClassification: networkItem.flags,
                    };
                }
            });
        });

        this.client.socket.on("printJSON", (printJSONPacket) => {
            const container = document.createElement("div");
            if (printJSONPacket.item) {
                const connectedPlayerId = printJSONPacket.item.player;
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
                        span.textContent = this.client.package.lookupItemName(this.client.players.findPlayer(el.player).game, Number(el.text));
                        switch (printJSONPacket.item.flags) {
                            case 1: // Progression
                                span.style.color = "#9f79ee";
                                break;
                            case 2: // Useful
                                span.style.color = "#4f94cd";
                                break;
                            case 4: // Trap
                                span.style.color = "#ed7b6e";
                                break;
                            case 0: // Filler
                            default:
                                span.style.color = "#09cbcb";
                                break;
                        }
                    } else if (el.type === "location_id") {
                        span.textContent = this.client.package.lookupLocationName(this.client.players.findPlayer(el.player).game, Number(el.text));
                        span.style.color = "limegreen";
                    } else if (el.text) {
                        span.textContent = el.text;
                    }
                    container.appendChild(span);
                });
            } else {
                const span = document.createElement("span");
                span.textContent = printJSONPacket.data[0].text;
                container.appendChild(span);
            }

            this.chat.appendChild(container);
            this.chat.scrollTop = this.chat.scrollHeight;
        });

        this.client.socket.on("connectionRefused", (packet) => {
            packet.errors.forEach((error) => {
                this.log(error + "; please verify your connection settings.", "error");
            });
        });

        try {
            const saved = await getState(this.storageKey);
            if (saved) {
                this.receivedItems = saved.receivedItems;
                Stage_Status = this.restoreStagesBeaten(saved.stages);
            } else {
                await this.saveState();
            }

            this.slotData = await this.client.login(url, slot, game, {
                password,
                itemsHandlingFlags: itemsHandlingFlags.all,
                tags: ["AP"],
                slotData: true,
            });

            this._connected = true;

            window.ArchipelagoMod.goldMultiplier = this.slotData.gold_multiplier ?? 1;
            window.ArchipelagoMod.xpMultiplier = this.slotData.xp_multiplier ?? 1;
            window.ArchipelagoMod.dropMultiplier = this.slotData.drop_multiplier ?? 1;
            this.sendShopHints = this.slotData.shop_hints ?? false;
            window.ArchipelagoMod.bookHintSpoiler = this.bookHints ?? {};
            const bookCostRandomizer = this.slotData.randomize_book_costs ?? 0;
            window.ArchipelagoMod.bookCostRandomizer = bookCostRandomizer;
            if (this.isEmpty(this.randomizedBookCosts)) {
                this.randomizedBookCosts = this.createRandomizedBookCosts(bookCostRandomizer);
            }
            window.ArchipelagoMod.randomizedBookCosts = this.randomizedBookCosts ?? {};

            antiCheatSet();
        } catch (error) {
            if (Array.isArray(error) && error[0]?.target instanceof WebSocket) {
                this.log("Cannot connect to: " + error[0].target.url + " Please check the hostname and port, or the server's online status.", "error");
            } else {
                this.log("Unknown error during connection: " + error, "error");
            }
            this._connected = false;
            Sequence_Step = 0;
            this.apDiv.style.display = "flex";
        }
    }

    async sendLocation(id) {
        this.client.check(id);
        await this.saveState();
    }

    async _applyItem(id, firstTime) {
        if (firstTime) {
            this.receivedItems.push(id);
        }

        // location unlock
        if (id >= this.LOC_OFFSET && id < this.LOC_OFFSET + 999) {
            Stage_Status[id - this.LOC_OFFSET] |= Unlocked;
        }

        // item grant
        else if (id >= this.ITEM_OFFSET && id < this.ITEM_OFFSET + 999 && firstTime) {
            const idx = id - this.ITEM_OFFSET;
            const slot = this._firstEmptyInvSlot();
            if (slot >= 0) Item_Inv[slot] = idx;
            else this.pendingItems.push(idx);
        }

        antiCheatSet();
        await this.saveState();
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
            Item_Inv[slot] = this.pendingItems.shift();
            await this.saveState();
            antiCheatSet();
        }
    }

    async scoutBooksOnShopOpen() {
        for (let i = 0; i < Stage_Status.length; i++) {
            if (this.excludedBookStages.includes(i)) {
                continue;
            }

            if (Stage_Status[i] === 3 && !this.bookHints[i]) {
                this.client.scout([this.BOOK_OFFSET + i], 2);
            }
        }
        await this.saveState();
    }

    _tick() {
        this._doTickWork().catch((err) => {
            console.error("Tick error:", err);
        });

        requestAnimationFrame(this._tick);
    }

    async _doTickWork() {
        if (this._connected) {
            // scan beaten/booked changes
            for (let i = 0; i < Stage_Status.length; i++) {
                if ((this.prevStage[i] & Beaten) === 0 && (Stage_Status[i] & Beaten) !== 0) {
                    await this.sendLocation(i + this.STAGE_COMPLETE_OFFSET);
                }
                if ((this.prevStage[i] & Booked) === 0 && (Stage_Status[i] & Booked) !== 0) {
                    await this.sendLocation(i + 10100);
                }
            }
            this.prevStage = [...Stage_Status];

            // flush inventory
            await this._flushPending();

            // report win
            if (!this.winReported && (Stage_Status[this.STAGE_TO_WIN] & Beaten) === Beaten) {
                this.winReported = true;
                this.client?.goal();
            }

            if (Sequence_Step === 54 && !this.isScouting && this.sendShopHints) {
                this.isScouting = true;
                this.scoutBooksOnShopOpen();
            }

            if (Sequence_Step !== 54 && this.isScouting) {
                this.isScouting = false;
            }
        }

        // on "new game", give everything
        if (Sequence_Step === 6 && this.lastSequence === 4) {
            this.client?.socket.send({
                cmd: "Sync",
            });
        }

        // connect once game is properly loaded
        if (Sequence_Step === 6 && this._pendingConnect && !this._connected) {
            this._pendingConnect = false;
            this._connect();
        }

        this.lastSequence = Sequence_Step;
    }
}

window.ap = new APIntegration();
