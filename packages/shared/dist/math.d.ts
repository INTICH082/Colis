import { Vector3D } from './types.js';
export declare function distanceSq(a: Vector3D, b: Vector3D): number;
export declare function distance(a: Vector3D, b: Vector3D): number;
export declare function distanceXZ(a: Vector3D, b: Vector3D): number;
export declare function lerp(start: number, end: number, factor: number): number;
export declare function lerpVector3(a: Vector3D, b: Vector3D, factor: number): Vector3D;
/**
 * Calculates local 3D offset for a slot within a standard shelf.
 * Shelves have N tiers vertically, and M slots horizontally per tier.
 */
export declare function calculateSlotLocalOffset(slotIndex: number): {
    tier: number;
    offset: Vector3D;
};
/**
 * Converts screen isometric input (up/down/left/right) to world coordinates.
 * The camera is positioned at (+X, +Y, +Z) looking at target (isometric view):
 * - Screen "Up" (W, inputZ = -1) -> moves away from camera: (-1, 0, -1) normalized
 * - Screen "Down" (S, inputZ = +1) -> moves towards camera: (+1, 0, +1) normalized
 * - Screen "Right" (D, inputX = +1) -> moves right on screen: (+1, 0, -1) normalized
 * - Screen "Left" (A, inputX = -1) -> moves left on screen: (-1, 0, +1) normalized
 */
export declare function cameraToWorldInput(inputX: number, inputZ: number): {
    x: number;
    z: number;
};
//# sourceMappingURL=math.d.ts.map