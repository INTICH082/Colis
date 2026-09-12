import { ClientOpCode, NETWORK_CONFIG, PRODUCTS, ServerOpCode, SHELF_CONFIG, STORE_LAYOUT, distanceXZ, } from '@colis/shared';
import { WebSocket } from 'ws';
export class StoreRoom {
    id;
    name;
    createdAt;
    hostId;
    players = new Map();
    shelves = new Map();
    boxes = new Map();
    storeMoney = 1500;
    storeLevel = 1;
    tickTimer = null;
    tickCount = 0;
    boxIdCounter = 1;
    constructor(id, name, hostId) {
        this.id = id;
        this.name = name;
        this.createdAt = Date.now();
        this.hostId = hostId;
        this.initializeStore();
        this.startLoop();
    }
    initializeStore() {
        // Generate supermarket aisles of shelves
        // We create 4 standard double-sided shelf units
        const shelfLayouts = [
            // Aisle 1 (Left row)
            { id: 'shelf_aisle1_a', pos: { x: -3.5, y: 0, z: -2 }, rotY: 0 },
            { id: 'shelf_aisle1_b', pos: { x: -3.5, y: 0, z: 2.5 }, rotY: 0 },
            // Aisle 2 (Right row)
            { id: 'shelf_aisle2_a', pos: { x: 3.5, y: 0, z: -2 }, rotY: 0 },
            { id: 'shelf_aisle2_b', pos: { x: 3.5, y: 0, z: 2.5 }, rotY: 0 },
            // Back wall storage/display shelves
            { id: 'shelf_back_1', pos: { x: -4, y: 0, z: -8 }, rotY: Math.PI / 2 },
            { id: 'shelf_back_2', pos: { x: 0, y: 0, z: -8 }, rotY: Math.PI / 2 },
            { id: 'shelf_back_3', pos: { x: 4, y: 0, z: -8 }, rotY: Math.PI / 2 },
        ];
        for (const layout of shelfLayouts) {
            const slots = [];
            const totalSlots = SHELF_CONFIG.TIERS * SHELF_CONFIG.SLOTS_PER_TIER;
            for (let i = 0; i < totalSlots; i++) {
                const tier = Math.floor(i / SHELF_CONFIG.SLOTS_PER_TIER);
                const col = i % SHELF_CONFIG.SLOTS_PER_TIER;
                const slotWidth = SHELF_CONFIG.WIDTH / SHELF_CONFIG.SLOTS_PER_TIER;
                const x = -SHELF_CONFIG.WIDTH / 2 + slotWidth / 2 + col * slotWidth;
                const y = SHELF_CONFIG.TIER_Y_OFFSETS[tier];
                slots.push({
                    index: i,
                    tier,
                    productId: null,
                    count: 0,
                    maxCount: SHELF_CONFIG.MAX_ITEMS_PER_SLOT,
                    localOffset: { x, y, z: 0 },
                });
            }
            this.shelves.set(layout.id, {
                id: layout.id,
                type: 'standard_shelf',
                position: layout.pos,
                rotationY: layout.rotY,
                slots,
            });
        }
        // Spawn starter delivery boxes in the loading dock
        this.spawnBox('cola_can', { x: -7.5, y: 0.2, z: 6.5 });
        this.spawnBox('orange_soda', { x: -8.5, y: 0.2, z: 6.5 });
        this.spawnBox('cereal_crunch', { x: -7.5, y: 0.2, z: 7.8 });
        this.spawnBox('fresh_milk', { x: -8.5, y: 0.2, z: 7.8 });
    }
    spawnBox(productId, pos) {
        const product = PRODUCTS[productId] ?? PRODUCTS['cola_can'];
        const id = `box_${this.boxIdCounter++}_${Date.now().toString(36)}`;
        const box = {
            id,
            productId,
            remainingItems: product.boxCapacity,
            maxItems: product.boxCapacity,
            isOpen: false,
            isHeld: false,
            heldByPlayerId: null,
            position: pos,
            rotation: { x: 0, y: 0, z: 0, w: 1 },
        };
        this.boxes.set(id, box);
        this.broadcast({
            op: ServerOpCode.BOX_STATE_CHANGED,
            data: box,
        });
        return box;
    }
    startLoop() {
        this.tickTimer = setInterval(() => {
            this.tick();
        }, NETWORK_CONFIG.TICK_INTERVAL_MS);
    }
    destroy() {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        this.players.clear();
    }
    tick() {
        this.tickCount++;
        const playersPayload = {};
        for (const [id, p] of this.players) {
            playersPayload[id] = {
                position: p.state.position,
                rotationY: p.state.rotationY,
                isMoving: p.state.isMoving,
                heldBoxId: p.state.heldBoxId,
            };
            // If player is holding a box, update box position along with player
            if (p.state.heldBoxId) {
                const box = this.boxes.get(p.state.heldBoxId);
                if (box) {
                    // Carry box in front of the player
                    const carryDistance = 0.65;
                    const carryHeight = 0.95;
                    box.position = {
                        x: p.state.position.x - Math.sin(p.state.rotationY) * carryDistance,
                        y: p.state.position.y + carryHeight,
                        z: p.state.position.z - Math.cos(p.state.rotationY) * carryDistance,
                    };
                }
            }
        }
        const tickMessage = {
            op: ServerOpCode.WORLD_TICK,
            data: {
                tick: this.tickCount,
                timestamp: Date.now(),
                players: playersPayload,
            },
        };
        this.broadcast(tickMessage);
    }
    addPlayer(ws, playerId, playerName) {
        const playerColors = ['#e63946', '#457b9d', '#2a9d8f', '#e76f51', '#9b5de5', '#00bbf9'];
        const color = playerColors[this.players.size % playerColors.length];
        // Spawn near the store entrance
        const spawnPos = {
            x: 0 + (Math.random() - 0.5) * 2,
            y: 0,
            z: 7 + (Math.random() - 0.5) * 2,
        };
        const playerState = {
            id: playerId,
            name: playerName,
            color,
            position: spawnPos,
            rotationY: 0,
            isMoving: false,
            heldBoxId: null,
        };
        this.players.set(playerId, { state: playerState, ws });
        // Send full initial state to this player
        const initMessage = {
            op: ServerOpCode.INIT_ROOM,
            data: {
                yourPlayerId: playerId,
                room: this.getRoomState(),
            },
        };
        ws.send(JSON.stringify(initMessage));
        // Notify other players
        this.broadcast({
            op: ServerOpCode.PLAYER_JOINED,
            data: playerState,
        }, playerId);
        this.broadcast({
            op: ServerOpCode.NOTIFICATION,
            data: {
                type: 'info',
                message: `${playerName} присоединился к магазину!`,
            },
        });
        return playerState;
    }
    removePlayer(playerId) {
        const p = this.players.get(playerId);
        if (!p)
            return;
        // If player was holding a box, drop it on the floor
        if (p.state.heldBoxId) {
            const box = this.boxes.get(p.state.heldBoxId);
            if (box) {
                box.isHeld = false;
                box.heldByPlayerId = null;
                box.position.y = 0.2;
                this.broadcast({
                    op: ServerOpCode.BOX_STATE_CHANGED,
                    data: box,
                });
            }
        }
        this.players.delete(playerId);
        this.broadcast({
            op: ServerOpCode.PLAYER_LEFT,
            data: { playerId },
        });
        this.broadcast({
            op: ServerOpCode.NOTIFICATION,
            data: {
                type: 'info',
                message: `${p.state.name} покинул магазин.`,
            },
        });
    }
    handleClientMessage(playerId, message) {
        const playerEntry = this.players.get(playerId);
        if (!playerEntry)
            return;
        switch (message.op) {
            case ClientOpCode.PLAYER_INPUT:
                this.handlePlayerInput(playerId, message.data);
                break;
            case ClientOpCode.INTERACT_BOX_PICKUP:
                this.handlePickupBox(playerId, message.data);
                break;
            case ClientOpCode.INTERACT_BOX_DROP:
                this.handleDropBox(playerId);
                break;
            case ClientOpCode.INTERACT_BOX_OPEN:
                this.handleOpenBox(playerId, message.data?.boxId);
                break;
            case ClientOpCode.INTERACT_PLACE_PRODUCT:
                this.handlePlaceProduct(playerId, message.data);
                break;
            case ClientOpCode.INTERACT_TAKE_PRODUCT:
                this.handleTakeProduct(playerId, message.data);
                break;
            case ClientOpCode.ORDER_DELIVERY:
                this.handleOrderDelivery(playerId, message.data);
                break;
        }
    }
    handlePlayerInput(playerId, input) {
        const entry = this.players.get(playerId);
        if (!entry)
            return;
        const p = entry.state;
        p.rotationY = input.rotationY;
        p.isMoving = input.isMoving;
        // Direct synchronization: clamp player within supermarket boundaries
        const halfW = STORE_LAYOUT.FLOOR_WIDTH / 2 - 0.4;
        const halfD = STORE_LAYOUT.FLOOR_DEPTH / 2 - 0.4;
        p.position.x = Math.max(-halfW, Math.min(halfW, input.position.x));
        p.position.y = Math.max(0, input.position.y);
        p.position.z = Math.max(-halfD, Math.min(halfD, input.position.z));
    }
    handlePickupBox(playerId, data) {
        const entry = this.players.get(playerId);
        if (!entry)
            return;
        if (entry.state.heldBoxId) {
            this.sendError(playerId, 'Вы уже держите коробку');
            return;
        }
        const box = this.boxes.get(data.boxId);
        if (!box) {
            this.sendError(playerId, 'Коробка не найдена');
            return;
        }
        if (box.isHeld) {
            this.sendError(playerId, 'Эту коробку уже держит другой игрок');
            return;
        }
        // If client supplied its current position, sync it within bounds
        if (data.playerPosition) {
            const halfW = STORE_LAYOUT.FLOOR_WIDTH / 2 - 0.4;
            const halfD = STORE_LAYOUT.FLOOR_DEPTH / 2 - 0.4;
            entry.state.position.x = Math.max(-halfW, Math.min(halfW, data.playerPosition.x));
            entry.state.position.y = Math.max(0, data.playerPosition.y);
            entry.state.position.z = Math.max(-halfD, Math.min(halfD, data.playerPosition.z));
        }
        const dist = distanceXZ(entry.state.position, box.position);
        if (dist > 5.0) {
            this.sendError(playerId, `Вы слишком далеко от коробки (${dist.toFixed(1)}м > 5м)`);
            return;
        }
        // Success: attach to player
        box.isHeld = true;
        box.heldByPlayerId = playerId;
        entry.state.heldBoxId = box.id;
        this.broadcast({
            op: ServerOpCode.BOX_STATE_CHANGED,
            data: box,
        });
    }
    handleDropBox(playerId) {
        const entry = this.players.get(playerId);
        if (!entry || !entry.state.heldBoxId)
            return;
        const box = this.boxes.get(entry.state.heldBoxId);
        if (!box)
            return;
        box.isHeld = false;
        box.heldByPlayerId = null;
        entry.state.heldBoxId = null;
        // Drop on floor in front of player
        const dropDist = 0.75;
        box.position = {
            x: entry.state.position.x - Math.sin(entry.state.rotationY) * dropDist,
            y: 0.2,
            z: entry.state.position.z - Math.cos(entry.state.rotationY) * dropDist,
        };
        this.broadcast({
            op: ServerOpCode.BOX_STATE_CHANGED,
            data: box,
        });
    }
    handleOpenBox(playerId, targetBoxId) {
        const entry = this.players.get(playerId);
        if (!entry)
            return;
        const boxId = targetBoxId || entry.state.heldBoxId;
        if (!boxId)
            return;
        const box = this.boxes.get(boxId);
        if (!box)
            return;
        if (box.isOpen)
            return;
        box.isOpen = true;
        this.broadcast({
            op: ServerOpCode.BOX_STATE_CHANGED,
            data: box,
        });
        this.broadcast({
            op: ServerOpCode.NOTIFICATION,
            data: {
                type: 'info',
                message: `${entry.state.name} открыл коробку: ${PRODUCTS[box.productId]?.name ?? box.productId}`,
            },
        });
    }
    handlePlaceProduct(playerId, data) {
        const entry = this.players.get(playerId);
        if (!entry || !entry.state.heldBoxId) {
            this.sendError(playerId, 'Для раскладки товаров возьмите открытую коробку');
            return;
        }
        const box = this.boxes.get(entry.state.heldBoxId);
        if (!box)
            return;
        if (!box.isOpen) {
            this.sendError(playerId, 'Сначала откройте коробку (нажмите R или пробел)');
            return;
        }
        if (box.remainingItems <= 0) {
            this.sendError(playerId, 'В этой коробке больше нет товаров');
            return;
        }
        const shelf = this.shelves.get(data.shelfId);
        if (!shelf)
            return;
        const slot = shelf.slots[data.slotIndex];
        if (!slot)
            return;
        // Check if slot accepts this product
        if (slot.productId !== null && slot.productId !== box.productId && slot.count > 0) {
            this.sendError(playerId, 'На этом слоте размещен другой товар');
            return;
        }
        if (slot.count >= slot.maxCount) {
            this.sendError(playerId, 'Слот уже заполнен');
            return;
        }
        // If client supplied its current position, sync it within bounds
        if (data.playerPosition) {
            const halfW = STORE_LAYOUT.FLOOR_WIDTH / 2 - 0.4;
            const halfD = STORE_LAYOUT.FLOOR_DEPTH / 2 - 0.4;
            entry.state.position.x = Math.max(-halfW, Math.min(halfW, data.playerPosition.x));
            entry.state.position.y = Math.max(0, data.playerPosition.y);
            entry.state.position.z = Math.max(-halfD, Math.min(halfD, data.playerPosition.z));
        }
        // Check distance to shelf
        const dist = distanceXZ(entry.state.position, shelf.position);
        if (dist > 5.5) {
            this.sendError(playerId, 'Подойдите ближе к стеллажу');
            return;
        }
        // Place one item
        box.remainingItems -= 1;
        slot.productId = box.productId;
        slot.count += 1;
        // If box is empty, drop/remove or mark empty
        if (box.remainingItems === 0) {
            this.broadcast({
                op: ServerOpCode.NOTIFICATION,
                data: {
                    type: 'success',
                    message: `Коробка пуста! Товар "${PRODUCTS[box.productId]?.name}" разложен на полку.`,
                },
            });
        }
        this.broadcast({
            op: ServerOpCode.SHELF_STATE_CHANGED,
            data: shelf,
        });
        this.broadcast({
            op: ServerOpCode.BOX_STATE_CHANGED,
            data: box,
        });
    }
    handleTakeProduct(playerId, data) {
        const entry = this.players.get(playerId);
        if (!entry || !entry.state.heldBoxId)
            return;
        const box = this.boxes.get(entry.state.heldBoxId);
        if (!box || !box.isOpen)
            return;
        const shelf = this.shelves.get(data.shelfId);
        if (!shelf)
            return;
        // If client supplied its current position, sync it within bounds
        if (data.playerPosition) {
            const halfW = STORE_LAYOUT.FLOOR_WIDTH / 2 - 0.4;
            const halfD = STORE_LAYOUT.FLOOR_DEPTH / 2 - 0.4;
            entry.state.position.x = Math.max(-halfW, Math.min(halfW, data.playerPosition.x));
            entry.state.position.y = Math.max(0, data.playerPosition.y);
            entry.state.position.z = Math.max(-halfD, Math.min(halfD, data.playerPosition.z));
        }
        const dist = distanceXZ(entry.state.position, shelf.position);
        if (dist > 5.5) {
            this.sendError(playerId, 'Подойдите ближе к стеллажу');
            return;
        }
        const slot = shelf.slots[data.slotIndex];
        if (!slot || slot.count <= 0 || slot.productId !== box.productId)
            return;
        if (box.remainingItems >= box.maxItems) {
            this.sendError(playerId, 'Коробка уже полная');
            return;
        }
        slot.count -= 1;
        if (slot.count === 0) {
            slot.productId = null;
        }
        box.remainingItems += 1;
        this.broadcast({
            op: ServerOpCode.SHELF_STATE_CHANGED,
            data: shelf,
        });
        this.broadcast({
            op: ServerOpCode.BOX_STATE_CHANGED,
            data: box,
        });
    }
    handleOrderDelivery(playerId, data) {
        const product = PRODUCTS[data.productId];
        if (!product)
            return;
        const qty = Math.max(1, Math.min(10, data.quantity));
        const totalCost = product.cost * qty * product.boxCapacity;
        if (this.storeMoney < totalCost) {
            this.sendError(playerId, `Недостаточно средств магазина. Требуется $${totalCost.toFixed(2)}, баланс $${this.storeMoney.toFixed(2)}`);
            return;
        }
        this.storeMoney -= totalCost;
        // Spawn delivery boxes in delivery zone
        const spawnZStart = 5.5;
        for (let i = 0; i < qty; i++) {
            const offsetX = (i % 3) * 0.9 - 1.0;
            const offsetZ = Math.floor(i / 3) * 0.9;
            this.spawnBox(data.productId, {
                x: STORE_LAYOUT.DELIVERY_ZONE.center.x + offsetX,
                y: 0.2,
                z: spawnZStart + offsetZ,
            });
        }
        this.broadcast({
            op: ServerOpCode.STORE_ECONOMY_CHANGED,
            data: {
                storeMoney: this.storeMoney,
                storeLevel: this.storeLevel,
            },
        });
        this.broadcast({
            op: ServerOpCode.NOTIFICATION,
            data: {
                type: 'success',
                message: `Доставка прибыла: ${qty} кор. "${product.name}". Списано: $${totalCost.toFixed(2)}`,
            },
        });
    }
    sendError(playerId, reason) {
        const entry = this.players.get(playerId);
        if (!entry)
            return;
        const msg = {
            op: ServerOpCode.ACTION_REJECTED,
            data: {
                reason,
                code: 'ACTION_FAILED',
            },
        };
        entry.ws.send(JSON.stringify(msg));
    }
    broadcast(message, excludePlayerId) {
        const raw = JSON.stringify(message);
        for (const [id, entry] of this.players) {
            if (excludePlayerId && id === excludePlayerId)
                continue;
            if (entry.ws.readyState === WebSocket.OPEN) {
                entry.ws.send(raw);
            }
        }
    }
    getPlayerCount() {
        return this.players.size;
    }
    getRoomState() {
        const playersObj = {};
        for (const [id, p] of this.players) {
            playersObj[id] = p.state;
        }
        const shelvesObj = {};
        for (const [id, s] of this.shelves) {
            shelvesObj[id] = s;
        }
        const boxesObj = {};
        for (const [id, b] of this.boxes) {
            boxesObj[id] = b;
        }
        return {
            roomId: this.id,
            name: this.name,
            createdAt: this.createdAt,
            hostId: this.hostId,
            players: playersObj,
            shelves: shelvesObj,
            boxes: boxesObj,
            storeMoney: this.storeMoney,
            storeLevel: this.storeLevel,
        };
    }
}
//# sourceMappingURL=StoreRoom.js.map