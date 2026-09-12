export type Vector3D = {
    x: number;
    y: number;
    z: number;
};
export type Quaternion4D = {
    x: number;
    y: number;
    z: number;
    w: number;
};
export interface ProductDefinition {
    id: string;
    name: string;
    category: 'beverages' | 'snacks' | 'dairy' | 'canned' | 'grocery' | 'breakfast';
    price: number;
    cost: number;
    unitWeight: number;
    color: string;
    secondaryColor?: string;
    modelType: 'can' | 'box_tall' | 'box_wide' | 'carton' | 'bottle';
    dimensions: {
        width: number;
        height: number;
        depth: number;
    };
    boxCapacity: number;
}
export interface BoxState {
    id: string;
    productId: string;
    remainingItems: number;
    maxItems: number;
    isOpen: boolean;
    isHeld: boolean;
    heldByPlayerId: string | null;
    position: Vector3D;
    rotation: Quaternion4D;
}
export interface ShelfSlotState {
    index: number;
    tier: number;
    productId: string | null;
    count: number;
    maxCount: number;
    localOffset: Vector3D;
}
export interface ShelfState {
    id: string;
    type: 'standard_shelf' | 'fridge' | 'display_stand';
    position: Vector3D;
    rotationY: number;
    slots: ShelfSlotState[];
}
export interface PlayerState {
    id: string;
    name: string;
    color: string;
    position: Vector3D;
    rotationY: number;
    isMoving: boolean;
    heldBoxId: string | null;
    ping?: number;
}
export interface RoomState {
    roomId: string;
    name: string;
    createdAt: number;
    hostId: string;
    players: Record<string, PlayerState>;
    shelves: Record<string, ShelfState>;
    boxes: Record<string, BoxState>;
    storeMoney: number;
    storeLevel: number;
}
//# sourceMappingURL=types.d.ts.map