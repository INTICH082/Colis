import * as THREE from 'three';
import {
  BREAKER_CONFIG,
  BoxState,
  GameEventEndedPayload,
  GameEventState,
  GameEventTriggeredPayload,
  InitRoomPayload,
  PRODUCTS,
  PlayerState,
  RoomState,
  SHELF_CONFIG,
  ShelfState,
  ShiftState,
  UpgradesChangedPayload,
  WorldTickPayload,
  cameraToWorldInput,
  distanceXZ,
} from '@colis/shared';
import { GameRenderer } from './render/GameRenderer.js';
import { AtmosphereManager } from './render/AtmosphereManager.js';
import { StoreEnvironment } from './render/StoreEnvironment.js';
import { InstancedShelfManager } from './render/InstancedShelfManager.js';
import { BoxEntityManager } from './entities/BoxEntityManager.js';
import { PlayerEntity } from './entities/PlayerEntity.js';
import { CustomerEntityManager } from './entities/CustomerEntityManager.js';
import { MonsterEntityManager } from './entities/MonsterEntityManager.js';
import { CleanerBotEntity } from './entities/CleanerBotEntity.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { NetworkClient } from './network/NetworkClient.js';
import { UIOverlay } from './ui/UIOverlay.js';
import { SoundEffects } from './audio/SoundEffects.js';

class ColisGame {
  private canvas: HTMLCanvasElement;
  private renderer: GameRenderer;
  private atmosphere: AtmosphereManager;
  private physics: PhysicsWorld;
  private lastTackleTime: number = 0;
  private environment: StoreEnvironment;
  private shelfManager: InstancedShelfManager;
  private boxManager: BoxEntityManager;
  private customerManager: CustomerEntityManager;
  private monsterManager: MonsterEntityManager;
  private cleanerBot: CleanerBotEntity;
  private ui: UIOverlay;
  private network: NetworkClient;

  // Flashlight for Blackout event
  private flashlight: THREE.SpotLight;
  private flashlightTarget: THREE.Object3D;

  // Active dynamic game event
  private currentEvent: GameEventState | null = null;
  private isRepairingBreaker: boolean = false;

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
  private currentShift: ShiftState | null = null;
  private mySkills: string[] = [];
  private teamUnlocks: string[] = [];

  // Input state & Physics velocity
  private keys: Record<string, boolean> = {};
  private lastTime: number = performance.now();
  private networkSendTimer: number = 0;
  private verticalVelocity: number = 0;
  private isGrounded: boolean = true;

  // Sprint Stamina (5s or 10s with marathoner)
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
    this.customerManager = new CustomerEntityManager(this.renderer.scene);
    this.monsterManager = new MonsterEntityManager(this.renderer.scene);
    this.cleanerBot = new CleanerBotEntity(this.renderer.scene);
    this.physics = new PhysicsWorld();
    this.ui = new UIOverlay();

    // Setup player flashlight for blackout event
    this.flashlight = new THREE.SpotLight(0xffeedd, 3.5, 20, Math.PI / 5, 0.45, 1.2);
    this.flashlight.visible = false;
    this.renderer.scene.add(this.flashlight);
    this.flashlightTarget = new THREE.Object3D();
    this.renderer.scene.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

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
      onShiftChanged: this.handleShiftChanged,
      onUpgradesChanged: this.handleUpgradesChanged,
      onShiftSummary: (s) => this.ui.showShiftSummary(s),
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
              ? (data.attackerId === 'box' || !data.attackerId ? '😵 В тебя попала коробка! Оглушен на 3 сек!' : 'Тебя сбили с ног!')
              : (data.attackerId === 'box' ? 'Игрока оглушило прилетевшей коробкой!' : 'Игрока сбили с ног!'),
          });
        }
      },
      onGameEventTriggered: (data: GameEventTriggeredPayload) => {
        this.currentEvent = data.event;
        SoundEffects.playEventStart(data.event.type);
        if (data.event.type === 'blood_moon') {
          this.atmosphere.setBloodMoon(true);
        } else if (data.event.type === 'blackout') {
          this.atmosphere.setBlackout(true);
          this.flashlight.visible = true;
        }
        this.ui.updateEvent(data.event);
        this.ui.showNotification({
          type: 'warning',
          message: `Событие: ${data.event.title}!`,
        });
      },
      onGameEventEnded: (data: GameEventEndedPayload) => {
        if (data.success) {
          SoundEffects.playEventSuccess();
        } else {
          SoundEffects.playEventFail();
        }
        if (data.eventType === 'blood_moon') {
          this.atmosphere.setBloodMoon(false);
        } else if (data.eventType === 'blackout') {
          this.atmosphere.setBlackout(false);
          this.flashlight.visible = false;
        }
        this.currentEvent = null;
        this.ui.updateEvent(null);
        this.ui.updateBreakerUI(false, 0);
        if (this.isRepairingBreaker) {
          this.isRepairingBreaker = false;
          this.network.sendInteractBreaker(false);
        }
        this.ui.showNotification({
          type: data.success ? 'success' : 'info',
          message: data.rewardSummary,
        });
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

    console.log('[ColisGame] Preloading 3D models and textures...');
    await PlayerEntity.loadAssets().catch((err) => {
      console.warn('[ColisGame] Failed to preload character model:', err);
    });
    console.log('[ColisGame] Loading 3D box and product models...');
    await BoxEntityManager.loadAssets().catch((err) => {
      console.warn('[ColisGame] Failed to preload box assets:', err);
    });
    console.log('[ColisGame] Loading 3D supermarket shelf models...');
    await StoreEnvironment.loadAssets().catch((err) => {
      console.warn('[ColisGame] Failed to preload shelf assets:', err);
    });

    console.log('[ColisGame] Waiting for fonts to load...');
    if (document.fonts) {
      await document.fonts.ready;
    }

    console.log('[ColisGame] Connecting to server WebSocket...');
    this.network.connect('store-main', 'Сотрудник');

    this.lastTime = performance.now();
    requestAnimationFrame(this.gameLoop);
  }

  private setupInputs(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      this.keys[e.code] = true;

      // Debug: Smooth time-of-day transitions
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        this.atmosphere.transitionToTime(0.08);
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        this.atmosphere.transitionToTime(0.72);
      }

      // Space: Jump
      if (e.code === 'Space') {
        if (this.isGrounded) {
          this.verticalVelocity = 5.8;
          this.isGrounded = false;
        }
      } else if (e.code === 'KeyE') {
        // E: Take box into hands / drop on floor
        this.handleActionE();
      } else if (e.code === 'KeyR') {
        // R: Open box
        this.handleActionOpenBox();
      } else if (e.code === 'KeyF') {
        // F: Melee weapon attack / shove against monsters
        this.handleActionAttack();
      } else if (e.code === 'KeyU') {
        // U: Toggle Upgrades & Skills modal
        this.ui.toggleUpgradesModal();
      } else if (e.code === 'KeyG') {
        // G: Start charging throw
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
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return;

      if (e.button === 0) {
        // Left click: Place product onto shelf OR attack monster
        this.handleLeftClick();
      } else if (e.button === 2) {
        // Right click: Take product from shelf
        this.handleRightClick();
      }
    });

    window.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).tagName === 'CANVAS') {
        e.preventDefault();
      }
    });

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
      if (document.hidden) clearKeys();
    });

    const handleTabClose = () => {
      try {
        if (navigator.sendBeacon) navigator.sendBeacon('/api/tab-closed');
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
      onBuyTeamUpgrade: (upgradeId) => {
        this.network.sendBuyTeamUpgrade(upgradeId);
      },
      onBuyPersonalSkill: (skillId) => {
        this.network.sendBuyPersonalSkill(skillId);
      },
      onSkipPhase: () => {
        this.network.sendSkipPhase();
      },
    });
  }

  // ==========================================
  // BOX CONTROLS: E (PICKUP/DROP) & R (OPEN)
  // ==========================================
  private handleActionE(): void {
    if (this.localPlayerEntity?.isKnockedDown()) return;

    // If near breaker during blackout -> reserve E for breaker repair
    const isBlackout = this.currentEvent?.type === 'blackout';
    const distToBreaker = distanceXZ(this.localPlayerState.position, BREAKER_CONFIG.position);
    if (isBlackout && distToBreaker <= BREAKER_CONFIG.INTERACTION_RADIUS) {
      return;
    }

    // If already holding box -> gentle drop on floor
    if (this.localPlayerState.heldBoxId) {
      this.network.sendDropBox({ throwForce: 0 });
      return;
    }

    // If looking at a box nearby -> pick it up into hands!
    if (this.hoveredBox) {
      this.network.sendPickupBox(this.hoveredBox.boxId, this.localPlayerState.position);
    }
  }

  private handleActionOpenBox(): void {
    if (this.localPlayerEntity?.isKnockedDown()) return;

    // If holding a box in hands -> open held box!
    if (this.localPlayerState.heldBoxId) {
      const box = this.currentRoom?.boxes[this.localPlayerState.heldBoxId];
      if (box && !box.isOpen) {
        this.network.sendOpenBox(this.localPlayerState.heldBoxId, this.localPlayerState.position);
        this.boxManager.openBoxLocal(this.localPlayerState.heldBoxId);
      }
      return;
    }

    // If looking at a closed box on the floor -> open it!
    if (this.hoveredBox) {
      const box = this.currentRoom?.boxes[this.hoveredBox.boxId];
      if (box && !box.isOpen) {
        this.network.sendOpenBox(this.hoveredBox.boxId, this.localPlayerState.position);
        this.boxManager.openBoxLocal(this.hoveredBox.boxId);
      }
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
    if (elapsedSec < 0.15) {
      this.ui.setThrowCharge(0);
    } else {
      const ratio = THREE.MathUtils.clamp((elapsedSec - 0.15) / 1.0, 0, 1);
      this.ui.setThrowCharge(ratio);
    }
  }

  private finishThrowCharge(): void {
    if (!this.isChargingThrow) return;
    this.isChargingThrow = false;
    this.ui.setThrowCharge(null);

    if (!this.localPlayerState.heldBoxId) return;

    const elapsedSec = (performance.now() - this.throwChargeStartTime) / 1000;
    if (elapsedSec < 0.2) {
      // Gentle drop right in front
      this.network.sendDropBox({ throwForce: 0 });
      return;
    }

    // Ballistic throw with charge force
    const forceRatio = THREE.MathUtils.clamp((elapsedSec - 0.2) / 1.0, 0.15, 1.0);
    const rotY = this.localPlayerState.rotationY;
    const speed = 3.5 + forceRatio * 11.5;
    const vx = -Math.sin(rotY) * speed;
    const vz = -Math.cos(rotY) * speed;
    const vy = 1.6 + forceRatio * 3.6;

    this.network.sendDropBox({
      throwForce: forceRatio,
      throwVelocity: { x: vx, y: vy, z: vz },
    });
  }

  private handleLeftClick(): void {
    if (this.localPlayerEntity?.isKnockedDown()) return;

    // 1. If holding box and looking at shelf slot -> place product onto shelf
    if (this.localPlayerState.heldBoxId && this.hoveredSlot) {
      this.network.sendPlaceProduct(
        this.hoveredSlot.shelfId,
        this.hoveredSlot.slotIndex,
        this.localPlayerState.position
      );
      return;
    }

    // 2. If near night monster or carrying weapon -> attack!
    if (this.currentShift?.phase === 'NIGHT' || this.mySkills.includes('security_bat')) {
      this.handleActionAttack();
      return;
    }

    // 3. If clicking a closed box on the floor -> open it
    if (this.hoveredBox) {
      const box = this.currentRoom?.boxes[this.hoveredBox.boxId];
      if (box && !box.isOpen) {
        this.network.sendOpenBox(this.hoveredBox.boxId, this.localPlayerState.position);
        this.boxManager.openBoxLocal(this.hoveredBox.boxId);
      }
    }
  }

  private handleRightClick(): void {
    if (this.localPlayerEntity?.isKnockedDown()) return;

    // Take product from shelf back into held box
    if (this.localPlayerState.heldBoxId && this.hoveredSlot) {
      this.network.sendTakeProduct(
        this.hoveredSlot.shelfId,
        this.hoveredSlot.slotIndex,
        this.localPlayerState.position
      );
    }
  }

  private handleActionAttack(): void {
    if (this.localPlayerEntity?.isKnockedDown()) return;
    const rotY = this.localPlayerState.rotationY;
    const hitDirection = {
      x: -Math.sin(rotY),
      y: 0,
      z: -Math.cos(rotY),
    };
    this.network.sendPlayerAttack(hitDirection);
  }

  // ==========================================
  // ROOM INIT & MULTIPLAYER SYNC
  // ==========================================
  private handleRoomInit = (data: InitRoomPayload): void => {
    this.localPlayerId = data.yourPlayerId;
    this.currentRoom = data.room;

    // Sync Shelves
    this.environment.syncShelves(data.room.shelves);
    this.shelfManager.updateShelves(data.room.shelves);
    this.physics.registerShelves(data.room.shelves);

    // Sync Boxes
    this.boxManager.syncBoxes(data.room.boxes);

    // Sync Economy & Shifts
    this.ui.updateMoney(data.room.storeMoney);
    this.ui.updateRoomInfo(data.room.roomId, Object.keys(data.room.players).length);

    if (data.room.shift) {
      this.currentShift = data.room.shift;
      this.ui.updateShift(this.currentShift);
      this.updateAtmosphereShift(this.currentShift);

      if (this.currentShift.activeEvent) {
        this.currentEvent = this.currentShift.activeEvent;
        this.ui.updateEvent(this.currentEvent);
        if (this.currentEvent.type === 'blood_moon') {
          this.atmosphere.setBloodMoon(true);
        } else if (this.currentEvent.type === 'blackout') {
          this.atmosphere.setBlackout(true);
          this.flashlight.visible = true;
        }
      }
    }

    this.teamUnlocks = data.room.teamUnlocks || [];
    const localP = data.room.players[this.localPlayerId];
    if (localP) {
      this.mySkills = localP.personalSkills || [];
      this.ui.updatePersonalCash(localP.personalCash || 50);
    }
    this.ui.setUpgradesData(this.teamUnlocks, this.mySkills);

    // Spawn local & remote players
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

    // Sync Customers & Monsters
    this.customerManager.syncCustomers(data.room.customers);
    this.monsterManager.syncMonsters(data.room.monsters);
    if (data.room.cleanerBots) {
      this.cleanerBot.sync(Object.values(data.room.cleanerBots)[0]);
    }

    this.ui.showNotification({
      type: 'success',
      message: `Добро пожаловать в ${data.room.name}!`,
    });
  };

  private handleWorldTick = (tick: WorldTickPayload): void => {
    // 1. Players
    for (const [id, pData] of Object.entries(tick.players)) {
      if (id === this.localPlayerId) {
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

    // 2. Customers & Monsters & Cleaner
    this.customerManager.syncCustomers(tick.customers);
    this.monsterManager.syncMonsters(tick.monsters);
    if (tick.cleanerBots) {
      this.cleanerBot.sync(Object.values(tick.cleanerBots)[0]);
    } else {
      this.cleanerBot.sync(undefined);
    }

    // 3. Shift Countdown
    if (tick.shiftTimeRemaining !== undefined && this.currentShift) {
      this.currentShift.phaseTimeRemaining = tick.shiftTimeRemaining;
      this.ui.updateShift(this.currentShift);
    }

    // 4. Dynamic Event Sync
    if (tick.activeEvent) {
      this.currentEvent = tick.activeEvent;
      this.ui.updateEvent(tick.activeEvent);
      if (tick.activeEvent.type === 'blood_moon') {
        this.atmosphere.setBloodMoon(true);
      } else if (tick.activeEvent.type === 'blackout') {
        this.atmosphere.setBlackout(true);
        this.flashlight.visible = true;
      }
    } else if (this.currentEvent) {
      // Event concluded on server
      if (this.currentEvent.type === 'blood_moon') {
        this.atmosphere.setBloodMoon(false);
      } else if (this.currentEvent.type === 'blackout') {
        this.atmosphere.setBlackout(false);
        this.flashlight.visible = false;
      }
      this.currentEvent = null;
      this.ui.updateEvent(null);
      this.ui.updateBreakerUI(false, 0);
      if (this.isRepairingBreaker) {
        this.isRepairingBreaker = false;
        this.network.sendInteractBreaker(false);
      }
    }

    this.updateHeldBoxUI();
  };

  private handleShiftChanged = (shift: ShiftState): void => {
    this.currentShift = shift;
    this.ui.updateShift(shift);
    this.updateAtmosphereShift(shift);
    // Reset event atmosphere on phase shift
    this.atmosphere.setBloodMoon(false);
    this.atmosphere.setBlackout(false);
    this.flashlight.visible = false;
    this.currentEvent = null;
    this.ui.updateEvent(null);
    this.ui.updateBreakerUI(false, 0);
    if (this.isRepairingBreaker) {
      this.isRepairingBreaker = false;
      this.network.sendInteractBreaker(false);
    }
  };

  private updateAtmosphereShift(shift: ShiftState): void {
    if (shift.phase === 'DAY') {
      this.atmosphere.transitionToTime(0.22); // Morning/Day
    } else if (shift.phase === 'EVENING') {
      this.atmosphere.transitionToTime(0.55); // Sunset
    } else {
      this.atmosphere.transitionToTime(0.78); // Night
    }
  }

  private handleUpgradesChanged = (upgrades: UpgradesChangedPayload): void => {
    this.teamUnlocks = upgrades.teamUnlocks;
    this.mySkills = upgrades.playerSkills[this.localPlayerId] || [];
    const cash = upgrades.personalCash[this.localPlayerId] ?? 50;
    this.ui.updatePersonalCash(cash);
    this.ui.setUpgradesData(this.teamUnlocks, this.mySkills);
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

  // ==========================================
  // GAME LOOP
  // ==========================================
  private gameLoop = (): void => {
    requestAnimationFrame(this.gameLoop);

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.updatePlayerMovement(dt);
    this.updateThrowCharging();
    this.boxManager.update(dt);
    this.customerManager.update(dt);
    this.monsterManager.update(dt);
    this.cleanerBot.update(dt);
    this.updateRaycasting();
    this.updateInterpolations(dt);

    // Camera follow & Wall Occlusion Fading
    if (this.localPlayerEntity) {
      this.renderer.updateCamera(this.localPlayerEntity.group.position, dt);
      this.environment.updateWallOcclusion(this.renderer.camera.position, this.localPlayerEntity.group.position, dt);
    }

    // Update dynamic sky & ocean
    this.atmosphere.update(dt, this.renderer.camera.position, this.renderer.currentCameraTarget);

    // Breaker interaction & Blackout electrical logic
    const isBlackout = this.currentEvent?.type === 'blackout';
    const distToBreaker = distanceXZ(this.localPlayerState.position, BREAKER_CONFIG.position);
    const isNearBreaker = distToBreaker <= BREAKER_CONFIG.INTERACTION_RADIUS;
    const breakerProgress = this.currentEvent?.progress ?? 0;

    if (isBlackout && isNearBreaker) {
      this.ui.updateBreakerUI(true, breakerProgress);
      const wantsRepair = !!this.keys['KeyE'] && !this.localPlayerEntity?.isKnockedDown();
      if (wantsRepair !== this.isRepairingBreaker) {
        this.isRepairingBreaker = wantsRepair;
        this.network.sendInteractBreaker(wantsRepair);
      }
    } else {
      this.ui.updateBreakerUI(false, 0);
      if (this.isRepairingBreaker) {
        this.isRepairingBreaker = false;
        this.network.sendInteractBreaker(false);
      }
    }

    this.environment.updateBreaker(isBlackout, breakerProgress, dt);

    // Player Flashlight during Blackout
    if (this.flashlight.visible && this.localPlayerEntity) {
      const p = this.localPlayerState.position;
      this.flashlight.position.set(p.x, p.y + 1.2, p.z);
      const rotY = this.localPlayerState.rotationY;
      this.flashlightTarget.position.set(
        p.x - Math.sin(rotY) * 6,
        p.y + 0.6,
        p.z - Math.cos(rotY) * 6
      );
    }

    // Render Scene
    this.renderer.render();
  };

  private updatePlayerMovement(dt: number): void {
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
    const worldDir = cameraToWorldInput(inputX, inputZ);
    const isMoving = Math.hypot(worldDir.x, worldDir.z) > 0.05;

    // Stamina calculation (10s if marathoner, 5s default)
    const hasMarathoner = this.mySkills.includes('marathoner');
    const maxStamina = hasMarathoner ? 10.0 : 5.0;
    const recoveryMultiplier = hasMarathoner ? 2.0 : 1.0;

    let isSprinting = false;
    if (shiftPressed && isMoving && this.currentStamina > 0.05) {
      isSprinting = true;
      this.currentStamina = Math.max(0, this.currentStamina - dt);
      this.timeSinceSprint = 0;
    } else {
      isSprinting = false;
      this.timeSinceSprint += dt;
      if (this.timeSinceSprint >= (hasMarathoner ? 1.0 : 2.0)) {
        this.currentStamina = Math.min(maxStamina, this.currentStamina + dt * (maxStamina / 3.0) * recoveryMultiplier);
      }
    }

    this.ui.setStamina(this.currentStamina / maxStamina);

    // Speed calculation (heavy lifter allows sprinting with box without penalty)
    const speed = isSprinting ? 7.2 : 4.5;

    // Gravity & grounding
    const wasGrounded = this.physics.isGrounded();
    if (wasGrounded && this.verticalVelocity <= 0) {
      this.isGrounded = true;
      this.verticalVelocity = -0.5;
    } else {
      this.isGrounded = false;
      this.verticalVelocity -= 18.0 * dt;
    }

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

    // Rotation towards mouse aim or movement
    const mouseFloor = this.renderer.getGroundIntersection(0.8);
    let targetRotationY = this.localPlayerState.rotationY;
    if (mouseFloor) {
      const dx = mouseFloor.x - newPos.x;
      const dz = mouseFloor.z - newPos.z;
      targetRotationY = Math.atan2(dx, dz) + Math.PI;
    } else if (isMoving) {
      targetRotationY = Math.atan2(worldDir.x, worldDir.z) + Math.PI;
    }

    let rotDiff = targetRotationY - this.localPlayerState.rotationY;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;

    if (isMoving) {
      this.localPlayerState.rotationY += rotDiff * Math.min(1.0, 22.0 * dt);
    } else {
      this.localPlayerState.rotationY += rotDiff * Math.min(1.0, 14.0 * dt);
    }

    const isAirborne = !this.isGrounded && newPos.y > 0.15;

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
        worldDir.z,
        targetRotationY
      );
    }

    // Sprint Tackle
    const nowSec = performance.now() / 1000;
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
          break;
        }
      }
    }

    // Network Sync
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

  // ==========================================
  // RAYCASTING & INTERACTION PROMPTS
  // ==========================================
  private updateRaycasting(): void {
    // 0. Breaker interaction prompt during blackout
    const isBlackout = this.currentEvent?.type === 'blackout';
    const distToBreaker = distanceXZ(this.localPlayerState.position, BREAKER_CONFIG.position);
    if (isBlackout && distToBreaker <= BREAKER_CONFIG.INTERACTION_RADIUS) {
      this.ui.setInteractionPrompt('Удерживайте [E] для починки электрощитка', 'E');
      return;
    }

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

            // Formulate prompt based on held box
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
        if (distToBox <= 3.8) {
          this.hoveredBox = {
            boxId,
            mesh: hit.object as THREE.Mesh,
          };

          const prod = PRODUCTS[box.productId];
          const prodName = prod?.name || box.productId;

          if (!this.localPlayerState.heldBoxId) {
            if (!box.isOpen) {
              this.ui.setInteractionPrompt(
                `[E] Взять | [R] Открыть: "${prodName}" (${box.remainingItems}/${box.maxItems})`,
                'E'
              );
            } else {
              this.ui.setInteractionPrompt(
                `[E] Взять открытую коробку: "${prodName}" (${box.remainingItems}/${box.maxItems})`,
                'E'
              );
            }
            return;
          }
        }
      }
    }

    // Prompt if holding a box in hands
    if (this.localPlayerState.heldBoxId && this.currentRoom) {
      const heldBox = this.currentRoom.boxes[this.localPlayerState.heldBoxId];
      if (heldBox && !heldBox.isOpen) {
        this.ui.setInteractionPrompt('[R] Открыть коробку | [E] Положить | [G] Бросить', 'R');
      } else {
        this.ui.setInteractionPrompt('[E] Положить коробку | [G] Бросить (зажать)', 'E');
      }
      return;
    }

    this.ui.setInteractionPrompt(null);
  }

  private updateInterpolations(dt: number): void {
    for (const remote of this.remotePlayers.values()) {
      remote.tickInterpolation(dt, false);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new ColisGame();
  game.start().catch((err) => {
    console.error('[ColisGame] Fatal init error:', err);
  });
});
