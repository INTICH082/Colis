import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessage, ClientOpCode, ServerOpCode, ServerMessage } from '@colis/shared';
import { StoreRoom } from './rooms/StoreRoom.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

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

  // Serve static client assets from packages/client/dist
  if ((req.method === 'GET' || req.method === 'HEAD') && fs.existsSync(CLIENT_DIST)) {
    let reqPath = req.url ? req.url.split('?')[0] : '/';
    if (reqPath === '/') reqPath = '/index.html';

    let filePath = path.join(CLIENT_DIST, reqPath);
    if (filePath.startsWith(CLIENT_DIST) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // SPA fallback to index.html for other routes
    const indexPath = path.join(CLIENT_DIST, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(indexPath).pipe(res);
      }
      return;
    }
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

const rooms: Map<string, StoreRoom> = new Map();
const clientToRoom: Map<WebSocket, { roomId: string; playerId: string }> = new Map();

let playerIdCounter = 1;

// Initialize a default co-op room so users can jump right in
const defaultRoomId = 'store-main';
const defaultRoom = new StoreRoom(defaultRoomId, 'Супермаркет №1 (Кооператив)', 'system');
rooms.set(defaultRoomId, defaultRoom);

wss.on('connection', (ws: WebSocket) => {
  const playerId = `p_${playerIdCounter++}_${Date.now().toString(36)}`;

  ws.on('message', (data: Buffer | string) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());

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
          if (oldRoom) oldRoom.removePlayer(existing.playerId);
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
    } catch (err) {
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
