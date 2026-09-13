import * as THREE from 'three';
import { SHELF_CONFIG, ShelfState, STORE_LAYOUT } from '@colis/shared';
import { PlayerEntity } from '../entities/PlayerEntity';

interface LimbCheck {
  name: 'rHand' | 'lHand' | 'head' | 'torso';
  obj: THREE.Object3D;
  radius: number;
}

export class EnvironmentCollisionManager {
  private tempVec: THREE.Vector3 = new THREE.Vector3();
  private lastHitTimes: Map<string, number> = new Map();

  /**
   * Checks limbs of a player entity against shelves and walls.
   * Triggers physical ragdoll recoil on contact.
   */
  public checkCollisions(player: PlayerEntity, shelves: Record<string, ShelfState>, speed: number, now: number): void {
    if (!player.ragdoll || player.isKnockedDown()) return;

    const bones = player.ragdoll.bones;
    const limbs: LimbCheck[] = [];

    if (bones.rHand) limbs.push({ name: 'rHand', obj: bones.rHand, radius: 0.18 });
    if (bones.lHand) limbs.push({ name: 'lHand', obj: bones.lHand, radius: 0.18 });
    if (bones.head) limbs.push({ name: 'head', obj: bones.head, radius: 0.22 });
    if (bones.torso) limbs.push({ name: 'torso', obj: bones.torso, radius: 0.32 });

    const shelfHalfW = SHELF_CONFIG.WIDTH / 2;
    const shelfHalfH = SHELF_CONFIG.HEIGHT;
    const shelfHalfD = SHELF_CONFIG.DEPTH / 2;

    const wallHalfW = STORE_LAYOUT.FLOOR_WIDTH / 2;
    const wallHalfD = STORE_LAYOUT.FLOOR_DEPTH / 2;

    for (const limb of limbs) {
      limb.obj.getWorldPosition(this.tempVec);
      const px = this.tempVec.x;
      const py = this.tempVec.y;
      const pz = this.tempVec.z;

      const cooldownKey = `${player.id}_${limb.name}`;
      const lastHit = this.lastHitTimes.get(cooldownKey) || 0;
      // Only trigger hard impact recoil on high-speed sprint collisions or direct head/torso hits
      if (speed < 4.0 && (limb.name === 'rHand' || limb.name === 'lHand')) continue;

      let hit = false;
      let hitForce = Math.max(0.6, speed * 0.3);

      // 1. Check against shelves
      for (const shelf of Object.values(shelves)) {
        // Distance in XZ plane
        const dx = px - shelf.position.x;
        const dz = pz - shelf.position.z;
        const distSq = dx * dx + dz * dz;

        // Fast bounding circle reject (shelf diagonal is ~1.2m)
        if (distSq > 3.0) continue;

        // Transform into shelf's local coordinate system
        const cosR = Math.cos(-shelf.rotationY);
        const sinR = Math.sin(-shelf.rotationY);
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;

        // Check if limb center is inside or near the shelf cuboid
        if (
          Math.abs(localX) <= shelfHalfW + limb.radius &&
          py >= 0 && py <= shelfHalfH + limb.radius &&
          Math.abs(localZ) <= shelfHalfD + limb.radius
        ) {
          hit = true;
          break;
        }
      }

      // 2. Check against supermarket walls
      if (!hit) {
        if (
          Math.abs(px) >= wallHalfW - limb.radius ||
          Math.abs(pz) >= wallHalfD - limb.radius
        ) {
          hit = true;
          hitForce = Math.max(0.8, speed * 0.3);
        }
      }

      if (hit) {
        this.lastHitTimes.set(cooldownKey, now);
        player.ragdoll.triggerLimbHit(limb.name, hitForce);
      }
    }
  }
}
