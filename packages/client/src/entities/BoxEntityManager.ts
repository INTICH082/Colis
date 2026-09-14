import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BoxState, PRODUCTS } from '@colis/shared';

interface LoadedBoxAssets {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

interface BoxEntry {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction | null;
  isOpen: boolean;
}

export class BoxEntityManager {
  private scene: THREE.Scene;
  private boxEntries: Map<string, BoxEntry> = new Map();
  public interactiveBoxes: THREE.Mesh[] = [];

  private static cardboardAsset: LoadedBoxAssets | null = null;
  private static productAssets: Map<string, THREE.Group> = new Map();
  private static loadPromise: Promise<void> | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public static async loadAssets(): Promise<void> {
    if (this.cardboardAsset) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise<void>((resolve, reject) => {
      const loader = new GLTFLoader();
      const productFiles: Array<{ id: string; url: string }> = [
        { id: 'cola_can', url: '/models/products/cola.glb' },
        { id: 'chipsi', url: '/models/products/chipsi.glb' },
        { id: 'egg_tray', url: '/models/products/egg_tray.glb' },
        { id: 'single_egg', url: '/models/products/single_egg.glb' },
      ];

      loader.load(
        `/models/boxes/cardboard.glb?v=${Date.now()}`,
        (gltf) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat && mat.map) {
                mat.map.magFilter = THREE.NearestFilter;
                mat.map.minFilter = THREE.NearestMipmapLinearFilter;
                mat.map.needsUpdate = true;
              }
            }
          });

          BoxEntityManager.cardboardAsset = {
            scene: gltf.scene,
            animations: gltf.animations,
          };

          // Load product models
          let loadedCount = 0;
          const checkDone = () => {
            loadedCount++;
            if (loadedCount >= productFiles.length) {
              resolve();
            }
          };

          for (const item of productFiles) {
            loader.load(
              `${item.url}?v=${Date.now()}`,
              (pGltf) => {
                pGltf.scene.traverse((child) => {
                  if ((child as THREE.Mesh).isMesh) {
                    const mesh = child as THREE.Mesh;
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    const mat = mesh.material as THREE.MeshStandardMaterial;
                    if (mat && mat.map) {
                      mat.map.magFilter = THREE.NearestFilter;
                      mat.map.minFilter = THREE.NearestMipmapLinearFilter;
                      mat.map.needsUpdate = true;
                    }
                  }
                });
                BoxEntityManager.productAssets.set(item.id, pGltf.scene);
                checkDone();
              },
              undefined,
              (err) => {
                console.warn(`[BoxEntityManager] Failed to load product model ${item.id}:`, err);
                checkDone();
              }
            );
          }
        },
        undefined,
        (err) => {
          console.error('[BoxEntityManager] Failed to load cardboard model:', err);
          reject(err);
        }
      );
    });

    return this.loadPromise;
  }

  public syncBoxes(boxes: Record<string, BoxState> | Map<string, BoxState>): void {
    const boxList = boxes instanceof Map ? Array.from(boxes.values()) : Object.values(boxes);
    const activeIds = new Set<string>();

    for (const box of boxList) {
      activeIds.add(box.id);

      // If held by a player (currently disabled), hide
      if (box.isHeld) {
        const existing = this.boxEntries.get(box.id);
        if (existing) {
          existing.group.visible = false;
        }
        continue;
      }

      let entry = this.boxEntries.get(box.id);
      if (!entry) {
        entry = this.buildBoxMesh(box);
        this.boxEntries.set(box.id, entry);
        this.scene.add(entry.group);
      }

      entry.group.visible = true;
      if (!entry.group.userData.targetPosition) {
        entry.group.userData.targetPosition = new THREE.Vector3(box.position.x, box.position.y, box.position.z);
        entry.group.position.copy(entry.group.userData.targetPosition);
      } else {
        (entry.group.userData.targetPosition as THREE.Vector3).set(box.position.x, box.position.y, box.position.z);
      }
      entry.group.quaternion.set(box.rotation.x, box.rotation.y, box.rotation.z, box.rotation.w);

      // Check if open state changed
      if (box.isOpen && !entry.isOpen) {
        this.triggerOpenAnimation(entry);
      }
    }

    // Clean up removed boxes
    for (const [id, entry] of this.boxEntries) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.group);
        this.boxEntries.delete(id);
      }
    }

    this.rebuildInteractiveList();
  }

  public openBoxLocal(boxId: string): void {
    const entry = this.boxEntries.get(boxId);
    if (entry && !entry.isOpen) {
      this.triggerOpenAnimation(entry);
    }
  }

  private triggerOpenAnimation(entry: BoxEntry): void {
    entry.isOpen = true;
    if (entry.action) {
      entry.action.reset();
      entry.action.play();
    }
  }

  public update(dt: number): void {
    const lerpFactor = Math.min(1, 22 * dt);
    for (const entry of this.boxEntries.values()) {
      if (!entry.group.visible) continue;

      // Update animation mixer
      entry.mixer.update(dt);

      const targetPos = entry.group.userData.targetPosition as THREE.Vector3 | undefined;
      if (targetPos) {
        if (entry.group.position.distanceToSquared(targetPos) > 16) {
          entry.group.position.copy(targetPos);
        } else {
          entry.group.position.lerp(targetPos, lerpFactor);
        }
      }
    }
  }

  private buildBoxMesh(box: BoxState): BoxEntry {
    const rootGroup = new THREE.Group();
    const product = PRODUCTS[box.productId] || PRODUCTS['cola_can'];

    let mixer: THREE.AnimationMixer;
    let clipAction: THREE.AnimationAction | null = null;

    if (BoxEntityManager.cardboardAsset) {
      // Clone cardboard gltf model
      const cardboardClone = SkeletonUtils.clone(BoxEntityManager.cardboardAsset.scene);
      cardboardClone.scale.setScalar(0.65);
      rootGroup.add(cardboardClone);

      mixer = new THREE.AnimationMixer(cardboardClone);
      if (BoxEntityManager.cardboardAsset.animations.length > 0) {
        clipAction = mixer.clipAction(BoxEntityManager.cardboardAsset.animations[0]);
        clipAction.setLoop(THREE.LoopOnce, 1);
        clipAction.clampWhenFinished = true;
      }

      // Configure sticker label on front
      const stickerNode = cardboardClone.getObjectByName('sticker') as THREE.Mesh | undefined;
      if (stickerNode) {
        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 256;
        labelCanvas.height = 128;
        const ctx = labelCanvas.getContext('2d')!;
        ctx.fillStyle = product.color || '#e63946';
        ctx.fillRect(0, 0, 256, 128);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 8;
        ctx.strokeRect(6, 6, 244, 116);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px "Handgeschrieben", cursive, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(product.name, 128, 64);

        const labelTex = new THREE.CanvasTexture(labelCanvas);
        labelTex.magFilter = THREE.NearestFilter;
        stickerNode.material = new THREE.MeshStandardMaterial({
          map: labelTex,
          roughness: 0.8,
          metalness: 0.05,
        });
      }

      // Ensure all meshes in cardboard receive shadows, click raycast userData
      cardboardClone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = {
            type: 'box',
            boxId: box.id,
          };
        }
      });
    } else {
      // Fallback procedural box geometry if gltf asset not yet loaded
      mixer = new THREE.AnimationMixer(rootGroup);
      const fallbackGeo = new THREE.BoxGeometry(0.55, 0.38, 0.44);
      const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xc89666, roughness: 0.9 });
      const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
      fallbackMesh.position.y = 0.19;
      fallbackMesh.castShadow = true;
      fallbackMesh.receiveShadow = true;
      fallbackMesh.userData = { type: 'box', boxId: box.id };
      rootGroup.add(fallbackMesh);
    }

    // Add 3D items inside the box
    const contentsGroup = new THREE.Group();
    contentsGroup.name = 'contents';

    const pModel = BoxEntityManager.productAssets.get(box.productId);
    if (pModel) {
      if (box.productId === 'cola_can') {
        // Place 6 cans inside (2 x 3 grid)
        const xs = [-0.14, 0, 0.14];
        const zs = [-0.08, 0.08];
        for (const x of xs) {
          for (const z of zs) {
            const can = SkeletonUtils.clone(pModel);
            can.scale.setScalar(0.24);
            can.position.set(x, 0.02, z);
            contentsGroup.add(can);
          }
        }
      } else if (box.productId === 'chipsi') {
        // Place 4 bags of chips standing in box
        const xs = [-0.12, 0.12];
        const zs = [-0.07, 0.07];
        for (const x of xs) {
          for (const z of zs) {
            const bag = SkeletonUtils.clone(pModel);
            bag.scale.setScalar(0.26);
            bag.position.set(x, 0.02, z);
            bag.rotation.y = (Math.random() - 0.5) * 0.2;
            contentsGroup.add(bag);
          }
        }
      } else if (box.productId === 'egg_tray') {
        // Place 2 egg trays stacked inside
        const tray1 = SkeletonUtils.clone(pModel);
        tray1.scale.setScalar(0.14);
        tray1.position.set(0, 0.02, 0);
        contentsGroup.add(tray1);

        const tray2 = SkeletonUtils.clone(pModel);
        tray2.scale.setScalar(0.14);
        tray2.position.set(0, 0.12, 0);
        contentsGroup.add(tray2);
      } else {
        const single = SkeletonUtils.clone(pModel);
        single.scale.setScalar(0.3);
        single.position.set(0, 0.02, 0);
        contentsGroup.add(single);
      }
    } else {
      // Fallback simple product cylinders/boxes inside
      const count = Math.min(6, product.boxCapacity);
      for (let i = 0; i < count; i++) {
        const itemGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.16, 12);
        const itemMat = new THREE.MeshStandardMaterial({ color: product.color, roughness: 0.3 });
        const itemMesh = new THREE.Mesh(itemGeo, itemMat);
        const col = i % 3;
        const row = Math.floor(i / 3);
        itemMesh.position.set(-0.13 + col * 0.13, 0.1, -0.07 + row * 0.14);
        contentsGroup.add(itemMesh);
      }
    }

    // Set shadow and user data for all items inside
    contentsGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { type: 'box', boxId: box.id };
      }
    });
    rootGroup.add(contentsGroup);

    // If box is already open, fast-forward animation to completed state
    if (box.isOpen && clipAction) {
      clipAction.play();
      mixer.setTime(clipAction.getClip().duration);
      mixer.update(0);
    }

    return {
      group: rootGroup,
      mixer,
      action: clipAction,
      isOpen: box.isOpen,
    };
  }

  private rebuildInteractiveList(): void {
    this.interactiveBoxes = [];
    for (const entry of this.boxEntries.values()) {
      if (!entry.group.visible) continue;
      entry.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData?.type === 'box') {
          this.interactiveBoxes.push(child);
        }
      });
    }
  }

  public getBoxMesh(boxId: string): THREE.Group | undefined {
    return this.boxEntries.get(boxId)?.group;
  }
}
