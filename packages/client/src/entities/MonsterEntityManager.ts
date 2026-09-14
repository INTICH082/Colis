import * as THREE from 'three';
import { MonsterType, MONSTER_CONFIG } from '@colis/shared';

interface MonsterRenderEntry {
  group: THREE.Group;
  targetPos: THREE.Vector3;
  targetRotY: number;
  type: MonsterType;
  healthBarFill: THREE.Mesh;
  bodyMesh: THREE.Mesh;
  lastHealth: number;
  hitFlashTimer: number;
  walkCycleTime: number;
  leftLimb: THREE.Mesh;
  rightLimb: THREE.Mesh;
}

export class MonsterEntityManager {
  private scene: THREE.Scene;
  private monsters: Map<string, MonsterRenderEntry> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public syncMonsters(serverMonsters: Record<string, {
    position: { x: number; y: number; z: number };
    rotationY: number;
    state: string;
    health: number;
    maxHealth: number;
    type: string;
    isEnraged?: boolean;
  }> | undefined): void {
    if (!serverMonsters) {
      for (const entry of this.monsters.values()) {
        this.scene.remove(entry.group);
      }
      this.monsters.clear();
      return;
    }

    const activeIds = new Set<string>();

    for (const [id, data] of Object.entries(serverMonsters)) {
      activeIds.add(id);

      let entry = this.monsters.get(id);
      if (!entry) {
        entry = this.buildMonsterMesh(id, data.type as MonsterType);
        this.monsters.set(id, entry);
        this.scene.add(entry.group);
        entry.group.position.set(data.position.x, data.position.y, data.position.z);
        entry.group.rotation.y = data.rotationY;
      }

      entry.targetPos.set(data.position.x, data.position.y, data.position.z);
      entry.targetRotY = data.rotationY;

      // Hit flash on damage
      if (data.health < entry.lastHealth) {
        entry.hitFlashTimer = 0.2;
      }
      entry.lastHealth = data.health;

      // Update HP bar
      const hpRatio = Math.max(0, Math.min(1, data.health / data.maxHealth));
      entry.healthBarFill.scale.x = hpRatio;
      entry.healthBarFill.position.x = -(1 - hpRatio) * 0.35;

      // Enraged visual aura (Blood Moon)
      const bodyMat = entry.bodyMesh.material as THREE.MeshStandardMaterial;
      if (data.isEnraged) {
        bodyMat.emissive.setHex(0xd90429);
        bodyMat.emissiveIntensity = 0.45;
      } else if (entry.hitFlashTimer <= 0) {
        bodyMat.emissive.setHex(0x000000);
        bodyMat.emissiveIntensity = 0;
      }
    }

    // Cleanup defeated monsters
    for (const [id, entry] of this.monsters) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.group);
        this.monsters.delete(id);
      }
    }
  }

  public update(dt: number): void {
    const lerpRate = Math.min(1, 16 * dt);

    for (const entry of this.monsters.values()) {
      const prevPos = entry.group.position.clone();
      entry.group.position.lerp(entry.targetPos, lerpRate);

      let diff = entry.targetRotY - entry.group.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      entry.group.rotation.y += diff * lerpRate;

      // Procedural aggressive walking cycle
      const distMoved = entry.group.position.distanceTo(prevPos);
      if (distMoved > 0.002) {
        entry.walkCycleTime += dt * 14;
        const swing = Math.sin(entry.walkCycleTime) * 0.55;
        entry.leftLimb.rotation.x = swing;
        entry.rightLimb.rotation.x = -swing;
      } else {
        entry.leftLimb.rotation.x *= 0.8;
        entry.rightLimb.rotation.x *= 0.8;
      }

      // Hit flash handling
      if (entry.hitFlashTimer > 0) {
        entry.hitFlashTimer -= dt;
        (entry.bodyMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xffffff);
      } else {
        (entry.bodyMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      }
    }
  }

  private buildMonsterMesh(id: string, type: MonsterType): MonsterRenderEntry {
    const group = new THREE.Group();
    const config = MONSTER_CONFIG[type] || MONSTER_CONFIG.STALKER;

    let bodyMesh: THREE.Mesh;
    let leftLimb: THREE.Mesh;
    let rightLimb: THREE.Mesh;

    if (type === 'STALKER') {
      // Sleek, agile red demon
      const bodyGeo = new THREE.BoxGeometry(0.38, 0.65, 0.32);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x991b1b,
        roughness: 0.5,
        metalness: 0.2,
      });
      bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      bodyMesh.position.y = 0.85;
      bodyMesh.castShadow = true;
      group.add(bodyMesh);

      // Glowing red eyes
      const eyeGeo = new THREE.BoxGeometry(0.08, 0.06, 0.06);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
      eyeL.position.set(-0.1, 1.05, -0.18);
      group.add(eyeL);

      const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
      eyeR.position.set(0.1, 1.05, -0.18);
      group.add(eyeR);

      // Limbs
      const limbGeo = new THREE.BoxGeometry(0.12, 0.6, 0.14);
      const limbMat = new THREE.MeshStandardMaterial({ color: 0x450a0a });
      leftLimb = new THREE.Mesh(limbGeo, limbMat);
      leftLimb.position.set(-0.12, 0.3, 0);
      leftLimb.castShadow = true;
      group.add(leftLimb);

      rightLimb = new THREE.Mesh(limbGeo, limbMat);
      rightLimb.position.set(0.12, 0.3, 0);
      rightLimb.castShadow = true;
      group.add(rightLimb);
    } else if (type === 'VANDAL') {
      // Nimble chaotic purple gremlin
      const bodyGeo = new THREE.BoxGeometry(0.48, 0.45, 0.38);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x6b21a8,
        roughness: 0.7,
      });
      bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      bodyMesh.position.y = 0.65;
      bodyMesh.castShadow = true;
      group.add(bodyMesh);

      // Yellow glowing eyes
      const eyeGeo = new THREE.BoxGeometry(0.1, 0.08, 0.06);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
      eyeL.position.set(-0.12, 0.8, -0.2);
      group.add(eyeL);

      const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
      eyeR.position.set(0.12, 0.8, -0.2);
      group.add(eyeR);

      // Limbs
      const limbGeo = new THREE.BoxGeometry(0.14, 0.44, 0.16);
      const limbMat = new THREE.MeshStandardMaterial({ color: 0x3b0764 });
      leftLimb = new THREE.Mesh(limbGeo, limbMat);
      leftLimb.position.set(-0.16, 0.22, 0);
      leftLimb.castShadow = true;
      group.add(leftLimb);

      rightLimb = new THREE.Mesh(limbGeo, limbMat);
      rightLimb.position.set(0.16, 0.22, 0);
      rightLimb.castShadow = true;
      group.add(rightLimb);
    } else {
      // Bulky orange Brute
      const bodyGeo = new THREE.BoxGeometry(0.72, 0.85, 0.55);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xc2410c,
        roughness: 0.6,
        metalness: 0.3,
      });
      bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      bodyMesh.position.y = 1.05;
      bodyMesh.castShadow = true;
      group.add(bodyMesh);

      // Horns
      const hornGeo = new THREE.ConeGeometry(0.08, 0.28, 6);
      const hornMat = new THREE.MeshStandardMaterial({ color: 0x1c1917 });
      const hornL = new THREE.Mesh(hornGeo, hornMat);
      hornL.position.set(-0.25, 1.55, 0);
      hornL.rotation.z = -0.3;
      group.add(hornL);

      const hornR = new THREE.Mesh(hornGeo, hornMat);
      hornR.position.set(0.25, 1.55, 0);
      hornR.rotation.z = 0.3;
      group.add(hornR);

      // Limbs
      const limbGeo = new THREE.BoxGeometry(0.22, 0.65, 0.25);
      const limbMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12 });
      leftLimb = new THREE.Mesh(limbGeo, limbMat);
      leftLimb.position.set(-0.22, 0.35, 0);
      leftLimb.castShadow = true;
      group.add(leftLimb);

      rightLimb = new THREE.Mesh(limbGeo, limbMat);
      rightLimb.position.set(0.22, 0.35, 0);
      rightLimb.castShadow = true;
      group.add(rightLimb);
    }

    // Overhead Health Bar
    const hpGroup = new THREE.Group();
    const hpBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.74, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
    );
    hpGroup.add(hpBg);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide })
    );
    hpFill.position.z = 0.005;
    hpGroup.add(hpFill);

    const barY = type === 'BRUTE' ? 1.85 : 1.45;
    hpGroup.position.set(0, barY, 0);
    group.add(hpGroup);

    return {
      group,
      targetPos: new THREE.Vector3(),
      targetRotY: 0,
      type,
      healthBarFill: hpFill,
      bodyMesh,
      lastHealth: config.health,
      hitFlashTimer: 0,
      walkCycleTime: Math.random() * Math.PI * 2,
      leftLimb,
      rightLimb,
    };
  }
}
