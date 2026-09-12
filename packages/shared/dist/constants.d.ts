import { ProductDefinition, Vector3D } from './types.js';
export declare const NETWORK_CONFIG: {
    readonly SERVER_TICK_RATE: 25;
    readonly TICK_INTERVAL_MS: number;
    readonly INTERPOLATION_OFFSET_MS: 100;
    readonly MAX_INTERACTION_DISTANCE: 2.8;
    readonly RECONCILIATION_THRESHOLD: 0.25;
};
export declare const PLAYER_CONFIG: {
    readonly MOVE_SPEED: 4.8;
    readonly SPRINT_SPEED: 7.2;
    readonly ROTATION_LERP_FACTOR: 0.2;
    readonly RADIUS: 0.35;
    readonly HEIGHT: 1.7;
};
export declare const SHELF_CONFIG: {
    readonly WIDTH: 2.2;
    readonly DEPTH: 0.65;
    readonly HEIGHT: 2.1;
    readonly TIERS: 3;
    readonly SLOTS_PER_TIER: 4;
    readonly MAX_ITEMS_PER_SLOT: 6;
    readonly TIER_Y_OFFSETS: readonly [0.45, 1.05, 1.65];
};
export declare const PRODUCTS: Record<string, ProductDefinition>;
export declare const STORE_LAYOUT: {
    readonly FLOOR_WIDTH: 24;
    readonly FLOOR_DEPTH: 20;
    readonly WALL_HEIGHT: 3.5;
    readonly DELIVERY_ZONE: {
        readonly minX: -10;
        readonly maxX: -6;
        readonly minZ: 5;
        readonly maxZ: 9;
        readonly center: Vector3D;
    };
    readonly CHECKOUT_ZONE: {
        readonly center: Vector3D;
    };
};
//# sourceMappingURL=constants.d.ts.map