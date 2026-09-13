import * as THREE from 'three';
import { SHELF_CONFIG, ShelfState, STORE_LAYOUT } from '@colis/shared';

export interface ObstacleContact {
  inside: boolean;
  distance: number; // positive = outside distance, negative = penetration depth
  surfacePoint: THREE.Vector3;
  normal: THREE.Vector3; // outward-facing normal
}

export interface EnvironmentContext {
  clearanceRight: number; // distance from right shoulder to obstacle
  clearanceLeft: number;  // distance from left shoulder to obstacle
  clearanceFront: number; // distance from chest forward to obstacle
  tuckRight: number;      // 0 (free) to 1 (fully tucked against torso)
  tuckLeft: number;       // 0 (free) to 1 (fully tucked against torso)
  squeezeFactor: number;  // 0 (open space) to 1 (tight narrow gap)
  fwdBlock: number;       // 0 (free path) to 1 (face-to-face with obstacle)
  bodyDeflectRoll: number; // roll angle to tilt away from side obstacle
  bodyDeflectPitch: number; // pitch angle to lean back from frontal obstacle
  bodySqueezeYaw: number;  // yaw angle to turn shoulders sideways in narrow gaps
}

interface ShelfBox {
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;
  rotY: number;
}

export class PhysicalObstacleSolver {
  private shelves: ShelfBox[] = [];
  private wallHalfW: number = STORE_LAYOUT.FLOOR_WIDTH / 2;
  private wallHalfD: number = STORE_LAYOUT.FLOOR_DEPTH / 2;
  private wallHeight: number = STORE_LAYOUT.WALL_HEIGHT;

  private tempVec1: THREE.Vector3 = new THREE.Vector3();
  private tempVec2: THREE.Vector3 = new THREE.Vector3();
  private tempVec3: THREE.Vector3 = new THREE.Vector3();

  constructor() {
    this.updateWalls();
  }

  public updateWalls(): void {
    this.wallHalfW = STORE_LAYOUT.FLOOR_WIDTH / 2;
    this.wallHalfD = STORE_LAYOUT.FLOOR_DEPTH / 2;
    this.wallHeight = STORE_LAYOUT.WALL_HEIGHT;
  }

  public setShelves(shelvesRecord: Record<string, ShelfState>): void {
    this.shelves = [];
    const halfW = SHELF_CONFIG.WIDTH / 2;
    const halfH = SHELF_CONFIG.HEIGHT / 2;
    const halfD = SHELF_CONFIG.DEPTH / 2;

    for (const s of Object.values(shelvesRecord)) {
      this.shelves.push({
        center: new THREE.Vector3(s.position.x, halfH, s.position.z),
        halfExtents: new THREE.Vector3(halfW, halfH, halfD),
        rotY: s.rotationY,
      });
    }
  }

  /**
   * Analytical query: Finds closest obstacle (shelf or wall) to point in world space.
   */
  public queryClosestObstacle(point: THREE.Vector3): ObstacleContact {
    let closestDist = Infinity;
    let closestInside = false;
    let closestSurface = new THREE.Vector3();
    let closestNormal = new THREE.Vector3(0, 1, 0);

    // 1. Check all shelves (OBB)
    for (let i = 0; i < this.shelves.length; i++) {
      const shelf = this.shelves[i];

      // Quick bounding sphere rejection (shelf diagonal is ~2.4m)
      const dx = point.x - shelf.center.x;
      const dz = point.z - shelf.center.z;
      if (dx * dx + dz * dz > 16.0) continue;

      const cosR = Math.cos(-shelf.rotY);
      const sinR = Math.sin(-shelf.rotY);
      const dy = point.y - shelf.center.y;

      const lx = dx * cosR - dz * sinR;
      const ly = dy;
      const lz = dx * sinR + dz * cosR;

      const hx = shelf.halfExtents.x;
      const hy = shelf.halfExtents.y;
      const hz = shelf.halfExtents.z;

      const inside = Math.abs(lx) <= hx && Math.abs(ly) <= hy && Math.abs(lz) <= hz;

      let cx = Math.max(-hx, Math.min(hx, lx));
      let cy = Math.max(-hy, Math.min(hy, ly));
      let cz = Math.max(-hz, Math.min(hz, lz));

      let lNormX = 0, lNormY = 0, lNormZ = 0;
      let dist = 0;

      if (inside) {
        const dRight = hx - lx;
        const dLeft = lx + hx;
        const dTop = hy - ly;
        const dBottom = ly + hy;
        const dFront = hz - lz;
        const dBack = lz + hz;

        const minDist = Math.min(dRight, dLeft, dTop, dBottom, dFront, dBack);
        dist = -minDist;

        if (minDist === dRight) { cx = hx; lNormX = 1; }
        else if (minDist === dLeft) { cx = -hx; lNormX = -1; }
        else if (minDist === dTop) { cy = hy; lNormY = 1; }
        else if (minDist === dBottom) { cy = -hy; lNormY = -1; }
        else if (minDist === dFront) { cz = hz; lNormZ = 1; }
        else { cz = -hz; lNormZ = -1; }
      } else {
        const diffX = lx - cx;
        const diffY = ly - cy;
        const diffZ = lz - cz;
        dist = Math.hypot(diffX, diffY, diffZ);
        if (dist > 0.00001) {
          lNormX = diffX / dist;
          lNormY = diffY / dist;
          lNormZ = diffZ / dist;
        } else {
          lNormY = 1;
        }
      }

      const cosW = Math.cos(shelf.rotY);
      const sinW = Math.sin(shelf.rotY);
      const wx = cx * cosW - cz * sinW + shelf.center.x;
      const wy = cy + shelf.center.y;
      const wz = cx * sinW + cz * cosW + shelf.center.z;

      const wNormX = lNormX * cosW - lNormZ * sinW;
      const wNormY = lNormY;
      const wNormZ = lNormX * sinW + lNormZ * cosW;

      if (dist < closestDist) {
        closestDist = dist;
        closestInside = inside;
        closestSurface.set(wx, wy, wz);
        closestNormal.set(wNormX, wNormY, wNormZ);
      }
    }

    // 2. Check Perimeter Walls
    // Right wall (+X)
    const distRWall = this.wallHalfW - point.x;
    if (distRWall < closestDist) {
      closestDist = distRWall;
      closestInside = distRWall < 0;
      closestSurface.set(this.wallHalfW, point.y, point.z);
      closestNormal.set(-1, 0, 0);
    }
    // Left wall (-X)
    const distLWall = point.x - (-this.wallHalfW);
    if (distLWall < closestDist) {
      closestDist = distLWall;
      closestInside = distLWall < 0;
      closestSurface.set(-this.wallHalfW, point.y, point.z);
      closestNormal.set(1, 0, 0);
    }
    // Back wall (-Z)
    const distBWall = point.z - (-this.wallHalfD);
    if (distBWall < closestDist) {
      closestDist = distBWall;
      closestInside = distBWall < 0;
      closestSurface.set(point.x, point.y, -this.wallHalfD);
      closestNormal.set(0, 0, 1);
    }
    // Front wall (+Z) - except entrance gap between X = -4 and X = 4
    if (Math.abs(point.x) > 3.8) {
      const distFWall = this.wallHalfD - point.z;
      if (distFWall < closestDist) {
        closestDist = distFWall;
        closestInside = distFWall < 0;
        closestSurface.set(point.x, point.y, this.wallHalfD);
        closestNormal.set(0, 0, -1);
      }
    }

    return {
      inside: closestInside,
      distance: closestDist,
      surfacePoint: closestSurface,
      normal: closestNormal,
    };
  }

  /**
   * Raycast / Sweep in a specific direction from an origin point to find obstacle distance.
   */
  public probeDistance(origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number = 1.0): number {
    const step = 0.08;
    const numSteps = Math.ceil(maxDist / step);
    const probe = this.tempVec1;

    for (let i = 1; i <= numSteps; i++) {
      const curDist = Math.min(i * step, maxDist);
      probe.copy(origin).addScaledVector(direction, curDist);

      const hit = this.queryClosestObstacle(probe);
      if (hit.inside || hit.distance <= 0.04) {
        return Math.max(0, curDist - 0.04);
      }
    }

    return maxDist;
  }

  /**
   * Computes the full procedural environment context for a character:
   * Left/Right obstacle clearance, frontal clearance, arm tuck amounts, squeeze factor, and body deflections.
   */
  public getCharacterEnvironmentContext(playerPos: THREE.Vector3, playerRotY: number): EnvironmentContext {
    const sinR = Math.sin(playerRotY);
    const cosR = Math.cos(playerRotY);

    // Forward vector (character facing direction: -Z in local coords)
    const fwd = this.tempVec2.set(-sinR, 0, -cosR).normalize();
    // Right vector (character right direction: -X in local coords)
    const right = this.tempVec3.set(-cosR, 0, sinR).normalize();
    // Left vector
    const left = new THREE.Vector3(-right.x, 0, -right.z);

    // Torso center around chest height (y = 1.25)
    const chestPos = new THREE.Vector3(playerPos.x, playerPos.y + 1.25, playerPos.z);

    // Probes from torso center outward:
    // Shoulder base width is ~0.35m. We probe out to 0.85m.
    const clearanceRight = this.probeDistance(chestPos, right, 0.85);
    const clearanceLeft = this.probeDistance(chestPos, left, 0.85);
    const clearanceFront = this.probeDistance(chestPos, fwd, 0.85);

    // Arm tuck factors:
    // Natural shoulder is at 0.35m. Arm needs ~0.55m to swing freely.
    // If clearance < 0.52m, start tucking in smoothly. At clearance <= 0.22m, fully tucked!
    const tuckRight = THREE.MathUtils.clamp((0.52 - clearanceRight) / 0.30, 0, 1);
    const tuckLeft = THREE.MathUtils.clamp((0.52 - clearanceLeft) / 0.30, 0, 1);

    // Frontal obstacle block factor
    const fwdBlock = THREE.MathUtils.clamp((0.55 - clearanceFront) / 0.35, 0, 1);

    // Narrow gap squeeze factor:
    // If BOTH sides have obstacles nearby (e.g. corridor width < 1.3m)
    let squeezeFactor = 0;
    if (clearanceRight < 0.60 && clearanceLeft < 0.60) {
      const totalSpan = clearanceRight + clearanceLeft;
      squeezeFactor = THREE.MathUtils.clamp((1.2 - totalSpan) / 0.5, 0, 1);
    }

    // Dynamic body deflections:
    // Roll: tilt body away from the closer side obstacle
    let bodyDeflectRoll = 0;
    if (tuckRight > 0.05 && tuckRight > tuckLeft) {
      bodyDeflectRoll = -0.18 * tuckRight; // lean left away from right obstacle
    } else if (tuckLeft > 0.05 && tuckLeft > tuckRight) {
      bodyDeflectRoll = 0.18 * tuckLeft;  // lean right away from left obstacle
    }

    // Pitch: lean backward away from frontal obstacle
    const bodyDeflectPitch = -0.25 * fwdBlock;

    // Squeeze Yaw: turn body sideways (15-25 degrees) to slide through tight gaps
    let bodySqueezeYaw = 0;
    if (squeezeFactor > 0.1) {
      // Pick side based on which clearance is slightly tighter
      const turnDir = clearanceRight < clearanceLeft ? 1 : -1;
      bodySqueezeYaw = turnDir * THREE.MathUtils.lerp(0, 0.38, squeezeFactor);
    }

    return {
      clearanceRight,
      clearanceLeft,
      clearanceFront,
      tuckRight,
      tuckLeft,
      squeezeFactor,
      fwdBlock,
      bodyDeflectRoll,
      bodyDeflectPitch,
      bodySqueezeYaw,
    };
  }

  /**
   * Non-penetration Constraint for a Hand / Limb.
   * If candidate hand position penetrates or touches an obstacle, pushes it out to the obstacle surface.
   */
  public constrainHandToEnvironment(
    shoulderWorld: THREE.Vector3,
    candidateHandWorld: THREE.Vector3,
    handRadius: number = 0.10
  ): THREE.Vector3 {
    const hit = this.queryClosestObstacle(candidateHandWorld);

    // If inside or penetrating surface closer than handRadius
    if (hit.inside || hit.distance < handRadius) {
      const result = new THREE.Vector3();
      // Push out along outward normal to obstacle surface + radius margin
      result.copy(hit.surfacePoint).addScaledVector(hit.normal, handRadius + 0.01);

      // Preserve arm length constraint (max arm reach = 0.68m)
      const toHand = this.tempVec1.subVectors(result, shoulderWorld);
      const armLen = toHand.length();
      if (armLen > 0.68) {
        result.copy(shoulderWorld).addScaledVector(toHand.normalize(), 0.68);
      }
      return result;
    }

    return candidateHandWorld;
  }
}
