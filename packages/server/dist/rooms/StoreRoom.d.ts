import { BoxState, ClientMessage, PlayerState, RoomState, ServerMessage, Vector3D } from '@colis/shared';
import { WebSocket } from 'ws';
export declare class StoreRoom {
    readonly id: string;
    name: string;
    createdAt: number;
    hostId: string;
    private players;
    private shelves;
    private boxes;
    private storeMoney;
    private storeLevel;
    private tickTimer;
    private tickCount;
    private boxIdCounter;
    constructor(id: string, name: string, hostId: string);
    private initializeStore;
    spawnBox(productId: string, pos: Vector3D): BoxState;
    private startLoop;
    destroy(): void;
    private tick;
    addPlayer(ws: WebSocket, playerId: string, playerName: string): PlayerState;
    removePlayer(playerId: string): void;
    handleClientMessage(playerId: string, message: ClientMessage): void;
    private handlePlayerInput;
    private handlePickupBox;
    private handleDropBox;
    private handleOpenBox;
    private handlePlaceProduct;
    private handleTakeProduct;
    private handleOrderDelivery;
    private sendError;
    broadcast(message: ServerMessage, excludePlayerId?: string): void;
    getPlayerCount(): number;
    getRoomState(): RoomState;
}
//# sourceMappingURL=StoreRoom.d.ts.map