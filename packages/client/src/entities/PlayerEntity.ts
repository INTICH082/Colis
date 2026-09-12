import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PlayerState } from '@colis/shared';

interface LoadedCharacterAssets {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export class PlayerEntity {
  private static cachedAssets: LoadedCharacterAssets | null = null;
  private static loadPromise: Promise<LoadedCharacterAssets> | null = null;

  public id: string;
  public group: THREE.Group;
  private modelRoot: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private currentActionName: string = 'idle';

  private nameSprite!: THREE.Sprite;
  private heldBoxMesh!: THREE.Group;
  private heldBoxItemsGroup!: THREE.Group;

  private targetPosition: THREE.Vector3 = new THREE.Vector3();
  private lastPosition: THREE.Vector3 = new THREE.Vector3();
  private targetRotationY: number = 0;

  /**
   * Preloads character 3D model and animations once for all players.
   */
  public static async loadAssets(): Promise<LoadedCharacterAssets> {
    if (this.cachedAssets) return this.cachedAssets;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise<LoadedCharacterAssets>((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        '/models/characters/colis.glb',
        (gltf) => {
          // Configure textures and shadows
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;

              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat && mat.map) {
                // Pixelated texture filtering for clean Blockbench look
                mat.map.magFilter = THREE.NearestFilter;
                mat.map.minFilter = THREE.NearestMipmapLinearFilter;
                mat.map.needsUpdate = true;
              }
            }
          });

          PlayerEntity.cachedAssets = {
            scene: gltf.scene,
            animations: gltf.animations,
          };
          console.log(`[PlayerEntity] Loaded character GLB with ${gltf.animations.length} animations:`,
            gltf.animations.map(a => a.name)
          );
          resolve(PlayerEntity.cachedAssets);
        },
        undefined,
        (err) => {
          console.warn('[PlayerEntity] Failed to load colis.glb, fallback will be used:', err);
          reject(err);
        }
      );
    });

    return this.loadPromise;
  }

  constructor(state: PlayerState, isLocal: boolean) {
    this.id = state.id;
    this.group = new THREE.Group();
    this.group.position.set(state.position.x, state.position.y, state.position.z);
    this.group.rotation.y = state.rotationY;
    this.targetPosition.copy(this.group.position);
    this.lastPosition.copy(this.group.position);

    // 1. Attach 3D Model & Animations
    this.setupCharacterModel();

    // 2. Hands / Held item anchor (in front of employee)
    this.heldBoxMesh = this.buildHeldBox();
    this.heldBoxMesh.position.set(0, 0.75, -0.45);
    this.heldBoxMesh.visible = false;
    this.group.add(this.heldBoxMesh);

    // 3. Name Tag Billboard Sprite
    this.nameSprite = this.createNameSprite(state.name, state.color, isLocal);
    this.nameSprite.position.set(0, 1.95, 0);
    this.group.add(this.nameSprite);
  }

  private setupCharacterModel(): void {
    if (PlayerEntity.cachedAssets) {
      this.attachLoadedModel(PlayerEntity.cachedAssets);
    } else {
      // Lazy load if not already loaded
      PlayerEntity.loadAssets()
        .then((assets) => this.attachLoadedModel(assets))
        .catch(() => this.buildFallbackGeometry());
    }
  }

  private attachLoadedModel(assets: LoadedCharacterAssets): void {
    if (this.modelRoot) return;

    // Clone skinned mesh and skeleton safely
    this.modelRoot = SkeletonUtils.clone(assets.scene) as THREE.Group;
    this.modelRoot.position.set(0, 0, 0);
    // Rotate 180 degrees to face forward properly with movement and aim
    this.modelRoot.rotation.y = Math.PI;
    this.group.add(this.modelRoot);

    // Setup animation mixer
    this.mixer = new THREE.AnimationMixer(this.modelRoot);
    assets.animations.forEach((clip) => {
      const action = this.mixer!.clipAction(clip);
      if (clip.name === 'jump') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.actions.set(clip.name, action);
    });

    // Start with idle
    const idleAction = this.actions.get('idle');
    if (idleAction) {
      idleAction.play();
      this.currentActionName = 'idle';
    }
  }

  private buildFallbackGeometry(): void {
    if (this.modelRoot) return;
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.22, 0.9, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
    const mesh = new THREE.Mesh(bodyGeo, bodyMat);
    mesh.position.y = 0.85;
    this.group.add(mesh);
  }

  public fadeToAnimation(animName: string, duration: number = 0.22): void {
    if (!this.mixer || this.currentActionName === animName) return;

    const prevAction = this.actions.get(this.currentActionName);
    const nextAction = this.actions.get(animName);

    if (!nextAction) return;

    // Jump should always start from frame 0 (liftoff).
    // Looping animations (idle/walk/run) only reset if stopped or disabled,
    // ensuring smooth motion continuity without popping or stuttering.
    if (animName === 'jump' || !nextAction.isRunning() || !nextAction.enabled) {
      nextAction.reset();
    }

    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1);

    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, duration, false);
    } else {
      nextAction.fadeIn(duration);
    }

    nextAction.play();
    this.currentActionName = animName;
  }

  private createNameSprite(name: string, color: string, isLocal: boolean): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.roundRect(10, 10, 236, 44, 12);
    ctx.fill();
    ctx.strokeStyle = color || '#38bdf8';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "Handgeschrieben", cursive, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isLocal ? `${name} (Вы)` : name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.4, 0.35, 1);
    return sprite;
  }

  private buildHeldBox(): THREE.Group {
    const boxGroup = new THREE.Group();

    const cardboardMat = new THREE.MeshStandardMaterial({
      color: 0xcd853f,
      roughness: 0.85,
    });

    const boxW = 0.45;
    const boxH = 0.32;
    const boxD = 0.35;

    const body = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), cardboardMat);
    body.castShadow = true;
    body.receiveShadow = true;
    boxGroup.add(body);

    this.heldBoxItemsGroup = new THREE.Group();
    this.heldBoxItemsGroup.position.set(0, 0.05, 0);
    boxGroup.add(this.heldBoxItemsGroup);

    return boxGroup;
  }

  public updateState(state: PlayerState, isLocal: boolean): void {
    if (!isLocal) {
      this.targetPosition.set(state.position.x, state.position.y, state.position.z);
      this.targetRotationY = state.rotationY;
    }

    // Held box visibility
    if (state.heldBoxId) {
      this.heldBoxMesh.visible = true;
    } else {
      this.heldBoxMesh.visible = false;
    }
  }

  /**
   * Main tick for local player animation updates
   */
  public tick(dt: number, isMoving: boolean, isSprinting: boolean, isAirborne: boolean = false): void {
    if (this.mixer) {
      this.mixer.update(dt);
    }

    if (isAirborne) {
      this.fadeToAnimation('jump', 0.18);
    } else if (isMoving) {
      if (isSprinting) {
        this.fadeToAnimation('run', 0.22);
      } else {
        this.fadeToAnimation('walk', 0.22);
      }
    } else {
      this.fadeToAnimation('idle', 0.25);
    }
  }

  /**
   * Interpolation and animation update for remote multiplayer players
   */
  public tickInterpolation(dt: number, isLocal: boolean): void {
    if (!isLocal) {
      // Smooth lerp for remote players
      this.group.position.lerp(this.targetPosition, 15 * dt);

      // Slerp rotation angle
      let diff = this.targetRotationY - this.group.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.group.rotation.y += diff * 15 * dt;

      // Determine movement state from velocity
      const distMoved = this.group.position.distanceTo(this.lastPosition);
      const speed = distMoved / Math.max(dt, 0.001);
      this.lastPosition.copy(this.group.position);

      const isMoving = speed > 0.25;
      const isSprinting = speed > 5.2;
      const isAirborne = this.group.position.y > 0.18;

      this.tick(dt, isMoving, isSprinting, isAirborne);
    }
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
