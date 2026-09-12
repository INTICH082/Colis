import { SHELF_CONFIG } from './constants.js';
import { Vector3D } from './types.js';

export function distanceSq(a: Vector3D, b: Vector3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a: Vector3D, b: Vector3D): number {
  return Math.sqrt(distanceSq(a, b));
}

export function distanceXZ(a: Vector3D, b: Vector3D): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * factor;
}

export function lerpVector3(a: Vector3D, b: Vector3D, factor: number): Vector3D {
  return {
    x: lerp(a.x, b.x, factor),
    y: lerp(a.y, b.y, factor),
    z: lerp(a.z, b.z, factor),
  };
}

/**
 * Calculates local 3D offset for a slot within a standard shelf.
 * Shelves have N tiers vertically, and M slots horizontally per tier.
 */
export function calculateSlotLocalOffset(slotIndex: number): { tier: number; offset: Vector3D } {
  const tier = Math.floor(slotIndex / SHELF_CONFIG.SLOTS_PER_TIER);
  const colIndex = slotIndex % SHELF_CONFIG.SLOTS_PER_TIER;

  const y = SHELF_CONFIG.TIER_Y_OFFSETS[tier] ?? 0.5;

  // Space columns evenly along width (X axis)
  const slotWidth = SHELF_CONFIG.WIDTH / SHELF_CONFIG.SLOTS_PER_TIER;
  const startX = -SHELF_CONFIG.WIDTH / 2 + slotWidth / 2;
  const x = startX + colIndex * slotWidth;

  // Center on the shelf plate (Z = 0)
  const z = 0;

  return {
    tier,
    offset: { x, y, z },
  };
}

/**
 * Converts screen isometric input (up/down/left/right) to world coordinates.
 * The camera is positioned at (+X, +Y, +Z) looking at target (isometric view):
 * - Screen "Up" (W, inputZ = -1) -> moves away from camera: (-1, 0, -1) normalized
 * - Screen "Down" (S, inputZ = +1) -> moves towards camera: (+1, 0, +1) normalized
 * - Screen "Right" (D, inputX = +1) -> moves right on screen: (+1, 0, -1) normalized
 * - Screen "Left" (A, inputX = -1) -> moves left on screen: (-1, 0, +1) normalized
 */
export function cameraToWorldInput(inputX: number, inputZ: number): { x: number; z: number } {
  if (inputX === 0 && inputZ === 0) {
    return { x: 0, z: 0 };
  }

  // Linear transformation for isometric projection from (+X, +Z) camera vantage point
  const worldX = inputX + inputZ;
  const worldZ = -inputX + inputZ;

  // Normalize
  const length = Math.hypot(worldX, worldZ);
  if (length > 0) {
    return {
      x: worldX / length,
      z: worldZ / length,
    };
  }

  return { x: 0, z: 0 };
}
