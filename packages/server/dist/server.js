import http from 'http';
import { WebSocketServer } from 'ws';
import { ClientOpCode } from '@colis/shared';
import { StoreRoom } from './rooms/StoreRoom.js';
const PORT = Number(process.env.PORT) || 8080;
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            activeRooms: rooms.size,
            totalPlayers: Array.from(rooms.values()).reduce((sum, r) => sum + r.getPlayerCount(), 0),
        }));
        return;
    }
    if (req.url === '/rooms') {
        const list = Array.from(rooms.values()).map(r => ({
            id: r.id,
            name: r.name,
            playerCount: r.getPlayerCount(),
            createdAt: r.createdAt,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
        return;
    }
    res.writeHead(404);
    res.end('Not Found');
});
const wss = new WebSocketServer({ server });
const rooms = new Map();
const clientToRoom = new Map();
let playerIdCounter = 1;
// Initialize a default co-op room so users can jump right in
const defaultRoomId = 'store-main';
const defaultRoom = new StoreRoom(defaultRoomId, 'Супермаркет №1 (Кооператив)', 'system');
rooms.set(defaultRoomId, defaultRoom);
wss.on('connection', (ws) => {
    const playerId = `p_${playerIdCounter++}_${Date.now().toString(36)}`;
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            if (message.op === ClientOpCode.JOIN_ROOM) {
                const { roomId, playerName } = message.data;
                const targetRoomId = (roomId && roomId.trim()) || defaultRoomId;
                let room = rooms.get(targetRoomId);
                if (!room) {
                    room = new StoreRoom(targetRoomId, `Магазин ${targetRoomId}`, playerId);
                    rooms.set(targetRoomId, room);
                }
                // Leave existing room if any
                const existing = clientToRoom.get(ws);
                if (existing) {
                    const oldRoom = rooms.get(existing.roomId);
                    if (oldRoom)
                        oldRoom.removePlayer(existing.playerId);
                }
                clientToRoom.set(ws, { roomId: targetRoomId, playerId });
                room.addPlayer(ws, playerId, playerName || `Работник #${playerIdCounter}`);
                return;
            }
            // Route message to player's active room
            const session = clientToRoom.get(ws);
            if (session) {
                const room = rooms.get(session.roomId);
                if (room) {
                    room.handleClientMessage(session.playerId, message);
                }
            }
        }
        catch (err) {
            console.error('[Server] Failed to handle message:', err);
        }
    });
    ws.on('close', () => {
        const session = clientToRoom.get(ws);
        if (session) {
            const room = rooms.get(session.roomId);
            if (room) {
                room.removePlayer(session.playerId);
                // If room is empty and not default, clean it up after a grace period
                if (room.getPlayerCount() === 0 && room.id !== defaultRoomId) {
                    room.destroy();
                    rooms.delete(room.id);
                }
            }
            clientToRoom.delete(ws);
        }
    });
    ws.on('error', (err) => {
        console.error(`[Server] Socket error for player ${playerId}:`, err);
    });
});
server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`[Colis Server] Production WebSocket Game Server Started`);
    console.log(`[Colis Server] Listening on http://localhost:${PORT}`);
    console.log(`[Colis Server] Default Room: "${defaultRoomId}" ready.`);
    console.log(`=======================================================`);
});
//# sourceMappingURL=server.js.map