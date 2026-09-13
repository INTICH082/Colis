import * as THREE from 'three';
import {
  BoxState,
  InitRoomPayload,
  PRODUCTS,
  PlayerState,
  RoomState,
  SHELF_CONFIG,
  ShelfState,
  WorldTickPayload,
  cameraToWorldInput,
  distance,
  distanceXZ,
} from '@colis/shared';
import { GameRenderer } from './render/GameRenderer.js';
import { AtmosphereManager } from './render/AtmosphereManager.js';
import { StoreEnvironment } from './render/StoreEnvironment.js';
import { InstancedShelfManager } from './render/InstancedShelfManager.js';
import { BoxEntityManager } from './entities/BoxEntityManager.js';
import { PlayerEntity } from './entities/PlayerEntity.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { NetworkClient } from './network/NetworkClient.js';
import { UIOverlay } from './ui/UIOverlay.js';

class ColisGame {
  private canvas: HTMLCanvasElement;
  private renderer: GameRenderer;
  private atmosphere: AtmosphereManager;
  private physics: PhysicsWorld;
  private lastTackleTime: number = 0;
  private environment: StoreEnvironment;
  private shelfManager: InstancedShelfManager;
  private boxManager: BoxEntityManager;
  private ui: UIOverlay;
  private network: NetworkClient;

  private localPlayerId: string = '';
  private localPlayerState: PlayerState = {
    id: '',
    name: 'Работник',
    color: '#3b82f6',
    position: { x: 0, y: 0, z: 7 },
    rotationY: 0,
    isMoving: false,
    heldBoxId: null,
  };

  private remotePlayers: Map<string, PlayerEntity> = new Map();
  private localPlayerEntity: PlayerEntity | null = null;
  private currentRoom: RoomState | null = null;

  // Input state & Physics velocity
  private keys: Record<string, boolean> = {};
  private lastTime: number = performance.now();
  private networkSendTimer: number = 0;
  private verticalVelocity: number = 0;
  private isGrounded: boolean = true;

  // Sprint Stamina (5 seconds sprint, 2 seconds rest before gradual recovery)
  private readonly MAX_STAMINA: number = 5.0;
  private currentStamina: number = 5.0;
  private timeSinceSprint: number = 2.0;

  // Throw charge state
  private isChargingThrow: boolean = false;
  private throwChargeStartTime: number = 0;

  // Hovered target
  private hoveredSlot: { shelfId: string; slotIndex: number; mesh: THREE.Mesh } | null = null;
  private hoveredBox: { boxId: string; mesh: THREE.Mesh } | null = null;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new GameRenderer(this.canvas);
    this.atmosphere = new AtmosphereManager(this.renderer.scene, this.renderer.dirLight, this.renderer.ambientLight);
    this.environment = new StoreEnvironment(this.renderer.scene);
    this.shelfManager = new InstancedShelfManager(this.renderer.scene);
    this.boxManager = new BoxEntityManager(this.renderer.scene);
    this.physics = new PhysicsWorld();
    this.ui = new UIOverlay();

    // Determine WS server URL (uses current hostname, port 8080)
    const host = window.location.hostname || 'localhost';
    const serverUrl = `ws://${host}:8080`;

    this.network = new NetworkClient(serverUrl, {
      onInit: this.handleRoomInit,
      onWorldTick: this.handleWorldTick,
      onPlayerJoined: this.handlePlayerJoined,
      onPlayerLeft: this.handlePlayerLeft,
      onBoxChanged: this.handleBoxChanged,
      onShelfChanged: this.handleShelfChanged,
      onEconomyChanged: this.handleEconomyChanged,
      onNotification: (n) => this.ui.showNotification(n),
      onPlayerTackled: (data) => {
        const isLocalVictim = data.victimId === this.localPlayerId;
        const victim = isLocalVictim ? this.localPlayerEntity : this.remotePlayers.get(data.victimId);
        const duration = data.duration || 3.0;
        if (victim) {
          victim.knockdown(new THREE.Vector3(data.impulseX, 0, data.impulseZ), data.force || 1.0, duration);
          this.ui.showNotification({
            type: 'warning',
            message: isLocalVictim
              ? (data.attackerId === 'box' || !data.attackerId ? '😵 В тебя попала коробка! Оглушен на 3 сек!' : 'Тебя сбили с ног в рэгдолл!')
              : (data.attackerId === 'box' ? 'Игрока оглушило прилетевшей коробкой!' : 'Игрока сбили с ног!'),
          });
        }
      },
      onConnectionStatus: (connected) => {
        if (!connected) {
          this.ui.showNotification({
            type: 'error',
            message: 'Потеряна связь с сервером. Переподключение...',
          });
        }
      },
    });

    this.setupInputs();
    this.setupUICallbacks();
  }

  public async start(): Promise<void> {
    console.log('[ColisGame] Initializing Rapier3D physics engine...');
    await this.physics.init();
    console.log('[ColisGame] Loading 3D character model and animations...');
    await PlayerEntity.loadAssets().catch((err) => {
      console.warn('[ColisGame] Failed to preload character model:', err);
    });

    console.log('[ColisGame] Waiting for fonts to load...');
    if (document.fonts) {
      await document.fonts.ready;
    }

    console.log('[ColisGame] Physics, models and fonts ready. Connecting to multiplayer server...');

    // Ask user for their name if first time
    const savedName = localStorage.getItem('colis_player_name') || `Работник #${Math.floor(Math.random() * 900 + 100)}`;
    this.network.connect('store-main', savedName);

    this.lastTime = performance.now();
    requestAnimationFrame(this.gameLoop);
  }

  private setupInputs(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // Jump & Interaction keys
      if (e.code === 'Space') {
        if (this.isGrounded) {
          this.verticalVelocity = 5.8; // Snappy jump impulse
          this.isGrounded = false;
        }
      } else if (e.code === 'KeyE') {
        this.handleActionE();
      } else if (e.code === 'KeyR') {
        this.handleActionOpenBox();
      } else if (e.code === 'KeyG') {
        if (!e.repeat && this.localPlayerState.heldBoxId && !this.localPlayerEntity?.isKnockedDown()) {
          this.isChargingThrow = true;
          this.throwChargeStartTime = performance.now();
          this.ui.setThrowCharge(0);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;

      if (e.code === 'KeyG' && this.isChargingThrow) {
        this.finishThrowCharge();
      }
    });

    window.addEventListener('mousedown', (e) => {
      // Ignore if clicking UI elements
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return;

      if (e.button === 0) {
        // Left click: place product onto hovered shelf slot
        this.handleLeftClick();
      } else if (e.button === 2) {
        // Right click: take product from shelf
        this.handleRightClick();
      }
    });

    window.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        e.preventDefault();
      }
    });

    // Reset all pressed keys when window loses/gains focus or tab is hidden
    const clearKeys = () => {
      this.keys = {};
      if (this.isChargingThrow) {
        this.isChargingThrow = false;
        this.ui.setThrowCharge(null);
      }
    };

    window.addEventListener('blur', clearKeys);
    window.addEventListener('focus', clearKeys);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearKeys();
      }
    });

    // Notify server on browser tab close and disconnect cleanly
    const handleTabClose = () => {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/tab-closed');
        }
      } catch {}
      this.network.disconnect();
    };

    window.addEventListener('beforeunload', handleTabClose);
    window.addEventListener('pagehide', handleTabClose);
  }

  private setupUICallbacks(): void {
    this.ui.setCallbacks({
      onOrder: (productId, quantity) => {
        this.network.sendOrderDelivery(productId, quantity);
      },
      onChangeRoom: (roomId) => {
        this.network.connect(roomId, this.localPlayerState.name);
      },
    });
  }

  private handleActionE(): void {
    // If holding box, gentle drop
    if (this.localPlayerState.heldBoxId) {
      this.network.sendDropBox({ throwForce: 0 });
      return;
    }

    // If looking at a box nearby, pick it up
    if (this.hoveredBox) {
      this.network.sendPickupBox(this.hoveredBox.boxId, this.localPlayerState.position);
    }
  }

  private handleActionOpenBox(): void {
    if (this.localPlayerState.heldBoxId) {
      this.network.sendOpenBox(undefined, this.localPlayerState.position);
    } else if (this.hoveredBox) {
      this.network.sendOpenBox(this.hoveredBox.boxId, this.localPlayerState.position);
    }
  }

  private updateThrowCharging(): void {
    if (!this.isChargingThrow) return;

    if (!this.localPlayerState.heldBoxId || this.localPlayerEntity?.isKnockedDown()) {
      this.isChargingThrow = false;
      this.ui.setThrowCharge(null);
      return;
    }

    const elapsedSec = (performance.now() - this.throwChargeStartTime) / 1000;
    if (elapsedSec < 0.2) {
      this.ui.setThrowCharge(0);
    } else {
      const ratio = THREE.MathUtils.clamp((elapsedSec - 0.2) / 1.0, 0, 1);
      this.ui.setThrowCharge(ratio);
    }
  }

  private finishThrowCharge(): void {
    if (!this.isChargingThrow) return;
    this.isChargingThrow = false;
    this.ui.setThrowCharge(null);

    if (!this.localPlayerState.heldBoxId) return;

    const elapsedSec = (performance.now() - this.throwChargeStartTime) / 1000;
    // Quick tap (< 0.2s): gentle placement on floor right in front
    if (elapsedSec < 0.2) {
      this.network.sendDropBox({ throwForce: 0 });
      return;
    }

    // Charged throw: 0.2s to 1.2s maps to force 0.1 .. 1.0
    const forceRatio = THREE.MathUtils.clamp((elapsedSec - 0.2) / 1.0, 0.1, 1.0);
    const rotY = this.localPlayerState.rotationY;
    const horizSpeed = 3.5 + forceRatio * 11.5; // 3.5m/s to 15.0m/s
    const vx = -Math.sin(rotY) * horizSpeed;
    const vz = -Math.cos(rotY) * horizSpeed;
    const vy = 1.6 + forceRatio * 3.6;

    this.network.sendDropBox({
      throwForce: forceRatio,
      throwVelocity: { x: vx, y: vy, z: vz },
    });
  }

  private handleLeftClick(): void {
    if (!this.localPlayerState.heldBoxId) return;

    if (this.hoveredSlot) {
      this.network.sendPlaceProduct(
        this.hoveredSlot.shelfId,
        this.hoveredSlot.slotIndex,
        this.localPlayerState.position
      );
    }
  }

  private handleRightClick(): void {
    if (!this.localPlayerState.heldBoxId) return;

    if (this.hoveredSlot) {
      this.network.sendTakeProduct(
        this.hoveredSlot.shelfId,
        this.hoveredSlot.slotIndex,
        this.localPlayerState.position
      );
    }
  }

  private handleRoomInit = (data: InitRoomPayload): void => {
    this.localPlayerId = data.yourPlayerId;
    this.currentRoom = data.room;

    // Build shelves
    this.environment.syncShelves(data.room.shelves);
    this.shelfManager.updateShelves(data.room.shelves);
    this.physics.registerShelves(data.room.shelves);

    // Sync boxes
    this.boxManager.syncBoxes(data.room.boxes);

    // Sync economy & UI
    this.ui.updateMoney(data.room.storeMoney);
    this.ui.updateRoomInfo(data.room.roomId, Object.keys(data.room.players).length);

    // Spawn local player & remote players
    for (const [id, pState] of Object.entries(data.room.players)) {
      if (id === this.localPlayerId) {
        this.localPlayerState = { ...pState };
        this.physics.teleportPlayer(pState.position);

        if (!this.localPlayerEntity) {
          this.localPlayerEntity = new PlayerEntity(pState, true);
          this.renderer.scene.add(this.localPlayerEntity.group);
        }
      } else {
        const remote = new PlayerEntity(pState, false);
        this.remotePlayers.set(id, remote);
        this.renderer.scene.add(remote.group);
      }
    }

    this.ui.showNotification({
      type: 'success',
      message: `Добро пожаловать в ${data.room.name}!`,
    });
  };

  private handleWorldTick = (tick: WorldTickPayload): void => {
    for (const [id, pData] of Object.entries(tick.players)) {
      if (id === this.localPlayerId) {
        // Update local held box state if server changed it
        this.localPlayerState.heldBoxId = pData.heldBoxId;
      } else {
        const remote = this.remotePlayers.get(id);
        if (remote) {
          remote.updateState(
            {
              id,
              name: '',
              color: '',
              position: pData.position,
              rotationY: pData.rotationY,
              isMoving: pData.isMoving,
              heldBoxId: pData.heldBoxId,
            },
            false
          );
        }
      }
    }

    this.updateHeldBoxUI();
  };

  private handlePlayerJoined = (player: PlayerState): void => {
    if (player.id === this.localPlayerId) return;

    if (!this.remotePlayers.has(player.id)) {
      const remote = new PlayerEntity(player, false);
      this.remotePlayers.set(player.id, remote);
      this.renderer.scene.add(remote.group);
    }
    if (this.currentRoom) {
      this.currentRoom.players[player.id] = player;
      this.ui.updateRoomInfo(this.currentRoom.roomId, Object.keys(this.currentRoom.players).length);
    }
  };

  private handlePlayerLeft = (playerId: string): void => {
    const remote = this.remotePlayers.get(playerId);
    if (remote) {
      remote.destroy(this.renderer.scene);
      this.remotePlayers.delete(playerId);
    }
    if (this.currentRoom) {
      delete this.currentRoom.players[playerId];
      this.ui.updateRoomInfo(this.currentRoom.roomId, Object.keys(this.currentRoom.players).length);
    }
  };

  private handleShelfChanged = (shelf: ShelfState): void => {
    if (this.currentRoom) {
      this.currentRoom.shelves[shelf.id] = shelf;
      this.shelfManager.updateShelves(this.currentRoom.shelves);
    }
  };

  private handleBoxChanged = (box: BoxState): void => {
    if (this.currentRoom) {
      this.currentRoom.boxes[box.id] = box;
      this.boxManager.syncBoxes(this.currentRoom.boxes);
    }
    this.updateHeldBoxUI();
  };

  private handleEconomyChanged = (data: { storeMoney: number; storeLevel: number }): void => {
    this.ui.updateMoney(data.storeMoney);
  };

  private updateHeldBoxUI(): void {
    if (!this.localPlayerState.heldBoxId || !this.currentRoom) {
      this.ui.setHeldBox(null);
      return;
    }

    const box = this.currentRoom.boxes[this.localPlayerState.heldBoxId];
    if (!box) {
      this.ui.setHeldBox(null);
      return;
    }

    const prod = PRODUCTS[box.productId];
    this.ui.setHeldBox({
      name: prod?.name || box.productId,
      remaining: box.remainingItems,
      max: box.maxItems,
      isOpen: box.isOpen,
    });
  }

  private gameLoop = (): void => {
    requestAnimationFrame(this.gameLoop);

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.updatePlayerMovement(dt);
    this.updateThrowCharging();
    this.boxManager.update(dt);
    this.updateRaycasting();
    this.updateInterpolations(dt);

    // Camera follow & Wall Occlusion Fading
    if (this.localPlayerEntity) {
      this.renderer.updateCamera(this.localPlayerEntity.group.position, dt);
      this.environment.updateWallOcclusion(this.renderer.camera.position, this.localPlayerEntity.group.position, dt);
    }

    // Update sky dome and ocean waves
    this.atmosphere.update(dt, this.renderer.camera.position);

    // Render 3D Scene
    this.renderer.render();
  };

  private updatePlayerMovement(dt: number): void {
    // If local player is knocked down / getting up, disable input and apply sliding physics
    if (this.localPlayerEntity?.isKnockedDown()) {
      this.localPlayerEntity.tick(dt, false, false, false, 0, 0);
      const slidPos = this.localPlayerEntity.group.position;
      this.localPlayerState.position.x = slidPos.x;
      this.localPlayerState.position.y = slidPos.y;
      this.localPlayerState.position.z = slidPos.z;
      this.physics.playerBody.setNextKinematicTranslation(slidPos);

      this.networkSendTimer += dt;
      if (this.networkSendTimer >= 0.04) {
        this.networkSendTimer = 0;
        this.network.sendInput({
          position: {
            x: Number(slidPos.x.toFixed(3)),
            y: Number(slidPos.y.toFixed(3)),
            z: Number(slidPos.z.toFixed(3)),
          },
          rotationY: Number(this.localPlayerState.rotationY.toFixed(3)),
          isMoving: false,
          isSprinting: false,
          deltaMs: 40,
        });
      }
      return;
    }

    let inputX = 0;
    let inputZ = 0;

    if (this.keys['KeyW'] || this.keys['ArrowUp']) inputZ -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) inputZ += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) inputX -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) inputX += 1;

    const shiftPressed = !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight'];

    // Convert screen WASD into isometric camera-relative world direction
    const worldDir = cameraToWorldInput(inputX, inputZ);
    const isMoving = Math.hypot(worldDir.x, worldDir.z) > 0.05;

    // Sprint Stamina: 5 seconds max sprint, 2 seconds delay before gradual recovery
    let isSprinting = false;
    if (shiftPressed && isMoving && this.currentStamina > 0.05) {
      isSprinting = true;
      this.currentStamina = Math.max(0, this.currentStamina - dt);
      this.timeSinceSprint = 0;
    } else {
      isSprinting = false;
      this.timeSinceSprint += dt;
      if (this.timeSinceSprint >= 2.0) {
        // Recovers to full over ~3.5s after 2s cooldown
        this.currentStamina = Math.min(this.MAX_STAMINA, this.currentStamina + dt * (this.MAX_STAMINA / 3.5));
      }
    }

    this.ui.setStamina(this.currentStamina / this.MAX_STAMINA);

    const speed = isSprinting ? 7.0 : 4.5;

    // Vertical jump and gravity physics simulation
    const wasGrounded = this.physics.isGrounded();
    if (wasGrounded && this.verticalVelocity <= 0) {
      this.isGrounded = true;
      this.verticalVelocity = -0.5; // gentle grounding bias
    } else {
      this.isGrounded = false;
      this.verticalVelocity -= 18.0 * dt; // gravity
    }

    // Movement via Rapier3D Kinematic Character Controller
    const desiredDelta = {
      x: worldDir.x * speed * dt,
      y: this.verticalVelocity * dt,
      z: worldDir.z * speed * dt,
    };

    const newPos = this.physics.computePlayerMovement(desiredDelta);
    if (newPos.y <= 0.05) {
      newPos.y = 0;
      this.isGrounded = true;
      if (this.verticalVelocity < 0) this.verticalVelocity = 0;
    }
    this.localPlayerState.position = newPos;

    // Rotate player towards mouse aim or movement direction
    const mouseFloor = this.renderer.getGroundIntersection(0.8);
    if (mouseFloor) {
      const dx = mouseFloor.x - newPos.x;
      const dz = mouseFloor.z - newPos.z;
      this.localPlayerState.rotationY = Math.atan2(dx, dz) + Math.PI;
    } else if (isMoving) {
      this.localPlayerState.rotationY = Math.atan2(worldDir.x, worldDir.z) + Math.PI;
    }

    // Player is only considered airborne when clearly elevated above floor
    const isAirborne = !this.isGrounded && newPos.y > 0.15;

    // Sync visual player mesh and procedural ragdoll
    if (this.localPlayerEntity) {
      this.localPlayerEntity.group.position.set(newPos.x, newPos.y, newPos.z);
      this.localPlayerEntity.group.rotation.y = this.localPlayerState.rotationY;
      this.localPlayerEntity.updateState(this.localPlayerState, true);
      this.localPlayerEntity.tick(
        dt,
        isMoving,
        isSprinting,
        isAirborne,
        worldDir.x,
        worldDir.z
      );
    }

    const nowSec = performance.now() / 1000;

    // Check Player-vs-Player Sprint Tackle
    if (isSprinting && isMoving && speed > 5.2 && nowSec - this.lastTackleTime > 1.2) {
      for (const [remoteId, remotePlayer] of this.remotePlayers.entries()) {
        if (remotePlayer.isKnockedDown()) continue;
        const distToOther = Math.hypot(
          newPos.x - remotePlayer.group.position.x,
          newPos.z - remotePlayer.group.position.z
        );
        if (distToOther < 0.95) {
          this.lastTackleTime = nowSec;
          const tackleImpulse = new THREE.Vector3(worldDir.x, 0, worldDir.z).normalize();
          remotePlayer.knockdown(tackleImpulse, 1.4, 3.0);
          this.network.sendPlayerTackle(remoteId, tackleImpulse.x, tackleImpulse.z, 1.4, 3.0);

          // Local player impact recoil
          if (this.localPlayerEntity?.ragdoll) {
            this.localPlayerEntity.ragdoll.torsoPitchSpring.impulse(-2.2);
            this.localPlayerEntity.ragdoll.torsoYSpring.impulse(-1.2);
          }
          this.ui.showNotification({
            type: 'success',
            message: '💥 Ты с разбега сбил игрока в рэгдолл!',
          });
          break;
        }
      }
    }

    // Send input to server at tick rate (~25Hz)
    this.networkSendTimer += dt;
    if (this.networkSendTimer >= 0.04) {
      const sendDeltaMs = Math.round(this.networkSendTimer * 1000);
      this.networkSendTimer = 0;
      this.network.sendInput({
        position: {
          x: Number(newPos.x.toFixed(3)),
          y: Number(newPos.y.toFixed(3)),
          z: Number(newPos.z.toFixed(3)),
        },
        rotationY: Number(this.localPlayerState.rotationY.toFixed(3)),
        isMoving,
        isSprinting,
        deltaMs: sendDeltaMs,
      });
    }
  }

  private updateRaycasting(): void {
    this.renderer.raycaster.setFromCamera(this.renderer.mousePos, this.renderer.camera);

    // 1. Raycast Shelf Slots
    const slotHits = this.renderer.raycaster.intersectObjects(
      this.environment.slotHitboxes.map((s) => s.mesh),
      false
    );

    if (this.hoveredSlot) {
      (this.hoveredSlot.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
      this.hoveredSlot = null;
    }

    if (slotHits.length > 0) {
      const hit = slotHits[0];
      const data = hit.object.userData;
      if (data?.type === 'shelf_slot') {
        const shelf = this.currentRoom?.shelves[data.shelfId];
        const slot = shelf?.slots[data.slotIndex];

        if (shelf && slot) {
          const distToShelf = distanceXZ(this.localPlayerState.position, shelf.position);
          if (distToShelf <= 3.8) {
            this.hoveredSlot = {
              shelfId: data.shelfId,
              slotIndex: data.slotIndex,
              mesh: hit.object as THREE.Mesh,
            };
            (this.hoveredSlot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;

            // Formulate prompt
            if (this.localPlayerState.heldBoxId && this.currentRoom) {
              const heldBox = this.currentRoom.boxes[this.localPlayerState.heldBoxId];
              const prod = heldBox ? PRODUCTS[heldBox.productId] : null;

              if (heldBox && !heldBox.isOpen) {
                this.ui.setInteractionPrompt('Сначала откройте коробку (нажмите R)', 'R');
              } else if (slot.productId && slot.productId !== heldBox?.productId && slot.count > 0) {
                this.ui.setInteractionPrompt(`Слот занят другим товаром (${PRODUCTS[slot.productId]?.name})`, '!');
              } else if (slot.count >= slot.maxCount) {
                this.ui.setInteractionPrompt(`Слот полон (макс. ${slot.maxCount} шт.)`, '!');
              } else {
                this.ui.setInteractionPrompt(
                  `[ЛКМ] Выставить ${prod?.name || 'товар'} (Слот ${slot.index + 1}: ${slot.count}/${slot.maxCount})`,
                  'ЛКМ'
                );
              }
              return;
            } else if (slot.count > 0) {
              const prod = PRODUCTS[slot.productId || ''];
              this.ui.setInteractionPrompt(
                `Полка: ${prod?.name || 'Товар'} (${slot.count} шт.)`,
                'Инфо'
              );
              return;
            }
          }
        }
      }
    }

    // 2. Raycast Floor Boxes
    const boxHits = this.renderer.raycaster.intersectObjects(this.boxManager.interactiveBoxes, false);
    this.hoveredBox = null;

    if (boxHits.length > 0) {
      const hit = boxHits[0];
      const boxId = hit.object.userData?.boxId;
      const box = this.currentRoom?.boxes[boxId];

      if (box && !box.isHeld) {
        const distToBox = distanceXZ(this.localPlayerState.position, box.position);
        if (distToBox <= 3.5) {
          this.hoveredBox = {
            boxId,
            mesh: hit.object as THREE.Mesh,
          };

          const prod = PRODUCTS[box.productId];
          if (!this.localPlayerState.heldBoxId) {
            if (!box.isOpen) {
              this.ui.setInteractionPrompt(
                `[E] Взять | [R] Открыть: "${prod?.name || box.productId}" (${box.remainingItems}/${box.maxItems})`,
                'E'
              );
            } else {
              this.ui.setInteractionPrompt(
                `[E] Взять коробку: "${prod?.name || box.productId}" (${box.remainingItems}/${box.maxItems})`,
                'E'
              );
            }
            return;
          }
        }
      }
    }

    // If nothing interactive hovered
    this.ui.setInteractionPrompt(null);
  }

  private updateInterpolations(dt: number): void {
    for (const remote of this.remotePlayers.values()) {
      remote.tickInterpolation(dt, false);
    }
  }
}

// Bootstrap application on window load
window.addEventListener('DOMContentLoaded', () => {
  const game = new ColisGame();
  game.start().catch((err) => {
    console.error('[ColisGame] Fatal init error:', err);
  });
});
