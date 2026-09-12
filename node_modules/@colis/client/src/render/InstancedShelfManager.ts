import * as THREE from 'three';
import { PRODUCTS, ShelfState } from '@colis/shared';

interface InstanceBuffer {
  mesh: THREE.InstancedMesh;
  maxCount: number;
  currentCount: number;
}

export class InstancedShelfManager {
  private scene: THREE.Scene;
  private productBuffers: Map<string, InstanceBuffer> = new Map();
  private dummyTransform: THREE.Object3D = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initProductMeshes();
  }

  private initProductMeshes(): void {
    for (const [productId, prod] of Object.entries(PRODUCTS)) {
      const geometry = this.createProductGeometry(prod);
      const material = this.createProductMaterial(prod);

      const maxInstances = 600; // supports hundreds of items on display
      const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0; // initial visible count is 0

      this.scene.add(mesh);

      this.productBuffers.set(productId, {
        mesh,
        maxCount: maxInstances,
        currentCount: 0,
      });
    }
  }

  private createProductGeometry(prod: any): THREE.BufferGeometry {
    switch (prod.modelType) {
      case 'can':
        return new THREE.CylinderGeometry(
          prod.dimensions.width / 2,
          prod.dimensions.width / 2,
          prod.dimensions.height,
          16
        );

      case 'carton':
      case 'box_tall':
      case 'box_wide':
        return new THREE.BoxGeometry(
          prod.dimensions.width,
          prod.dimensions.height,
          prod.dimensions.depth
        );

      case 'bottle':
        return new THREE.CylinderGeometry(
          prod.dimensions.width / 2.2,
          prod.dimensions.width / 2,
          prod.dimensions.height,
          16
        );

      default:
        return new THREE.BoxGeometry(0.12, 0.2, 0.12);
    }
  }

  private createProductMaterial(prod: any): THREE.Material {
    if (prod.modelType === 'can') {
      return new THREE.MeshStandardMaterial({
        color: prod.color,
        metalness: 0.65,
        roughness: 0.25,
      });
    }

    if (prod.modelType === 'bottle') {
      return new THREE.MeshPhysicalMaterial({
        color: prod.color,
        roughness: 0.15,
        transmission: 0.3,
        thickness: 0.5,
      });
    }

    return new THREE.MeshStandardMaterial({
      color: prod.color,
      roughness: 0.4,
      metalness: 0.1,
    });
  }

  /**
   * Rebuilds instanced matrices for all shelves currently in the store.
   * Runs in milliseconds and batches all items into 5-6 draw calls!
   */
  public updateShelves(shelves: Record<string, ShelfState> | Map<string, ShelfState>): void {
    // Reset instance counters
    for (const buffer of this.productBuffers.values()) {
      buffer.currentCount = 0;
    }

    const shelfList = shelves instanceof Map ? Array.from(shelves.values()) : Object.values(shelves);

    for (const shelf of shelfList) {
      const shelfPos = new THREE.Vector3(shelf.position.x, shelf.position.y, shelf.position.z);
      const shelfRotY = shelf.rotationY;

      for (const slot of shelf.slots) {
        if (!slot.productId || slot.count <= 0) continue;

        const buffer = this.productBuffers.get(slot.productId);
        if (!buffer) continue;

        const prod = PRODUCTS[slot.productId];
        if (!prod) continue;

        // Shelf local slot position
        const slotLocalPos = new THREE.Vector3(
          slot.localOffset.x,
          slot.localOffset.y + prod.dimensions.height / 2, // rest on shelf plate
          slot.localOffset.z
        );

        // A slot can have multiple items lined up in depth (Z-axis of the slot)
        const depthSpacing = prod.dimensions.depth * 1.15;
        const totalDepth = (slot.count - 1) * depthSpacing;
        const startZ = -totalDepth / 2;

        for (let itemIdx = 0; itemIdx < slot.count; itemIdx++) {
          if (buffer.currentCount >= buffer.maxCount) break;

          const itemLocalPos = slotLocalPos.clone();
          itemLocalPos.z += startZ + itemIdx * depthSpacing;

          // Apply shelf rotation to local slot offset
          itemLocalPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), shelfRotY);

          // World position
          const worldPos = shelfPos.clone().add(itemLocalPos);

          this.dummyTransform.position.copy(worldPos);
          this.dummyTransform.rotation.set(0, shelfRotY, 0);
          this.dummyTransform.scale.set(1, 1, 1);
          this.dummyTransform.updateMatrix();

          buffer.mesh.setMatrixAt(buffer.currentCount, this.dummyTransform.matrix);
          buffer.currentCount++;
        }
      }
    }

    // Apply updates to GPU buffers
    for (const buffer of this.productBuffers.values()) {
      buffer.mesh.count = buffer.currentCount;
      buffer.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
