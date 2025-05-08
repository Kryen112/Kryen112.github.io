import { Client, ITEMS_HANDLING_FLAGS, SERVER_PACKET_TYPE, CLIENT_PACKET_TYPE } from "https://unpkg.com/archipelago.js@1.0.0/dist/archipelago.js";

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

        this.host = document.getElementById("host");
        this.port = document.getElementById("port");
        this.slotName = document.getElementById("slotName");
        this.password = document.getElementById("password");
        this.connect = document.getElementById("connect");
        this.chat = document.getElementById("chat");
        this.apDiv = document.getElementById("APConnection");

        this.connect.addEventListener("click", () => this._onConnectClick());
        window.addEventListener("beforeunload", async () => await this._onUnload()); //TODO this is now saync and it could break, look chatgpt
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
            randomizedBookCosts: this.randomizedBookCosts ?? {}
        });
    }

    async _onUnload() {
        await this.saveState();
        this.client?.disconnect();
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
                break;
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
        const connectionInfo = {
            hostname: this.host.value,
            port: parseInt(this.port.value),
            game: "Stick Ranger",
            name: this.slotName.value,
            password: this.password.value,
            items_handling: ITEMS_HANDLING_FLAGS.REMOTE_ALL,
        };

        this.storageKey = [connectionInfo.hostname, connectionInfo.port, connectionInfo.game, connectionInfo.name].join(":");

        this.client.addListener(SERVER_PACKET_TYPE.CONNECTED, async () => {
            const saved = await getState(this.storageKey);
            if (saved) {
                this.receivedItems = saved.receivedItems;
                Stage_Status = this.restoreStagesBeaten(saved.stages);
            } else {
                await this.saveState();
            }

            const goldMultiplier = this.client.data.slotData.gold_multiplier ?? 1;
            window.ArchipelagoMod.goldMultiplier = goldMultiplier;
            const xpMultiplier = this.client.data.slotData.xp_multiplier ?? 1;
            window.ArchipelagoMod.xpMultiplier = xpMultiplier;
            const dropMultiplier = this.client.data.slotData.drop_multiplier ?? 1;
            window.ArchipelagoMod.dropMultiplier = dropMultiplier;
            this.sendShopHints = this.client.data.slotData.shop_hints ?? false;
            window.ArchipelagoMod.bookHintSpoiler = this.bookHints ?? {};
            const bookCostRandomizer = this.client.data.slotData.randomize_book_costs ?? 0;
            window.ArchipelagoMod.bookCostRandomizer = bookCostRandomizer;
            if (this.isEmpty(this.randomizedBookCosts)) {
                this.randomizedBookCosts = this.createRandomizedBookCosts(bookCostRandomizer);
            }
            window.ArchipelagoMod.randomizedBookCosts = this.randomizedBookCosts ?? {};
        });

        this.client.addListener(SERVER_PACKET_TYPE.RECEIVED_ITEMS, async (packet) => {
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

        this.client.addListener(SERVER_PACKET_TYPE.LOCATION_INFO, (locationInfoPacket) => {
            locationInfoPacket.locations.forEach((networkItem) => {
                if (networkItem.location >= this.BOOK_OFFSET && networkItem.location < this.BOOK_OFFSET + 100) {
                    const stageIndex = networkItem.location - this.BOOK_OFFSET;
                    this.bookHints[stageIndex] = {
                        player: this.client.players.name(networkItem.player),
                        item: this.client.items.name(this.client.players.game(networkItem.player), networkItem.item),
                        itemClassification: networkItem.flags,
                    };
                }
            });
        });

        this.client.addListener(SERVER_PACKET_TYPE.PRINT_JSON, (packet) => {
            const container = document.createElement("div");
            const connectedPlayerId = Number(this.client.data.slotData.player_id);
            packet.data.forEach((el) => {
                const span = document.createElement("span");
                const forPlayer = el.player ?? connectedPlayerId;
                if (el.type === "player_id") {
                    const pid = Number(el.text);
                    span.textContent = this.client.players.name(pid);
                    if (pid === connectedPlayerId) {
                        span.style.color = "#ee00ee";
                    } else {
                        span.style.color = "#eee8cd";
                    }
                } else if (el.type === "item_id") {
                    span.textContent = this.client.items.name(this.client.players.game(forPlayer), Number(el.text));
                    switch (packet.item.flags) {
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
                    span.textContent = this.client.locations.name(this.client.players.game(forPlayer), Number(el.text));
                    span.style.color = "limegreen";
                } else if (el.text) {
                    span.textContent = el.text;
                }
                container.appendChild(span);
            });

            this.chat.appendChild(container);
            this.chat.scrollTop = this.chat.scrollHeight;
        });

        this.client.addListener(SERVER_PACKET_TYPE.CONNECTION_REFUSED, (packet) => {
            packet.errors.forEach((error) => {
                this.log(error + "; please verify your connection settings.", "error");
            });
        });

        try {
            await this.client.connect(connectionInfo);
            this._connected = true;
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
        if (this.client) this.client.locations.check(id);
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
                this.client?.send({
                    cmd: CLIENT_PACKET_TYPE.LOCATION_SCOUTS,
                    create_as_hint: 2,
                    locations: [this.BOOK_OFFSET + i],
                });
            }
        }
    }

    _tick() {
        // fire off the async work, but catch errors so the loop never dies
        this._doTickWork().catch((err) => {
            console.error("Tick error:", err);
        });

        requestAnimationFrame(this._tick);
    }

    async _doTickWork() {
        //TODO this is now saync and it could break, look chatgpt
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
            this.client?.send({
                cmd: "StatusUpdate",
                status: 30,
            });
        }

        // on "new game", give everything
        if (Sequence_Step === 6 && this.lastSequence === 4) {
            this.client?.send({
                cmd: CLIENT_PACKET_TYPE.SYNC,
            });
        }

        // connect once game is properly loaded
        if (Sequence_Step === 6 && this._pendingConnect && !this._connected) {
            this._pendingConnect = false;
            this._connect();
        }

        if (Sequence_Step === 54 && !this.isScouting && this.sendShopHints) {
            this.isScouting = true;
            this.scoutBooksOnShopOpen();
        }

        if (Sequence_Step !== 54 && this.isScouting) {
            this.isScouting = false;
        }

        this.lastSequence = Sequence_Step;
    }
}

window.ap = new APIntegration();