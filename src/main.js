import { Client, itemsHandlingFlags } from "archipelago.js";

class APIntegration {
    constructor() {
        this.STAGE_COMPLETE_OFFSET = 10000;
        this.BOOK_OFFSET = 10100;
        this.ENEMY_OFFSET = 10200;
        this.LOC_OFFSET = 11000;
        this.ITEM_OFFSET = 12000;
        this.TRAPS_OFFSET = 13000;
        this.CLASS_OFFSET = 14000;
        this.RANGER_CLASSES = { 14000: "Boxer", 14001: "Gladiator", 14002: "Sniper", 14003: "Magician", 14004: "Priest", 14005: "Gunner", 14006: "Whipper", 14007: "Angel" };
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
        this.sendShopHints = false;
        this.isScouting = false;
        this.excludedBookStages = [0, 20, 47, 70, 77]; // Town, Village, Resort, Forget Tree, Island
        this.bookHints = {};
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

        window.addEventListener("beforeunload", () => this._onUnload());
        this._tick = this._tick.bind(this);
        requestAnimationFrame(this._tick);
    }

    getStorageKey() {
        return `StickRangerSaveData:${this.client.players.self.team}:${this.client.players.self.slot}`;
    }

    async loadAPData() {
        console.log("Loading data...");

        const data = await this.client.storage.fetch(this.getStorageKey(), {});

        if (data) {
            console.log("Found data: ", data);
            this.receivedItems = data.receivedItems ?? [];
            this.prevStage = data.stages ?? [...Stage_Status];
            this.bookHints = data.bookHints ?? {};
            this.randomizedBookCosts = data.randomizedBookCosts ?? {};
            this.deathMouseItem = data.deathMouseItem ?? {};
            this.connectMouseItem = data.connectMouseItem ?? {};
            window.ArchipelagoMod.enemyIdsSent = new Set(data.enemyIdsSent ?? []);
            window.ArchipelagoMod.pendingClassSwapItems = data.pendingClassSwapItems ?? [];
            GameLoad(data.save.replace(/\r\n|\r|\n/g, ""));
            this.restoreStagesBeaten(data.stages);
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
                randomizedBookCosts: this.randomizedBookCosts,
                deathMouseItem: this.deathMouseItem,
                connectMouseItem: this.connectMouseItem,
                enemyIdsSent: Array.from(window.ArchipelagoMod.enemyIdsSent ?? []),
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
        this.connectionInfo.textContent = "Connected at: " + this.host.value + ":" + this.port.value + " - " + this.slotName.value;
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
        for (var s=0; s<Stage_Count; s++)
            Stage_Status[s] = 0;
        Stage_Status[0] = Beaten|Unlocked;
        Stage_Status[1] = Unlocked;
        antiCheatSet();
    }

    _onSendClick() {
        const text = this.message.value.trim();
        if (text.length === 0) {
            return;
        }

        this.client.messages.say(text);
        if (text[0] === "/") {
            this.log("Cannot issue command " + text.slice(1).split(" ")[0] + ". Client commands are not yet supported.");
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
            console.warn("Bounced");
            console.log(packet);
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

            if (this.slotData.ranger_class_randomizer == 1) {
                window.ArchipelagoMod.unlockForgetTree = true;
            }
            this.setStagesToWinFromGoal();
            window.ArchipelagoMod.rangerClassRandomizer = this.slotData.ranger_class_randomizer ?? 0;
            window.ArchipelagoMod.rangerClassesUnlocked = this.getUnlockedClasses();
            window.ArchipelagoMod.classesForCastle = this.slotData.classes_req_for_castle ?? 2;
            window.ArchipelagoMod.classesForSubmarineShrine = this.slotData.classes_req_for_submarine_shrine ?? 3;
            window.ArchipelagoMod.classesForPyramid = this.slotData.classes_req_for_pyramid ?? 4;
            window.ArchipelagoMod.classesForIceCastle = this.slotData.classes_req_for_ice_castle ?? 5;
            window.ArchipelagoMod.classesForHellCastle = this.slotData.classes_req_for_hell_castle ?? 6;
            window.ArchipelagoMod.stagesForCastle = this.slotData.stages_req_for_castle ?? 6;
            window.ArchipelagoMod.stagesForSubmarineShrine = this.slotData.stages_req_for_submarine_shrine ?? 4;
            window.ArchipelagoMod.stagesForPyramid = this.slotData.stages_req_for_pyramid ?? 4;
            window.ArchipelagoMod.stagesForIceCastle = this.slotData.stages_req_for_ice_castle ?? 5;
            window.ArchipelagoMod.stagesForHellCastle = this.slotData.stages_req_for_hell_castle ?? 7;
            window.ArchipelagoMod.shuffleBooks = this.slotData.shuffle_books ?? 0;
            window.ArchipelagoMod.shuffleEnemies = this.slotData.shuffle_enemies ?? 0;
            window.ArchipelagoMod.enemyIdsSent = window.ArchipelagoMod.enemyIdsSent ?? new Set([]);
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
            window.ArchipelagoMod.removeNullCompo = this.slotData.remove_null_compo ?? 1;

            if (this.slotData.death_link) {
                this.client.deathLink.enableDeathLink();
                this.client.updateTags(["AP", "DeathLink"]);
            }

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
                this.log("Storing mouse item (" + Item_Catalogue[this.connectMouseItem.itemId][0] + ") to be recovered when in-game again.", "info");
            }

            this.chatLine.style.display = "flex";
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
            this.connectionBox.style.display = "none";
            this.chatLine.style.display = "none";
        }
    }

    getUnlockedClasses() {
        const unlocked = [];
        unlocked.push(this.slotData.ranger_class_selected);
        for (const id of this.receivedItems) {
            const name = this.RANGER_CLASSES[id];
            if (name) {
                unlocked.push(name);
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
            0: [88],           // Hell Castle
            1: [89],           // Volcano
            2: [55],           // Mountaintop
            3: [88, 89],       // Hell Castle + Volcano
            4: [88, 55],       // Hell Castle + Mountaintop
            5: [89, 55],       // Volcano + Mountaintop
            6: [88, 89, 55],   // All
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
            window.ArchipelagoMod.rangerClassesUnlocked.push(name);
            if (firstTime) {
                this.receivedItems.push(id);
            }
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
        Team_Gold -= lostGold;
        this.log("You lost $" + lostGold + "!", "error");
        Indicators.INadd(Players.PL_joint[Selected_Player][0].x, Players.PL_joint[Selected_Player][0].y, 0, "-$" + lostGold, 0xff3f3f);
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

    spawnEnemies() {
        // IDs to exclude (Invisible boss attacks)
        const excludedIds = new Set([40, 115, 163, 244, 333, 334, 335, 336, 337, 339]);

        const spawnAmount = this.randomRangeInt(3, 10);
        for (let i = 0; i < spawnAmount; i++) {
            let randomType;
            do {
                randomType = this.randomRangeInt(1, 338);
            } while (excludedIds.has(randomType));
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

    async scoutBooksOnShopOpen() {
        console.log("Scouting books");
        // TODO check if works in both states
        if (this.slotData.shuffle_books === 1) {
            // Book shuffle
            for (let i = 0; i < Stage_Status.length; i++) {
                if (this.excludedBookStages.includes(i)) {
                    continue;
                }

                if (Stage_Status[i] === 3 && !this.bookHints[i]) {
                    this.client.scout([this.BOOK_OFFSET + i], 2);
                }
            }
            await this.saveAPData();
        }
    }

    _tick() {
        if (!this._disconnected) {
            this._doTickWork().catch((err) => {
                console.error("Tick error:", err);
            });
        }

        requestAnimationFrame(this._tick);
    }

    async _doTickWork() {
        if (this._connected && this.client && this.client.authenticated) {
            if (Sequence_Step === 6 && this.lastSequence === 4) {
                console.log("New game detected");
                this.receivedItems = [];
                if (this.slotData.ranger_class_randomizer == 1) {
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
            if (
                !this.winReported &&
                this.stagesToWin.every(stageId => (Stage_Status[stageId] & Beaten) === Beaten)
            ) {
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
                    this.client.deathLink.sendDeathLink(this.slotData.player_name, this.slotData.player_name + " was defeated in Stick Ranger.");
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
                    this.log("Storing mouse item (" + Item_Catalogue[this.deathMouseItem.itemId][0] + ") to be recovered when in-game again.", "info");
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
                    this.log("Mouse item (" + Item_Catalogue[Item_Inv[firstEmptyInvSlot]][0] + ") recovered into inventory.", "info");
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
                    this.log("Mouse item (" + Item_Catalogue[Item_Inv[firstEmptyInvSlot]][0] + ") recovered into inventory.", "info");
                }
            }

            // Replace class-swap items into inventory once it's all available
            if (this.isInPlayableSequenceStep() && window.ArchipelagoMod.pendingClassSwapItems.length > 0) {
                const firstEmptyInvSlot = this._firstEmptyInvSlot();
                if (firstEmptyInvSlot !== -1) {
                    const { itemId, compo1, compo2 } = window.ArchipelagoMod.pendingClassSwapItems.shift();
                    if ([3, 4, 5, 6, 58, 76, 188, 289].includes(itemId) && compo1 == 0 && compo2 == 0) return;
                    Item_Inv[firstEmptyInvSlot] = itemId;
                    Comp1_Inv[firstEmptyInvSlot] = compo1;
                    Comp2_Inv[firstEmptyInvSlot] = compo2;
                    antiCheatSet();
                    await this.saveAPData();
                    this.log("Equipped item (" + Item_Catalogue[Item_Inv[firstEmptyInvSlot]][0] + ") recovered into inventory after class swap.", "info");
                }
            }

            if (Sequence_Step === 54 && !this.isScouting && this.sendShopHints && this.slotData.shuffle_books === 1) {
                this.isScouting = true;
                this.scoutBooksOnShopOpen();
            }

            if (Sequence_Step !== 54 && this.isScouting) {
                this.isScouting = false;
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
        }

        this.lastSequence = Sequence_Step;
    }

    randomRangeInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

window.ap = new APIntegration();
