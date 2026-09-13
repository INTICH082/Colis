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
  public checkCollisions(_player: PlayerEntity, _shelves: Record<string, ShelfState>, _speed: number, _now: number): void {
    // Disabled: completely removed environment obstacle interference on character limbs
    return;
  }
}
