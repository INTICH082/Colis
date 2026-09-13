import * as THREE from 'three';
import { BoxState, PRODUCTS } from '@colis/shared';

export class BoxEntityManager {
  private scene: THREE.Scene;
  private boxMeshes: Map<string, THREE.Group> = new Map();
  public interactiveBoxes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public syncBoxes(boxes: Record<string, BoxState> | Map<string, BoxState>): void {
    const boxList = boxes instanceof Map ? Array.from(boxes.values()) : Object.values(boxes);
    const activeIds = new Set<string>();

    for (const box of boxList) {
      activeIds.add(box.id);

      // If held by a player, the player entity handles rendering the held box in their hands
      if (box.isHeld) {
        const existing = this.boxMeshes.get(box.id);
        if (existing) {
          existing.visible = false;
        }
        continue;
      }

      let group = this.boxMeshes.get(box.id);
      if (!group) {
        group = this.buildBoxMesh(box);
        this.boxMeshes.set(box.id, group);
        this.scene.add(group);
      }

      group.visible = true;
      if (!group.userData.targetPosition) {
        group.userData.targetPosition = new THREE.Vector3(box.position.x, box.position.y, box.position.z);
        group.position.copy(group.userData.targetPosition);
      } else {
        (group.userData.targetPosition as THREE.Vector3).set(box.position.x, box.position.y, box.position.z);
      }
      group.quaternion.set(box.rotation.x, box.rotation.y, box.rotation.z, box.rotation.w);

      this.updateBoxFlaps(group, box.isOpen);
    }

    // Clean up removed boxes
    for (const [id, mesh] of this.boxMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.boxMeshes.delete(id);
      }
    }

    this.rebuildInteractiveList();
  }

  public update(dt: number): void {
    const lerpFactor = Math.min(1, 22 * dt);
    for (const group of this.boxMeshes.values()) {
      if (!group.visible) continue;
      const targetPos = group.userData.targetPosition as THREE.Vector3 | undefined;
      if (targetPos) {
        if (group.position.distanceToSquared(targetPos) > 16) {
          group.position.copy(targetPos);
        } else {
          group.position.lerp(targetPos, lerpFactor);
        }
      }
    }
  }

  private buildBoxMesh(box: BoxState): THREE.Group {
    const group = new THREE.Group();
    const product = PRODUCTS[box.productId] || PRODUCTS['cola_can'];

    const boxW = 0.52;
    const boxH = 0.36;
    const boxD = 0.42;

    const cardboardMat = new THREE.MeshStandardMaterial({
      color: 0xc89666,
      roughness: 0.9,
      metalness: 0.05,
    });

    // Main Box Body
    const bodyGeo = new THREE.BoxGeometry(boxW, boxH, boxD);
    const body = new THREE.Mesh(bodyGeo, cardboardMat);
    body.position.y = boxH / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData = {
      type: 'box',
      boxId: box.id,
    };
    group.add(body);

    // Front Product Label Decal
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 128;
    const ctx = labelCanvas.getContext('2d')!;
    ctx.fillStyle = product.color;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Handgeschrieben", cursive, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(product.name, 128, 64);

    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex });
    const labelGeo = new THREE.PlaneGeometry(0.32, 0.16);
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, boxH / 2, boxD / 2 + 0.002);
    group.add(label);

    // Top Flaps (4 pieces)
    const flapMat = cardboardMat.clone();
    const flapGeoW = new THREE.BoxGeometry(boxW * 0.48, 0.015, boxD * 0.48);

    const flapLeft = new THREE.Mesh(flapGeoW, flapMat);
    flapLeft.position.set(-boxW * 0.24, boxH + 0.01, 0);
    flapLeft.name = 'flap_left';
    group.add(flapLeft);

    const flapRight = new THREE.Mesh(flapGeoW, flapMat);
    flapRight.position.set(boxW * 0.24, boxH + 0.01, 0);
    flapRight.name = 'flap_right';
    group.add(flapRight);

    return group;
  }

  private updateBoxFlaps(group: THREE.Group, isOpen: boolean): void {
    const flapLeft = group.getObjectByName('flap_left');
    const flapRight = group.getObjectByName('flap_right');

    if (isOpen) {
      if (flapLeft) {
        flapLeft.rotation.z = -Math.PI * 0.65;
        flapLeft.position.x = -0.26;
      }
      if (flapRight) {
        flapRight.rotation.z = Math.PI * 0.65;
        flapRight.position.x = 0.26;
      }
    } else {
      if (flapLeft) {
        flapLeft.rotation.z = 0;
        flapLeft.position.x = -0.13;
      }
      if (flapRight) {
        flapRight.rotation.z = 0;
        flapRight.position.x = 0.13;
      }
    }
  }

  private rebuildInteractiveList(): void {
    this.interactiveBoxes = [];
    for (const group of this.boxMeshes.values()) {
      if (!group.visible) continue;
      for (const child of group.children) {
        if (child instanceof THREE.Mesh && child.userData?.type === 'box') {
          this.interactiveBoxes.push(child);
        }
      }
    }
  }

  public getBoxMesh(boxId: string): THREE.Group | undefined {
    return this.boxMeshes.get(boxId);
  }
}
