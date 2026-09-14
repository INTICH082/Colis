import {
  BoxState,
  BREAKER_CONFIG,
  BuyPersonalSkillPayload,
  BuyTeamUpgradePayload,
  CleanerBotState,
  ClientMessage,
  ClientOpCode,
  CustomerState,
  EVENT_CONFIG,
  GameEventEndedPayload,
  GameEventState,
  GameEventTriggeredPayload,
  GameEventType,
  InteractBoxDropPayload,
  InteractBoxPickupPayload,
  InteractBreakerPayload,
  InteractPlaceProductPayload,
  InteractTakeProductPayload,
  MONSTER_CONFIG,
  MonsterState,
  MonsterType,
  NETWORK_CONFIG,
  OrderDeliveryPayload,
  PERSONAL_SKILLS,
  PlayerAttackPayload,
  PlayerInputPayload,
  PlayerState,
  PlayerTacklePayload,
  PRODUCTS,
  RoomState,
  ServerMessage,
  ServerOpCode,
  SHELF_CONFIG,
  ShelfSlotState,
  ShelfState,
  SHIFT_CONFIG,
  ShiftPhase,
  ShiftState,
  STORE_LAYOUT,
  TEAM_UPGRADES,
  Vector3D,
  distance,
  distanceXZ,
} from '@colis/shared';
import { WebSocket } from 'ws';

export class StoreRoom {
  public readonly id: string;
  public name: string;
  public createdAt: number;
  public hostId: string;

  private players: Map<string, { state: PlayerState; ws: WebSocket }> = new Map();
  private shelves: Map<string, ShelfState> = new Map();
  private boxes: Map<string, BoxState> = new Map();
  private flyingBoxes: Map<string, { vx: number; vy: number; vz: number; throwerId?: string; flightTime?: number }> = new Map();
  private storeMoney: number = 1500;
  private storeLevel: number = 1;

  // Infinite Shift System
  private shiftNumber: number = 1;
  private shiftPhase: ShiftPhase = 'DAY';
  private shiftTimer: number = SHIFT_CONFIG.DAY_DURATION;
  private dailyRevenue: number = 0;
  private customersServedToday: number = 0;
  private monstersRepelledTonight: number = 0;

  // Upgrades & Skills
  private teamUnlocks: Set<string> = new Set();

  // Dynamic Events System
  private activeEvent: GameEventState | null = null;
  private eventCooldown: number = 10;
  private breakerRepairProgress: number = 0;
  private breakerRepairingPlayers: Set<string> = new Set();
  private shoplifterCustomer: CustomerState | null = null;

  // AI Entities
  private customers: Map<string, CustomerState> = new Map();
  private monsters: Map<string, MonsterState> = new Map();
  private cleanerBot: CleanerBotState | null = null;
  private customerSpawnTimer: number = 0;
  private customerIdCounter: number = 1;
  private monsterIdCounter: number = 1;

  private tickTimer: NodeJS.Timeout | null = null;
  private tickCount: number = 0;
  private boxIdCounter: number = 1;

  constructor(id: string, name: string, hostId: string) {
    this.id = id;
    this.name = name;
    this.createdAt = Date.now();
    this.hostId = hostId;

    this.initializeStore();
    this.startLoop();
  }

  private initializeStore(): void {
    // Generate supermarket aisles of shelves
    // We create 4 standard double-sided shelf units
    const shelfLayouts: Array<{ id: string; pos: Vector3D; rotY: number }> = [
      // Aisle 1 (Left row)
      { id: 'shelf_aisle1_a', pos: { x: -3.5, y: 0, z: -2 }, rotY: 0 },
      { id: 'shelf_aisle1_b', pos: { x: -3.5, y: 0, z: 2.5 }, rotY: 0 },
      // Aisle 2 (Right row)
      { id: 'shelf_aisle2_a', pos: { x: 3.5, y: 0, z: -2 }, rotY: 0 },
      { id: 'shelf_aisle2_b', pos: { x: 3.5, y: 0, z: 2.5 }, rotY: 0 },
      // Back wall storage/display shelves
      { id: 'shelf_back_1', pos: { x: -4, y: 0, z: -8 }, rotY: Math.PI / 2 },
      { id: 'shelf_back_2', pos: { x: 0, y: 0, z: -8 }, rotY: Math.PI / 2 },
      { id: 'shelf_back_3', pos: { x: 4, y: 0, z: -8 }, rotY: Math.PI / 2 },
    ];

    for (const layout of shelfLayouts) {
      const slots: ShelfSlotState[] = [];
      const totalSlots = SHELF_CONFIG.TIERS * SHELF_CONFIG.SLOTS_PER_TIER;

      for (let i = 0; i < totalSlots; i++) {
        const tier = Math.floor(i / SHELF_CONFIG.SLOTS_PER_TIER);
        const col = i % SHELF_CONFIG.SLOTS_PER_TIER;
        const slotWidth = SHELF_CONFIG.WIDTH / SHELF_CONFIG.SLOTS_PER_TIER;
        const x = -SHELF_CONFIG.WIDTH / 2 + slotWidth / 2 + col * slotWidth;
        const y = SHELF_CONFIG.TIER_Y_OFFSETS[tier];

        slots.push({
          index: i,
          tier,
          productId: null,
          count: 0,
          maxCount: SHELF_CONFIG.MAX_ITEMS_PER_SLOT,
          localOffset: { x, y, z: 0 },
        });
      }

      this.shelves.set(layout.id, {
        id: layout.id,
        type: 'standard_shelf',
        position: layout.pos,
        rotationY: layout.rotY,
        slots,
      });
    }

    // Spawn starter delivery boxes with new 3D models (cola_can, chipsi, egg_tray)
    this.spawnBox('cola_can', { x: -1.5, y: 0.2, z: 4.5 });
    this.spawnBox('chipsi', { x: 0, y: 0.2, z: 4.5 });
    this.spawnBox('egg_tray', { x: 1.5, y: 0.2, z: 4.5 });

    this.spawnBox('cola_can', { x: -7.5, y: 0.2, z: 6.5 });
    this.spawnBox('chipsi', { x: -8.5, y: 0.2, z: 6.5 });
    this.spawnBox('egg_tray', { x: -7.5, y: 0.2, z: 7.8 });
  }

  public spawnBox(productId: string, pos: Vector3D): BoxState {
    const product = PRODUCTS[productId] ?? PRODUCTS['cola_can'];
    const id = `box_${this.boxIdCounter++}_${Date.now().toString(36)}`;
    const box: BoxState = {
      id,
      productId,
      remainingItems: product.boxCapacity,
      maxItems: product.boxCapacity,
      isOpen: false,
      isHeld: false,
      heldByPlayerId: null,
      position: pos,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    this.boxes.set(id, box);
    this.broadcast({
      op: ServerOpCode.BOX_STATE_CHANGED,
      data: box,
    });
    return box;
  }

  private startLoop(): void {
    this.tickTimer = setInterval(() => {
      this.tick();
    }, NETWORK_CONFIG.TICK_INTERVAL_MS);
  }

  public destroy(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.players.clear();
    this.flyingBoxes.clear();
    this.customers.clear();
    this.monsters.clear();
  }

  private tick(): void {
    this.tickCount++;
    const dt = NETWORK_CONFIG.TICK_INTERVAL_MS / 1000;

    // 1. Advance Shift Cycle & Timers
    this.updateShiftCycle(dt);

    // 2. Update AI Entities (Customers, Monsters, Cleaner Bot)
    this.updateCustomers(dt);
    this.updateMonsters(dt);
    this.updateCleanerBot(dt);

    // 3. Synchronize player positions & held boxes
    const playersPayload: Record<string, {
      position: Vector3D;
      rotationY: number;
      isMoving: boolean;
      heldBoxId: string | null;
    }> = {};

    for (const [id, p] of this.players) {
      playersPayload[id] = {
        position: p.state.position,
        rotationY: p.state.rotationY,
        isMoving: p.state.isMoving,
        heldBoxId: p.state.heldBoxId,
      };

      if (p.state.heldBoxId) {
        const box = this.boxes.get(p.state.heldBoxId);
        if (box) {
          const carryDistance = 0.65;
          const carryHeight = 0.95;
          box.position = {
            x: p.state.position.x - Math.sin(p.state.rotationY) * carryDistance,
            y: p.state.position.y + carryHeight,
            z: p.state.position.z - Math.cos(p.state.rotationY) * carryDistance,
          };
        }
      }
    }

    // 4. Update Ballistic Physics for Thrown Boxes
    this.updateFlyingBoxes(dt);

    // 5. Construct lightweight payloads for customers, monsters, cleaner
    const customersPayload: Record<string, {
      position: Vector3D;
      rotationY: number;
      state: string;
      heldProductId: string | null;
      isShoplifter?: boolean;
      isKnockedOut?: boolean;
      stolenItemName?: string;
    }> = {};
    for (const [cId, c] of this.customers) {
      customersPayload[cId] = {
        position: c.position,
        rotationY: c.rotationY,
        state: c.state,
        heldProductId: c.heldProductId,
        isShoplifter: c.isShoplifter,
        isKnockedOut: c.state === 'KNOCKED_OUT',
        stolenItemName: c.stolenItemName,
      };
    }

    const monstersPayload: Record<string, {
      position: Vector3D;
      rotationY: number;
      state: string;
      health: number;
      maxHealth: number;
      type: string;
      isEnraged?: boolean;
    }> = {};
    for (const [mId, m] of this.monsters) {
      monstersPayload[mId] = {
        position: m.position,
        rotationY: m.rotationY,
        state: m.state,
        health: m.health,
        maxHealth: m.maxHealth,
        type: m.type,
        isEnraged: m.isEnraged,
      };
    }

    const cleanerBotsPayload: Record<string, { position: Vector3D; rotationY: number; state: string }> = {};
    if (this.cleanerBot) {
      cleanerBotsPayload[this.cleanerBot.id] = {
        position: this.cleanerBot.position,
        rotationY: this.cleanerBot.rotationY,
        state: this.cleanerBot.state,
      };
    }

    const tickMessage: ServerMessage = {
      op: ServerOpCode.WORLD_TICK,
      data: {
        tick: this.tickCount,
        timestamp: Date.now(),
        players: playersPayload,
        customers: customersPayload,
        monsters: monstersPayload,
        cleanerBots: cleanerBotsPayload,
        shiftTimeRemaining: Math.max(0, Math.ceil(this.shiftTimer)),
        activeEvent: this.activeEvent,
      },
    };

    this.broadcast(tickMessage);
  }

  // ==========================================
  // SHIFT CYCLE SYSTEM (INFINITE)
  // ==========================================
  private updateShiftCycle(dt: number): void {
    this.shiftTimer -= dt;
    this.updateDynamicEvents(dt);

    if (this.shiftTimer <= 0) {
      if (this.shiftPhase === 'DAY') {
        // Transition: DAY -> EVENING
        this.endCurrentEvent(false);
        this.shiftPhase = 'EVENING';
        this.shiftTimer = SHIFT_CONFIG.EVENING_DURATION;
        this.eventCooldown = 10;

        // Dismiss remaining customers
        for (const c of this.customers.values()) {
          c.state = 'LEAVING';
          c.targetPos = { x: 0, y: 0, z: 14 };
        }

        this.broadcastShiftState();
        this.broadcast({
          op: ServerOpCode.NOTIFICATION,
          data: {
            type: 'info',
            message: '🌆 Магазин закрыт на вечер! Расставьте товары по полкам перед наступлением ночи!',
          },
        });
      } else if (this.shiftPhase === 'EVENING') {
        // Transition: EVENING -> NIGHT
        this.endCurrentEvent(false);
        this.shiftPhase = 'NIGHT';
        this.shiftTimer = SHIFT_CONFIG.NIGHT_DURATION;
        this.monstersRepelledTonight = 0;
        this.eventCooldown = 8;

        // Spawn night monsters outside entrance
        this.spawnNightMonsters();

        this.broadcastShiftState();
        this.broadcast({
          op: ServerOpCode.NOTIFICATION,
          data: {
            type: 'warning',
            message: '⚠️ НАСТУПИЛА НОЧЬ! Монстры приближаются к магазину! Защищайте стеллажи и товары!',
          },
        });
      } else if (this.shiftPhase === 'NIGHT') {
        // Transition: NIGHT -> DAY (New Shift!)
        this.endCurrentEvent(false);
        this.monsters.clear();

        // Calculate Shift Salary & Rewards
        const baseSalary = SHIFT_CONFIG.BASE_SALARY;
        const customerBonus = this.customersServedToday * 3;
        const monsterBonus = this.monstersRepelledTonight * 10;
        const totalBonus = baseSalary + customerBonus + monsterBonus;

        for (const p of this.players.values()) {
          p.state.personalCash = (p.state.personalCash || 0) + totalBonus;
        }

        this.broadcast({
          op: ServerOpCode.SHIFT_SUMMARY,
          data: {
            shiftNumber: this.shiftNumber,
            revenue: this.dailyRevenue,
            customersServed: this.customersServedToday,
            monstersRepelled: this.monstersRepelledTonight,
            salaryBonus: totalBonus,
          },
        });

        this.broadcastUpgrades();

        this.broadcast({
          op: ServerOpCode.NOTIFICATION,
          data: {
            type: 'success',
            message: `☀️ Рассвет! Смена ${this.shiftNumber} окончена. Премия каждому сотруднику: +$${totalBonus}!`,
          },
        });

        // Increment shift counter infinitely
        this.shiftNumber++;
        this.shiftPhase = 'DAY';
        this.shiftTimer = SHIFT_CONFIG.DAY_DURATION;
        this.dailyRevenue = 0;
        this.customersServedToday = 0;
        this.monstersRepelledTonight = 0;
        this.eventCooldown = 12;

        this.broadcastShiftState();
      }
    }
  }

  // ==========================================
  // DYNAMIC EVENTS SYSTEM (5 SELECTED EVENTS)
  // ==========================================
  private updateDynamicEvents(dt: number): void {
    if (this.activeEvent) {
      this.activeEvent.durationRemaining -= dt;

      // 1. Special ticking for Sanitary Inspection: count empty boxes in hall
      if (this.activeEvent.type === 'sanitary_inspection') {
        let emptyBoxes = 0;
        for (const b of this.boxes.values()) {
          if (b.remainingItems === 0 && !b.isHeld && b.position.z >= -9.5 && b.position.z <= 9.5) {
            emptyBoxes++;
          }
        }
        this.activeEvent.currentCount = emptyBoxes;
      }

      // 2. Special ticking for Blackout: electrical panel repair
      if (this.activeEvent.type === 'blackout') {
        let repairingCount = 0;
        for (const pId of this.breakerRepairingPlayers) {
          const p = this.players.get(pId);
          if (p && distanceXZ(p.state.position, BREAKER_CONFIG.position) <= BREAKER_CONFIG.INTERACTION_RADIUS) {
            repairingCount++;
          }
        }

        if (repairingCount > 0) {
          this.breakerRepairProgress += (100 / BREAKER_CONFIG.REPAIR_TIME_SECONDS) * dt * repairingCount;
          this.activeEvent.progress = Math.min(100, Math.round(this.breakerRepairProgress));
          if (this.breakerRepairProgress >= 100) {
            this.storeMoney += EVENT_CONFIG.BLACKOUT_REPAIR_REWARD;
            this.broadcast({
              op: ServerOpCode.STORE_ECONOMY_CHANGED,
              data: { storeMoney: this.storeMoney, storeLevel: this.storeLevel },
            });
            this.endCurrentEvent(true, '⚡ Рубильник успешно починен! Электричество восстановлено (+50$ в казну)!');
            return;
          }
        }
      }

      // Check if event time expired
      if (this.activeEvent && this.activeEvent.durationRemaining <= 0) {
        if (this.activeEvent.type === 'sanitary_inspection') {
          const emptyBoxes = this.activeEvent.currentCount || 0;
          if (emptyBoxes === 0) {
            this.storeMoney += EVENT_CONFIG.SAN_INSPECTION_BONUS;
            this.broadcast({
              op: ServerOpCode.STORE_ECONOMY_CHANGED,
              data: { storeMoney: this.storeMoney, storeLevel: this.storeLevel },
            });
            this.endCurrentEvent(true, '🏆 Проверка СЭС пройдена! В зале идеальная чистота (+200$ в казну)!');
          } else {
            this.storeMoney = Math.max(0, this.storeMoney - EVENT_CONFIG.SAN_INSPECTION_FINE);
            this.broadcast({
              op: ServerOpCode.STORE_ECONOMY_CHANGED,
              data: { storeMoney: this.storeMoney, storeLevel: this.storeLevel },
            });
            this.endCurrentEvent(false, `❌ Инспектор СЭС оштрафовал магазин на 150$ за мусор в зале (${emptyBoxes} шт.)!`);
          }
        } else if (this.activeEvent.type === 'rush_hour') {
          this.endCurrentEvent(true, '🛒 Час пик завершен! Покупатели скупили товары по отличной цене!');
        } else if (this.activeEvent.type === 'blood_moon') {
          this.endCurrentEvent(true, '🌅 Кровавая луна рассеялась! Магазин выстоял против орды!');
        } else if (this.activeEvent.type === 'blackout') {
          this.endCurrentEvent(false, '⚠️ Аварийный режим завершен.');
        } else if (this.activeEvent.type === 'shoplifter') {
          this.endCurrentEvent(false, '❌ Вор скрылся с украденным товаром!');
        } else {
          this.endCurrentEvent(false);
        }
      }
    } else {
      // Cooldown timer before triggering a dynamic event in current phase
      this.eventCooldown -= dt;
      if (this.eventCooldown <= 0) {
        if (this.shiftPhase === 'DAY' && this.shiftTimer > 25) {
          if (Math.random() < EVENT_CONFIG.EVENT_CHANCE_DAY) {
            const dayEvents: GameEventType[] = ['rush_hour', 'sanitary_inspection', 'shoplifter'];
            const chosen = dayEvents[Math.floor(Math.random() * dayEvents.length)];
            if (chosen === 'rush_hour') this.triggerRushHour();
            else if (chosen === 'sanitary_inspection') this.triggerSanitaryInspection();
            else if (chosen === 'shoplifter') this.triggerShoplifter();
          }
          this.eventCooldown = 999;
        } else if (this.shiftPhase === 'NIGHT' && this.shiftTimer > 20) {
          if (Math.random() < EVENT_CONFIG.EVENT_CHANCE_NIGHT) {
            const nightEvents: GameEventType[] = ['blood_moon', 'blackout'];
            const chosen = nightEvents[Math.floor(Math.random() * nightEvents.length)];
            if (chosen === 'blood_moon') this.triggerBloodMoon();
            else if (chosen === 'blackout') this.triggerBlackout();
          }
          this.eventCooldown = 999;
        }
      }
    }
  }

  public triggerRushHour(): void {
    this.activeEvent = {
      type: 'rush_hour',
      title: '🔥 ЧАС ПИК',
      description: 'Покупатели сметают товары (+50% к выручке)!',
      icon: '🔥',
      durationRemaining: EVENT_CONFIG.RUSH_HOUR_DURATION,
      totalDuration: EVENT_CONFIG.RUSH_HOUR_DURATION,
    };
    this.broadcastEventTriggered();
    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'warning',
        message: '🔥 ВНИМАНИЕ: Начался Час Пик! Цены повышены на 50%, наплыв покупателей!',
      },
    });
  }

  public triggerSanitaryInspection(): void {
    let emptyBoxes = 0;
    for (const b of this.boxes.values()) {
      if (b.remainingItems === 0 && !b.isHeld && b.position.z >= -9.5 && b.position.z <= 9.5) {
        emptyBoxes++;
      }
    }
    this.activeEvent = {
      type: 'sanitary_inspection',
      title: '📋 ПРОВЕРКА СЭС',
      description: 'Уберите весь мусор и пустые коробки с пола зала до приезда инспектора!',
      icon: '📋',
      durationRemaining: EVENT_CONFIG.SAN_INSPECTION_DURATION,
      totalDuration: EVENT_CONFIG.SAN_INSPECTION_DURATION,
      targetCount: 0,
      currentCount: emptyBoxes,
    };
    this.broadcastEventTriggered();
    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'warning',
        message: '📋 ВНИМАНИЕ: Внезапная проверка СЭС через 45 сек! Очистите пол от пустых коробок!',
      },
    });
  }

  public triggerShoplifter(): void {
    const id = `cust_shoplifter_${Date.now()}`;
    const shoplifter: CustomerState = {
      id,
      name: 'Вор в капюшоне',
      position: { x: 0, y: 0, z: 13.5 },
      rotationY: Math.PI,
      state: 'ENTERING',
      targetPos: { x: 0, y: 0, z: 6.5 },
      heldProductId: null,
      isShoplifter: true,
    };
    this.customers.set(id, shoplifter);
    this.shoplifterCustomer = shoplifter;

    this.activeEvent = {
      type: 'shoplifter',
      title: '🚨 ШОПЛИФТЕР В ЗАЛЕ',
      description: 'Вор пытается украсть товар! Сбейте его броском коробки [G] или ударом [F]!',
      icon: '🚨',
      durationRemaining: 40,
      totalDuration: 40,
    };
    this.broadcastEventTriggered();
    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'error',
        message: '🚨 ВОР В МАГАЗИНЕ! Подозрительный тип проник в зал и ищет, что украсть!',
      },
    });
  }

  public triggerBloodMoon(): void {
    this.activeEvent = {
      type: 'blood_moon',
      title: '🩸 КРОВАВАЯ ЛУНА',
      description: 'Орда разъяренных монстров атакует! (+25% скорости, удвоенная награда)',
      icon: '🩸',
      durationRemaining: EVENT_CONFIG.BLOOD_MOON_DURATION,
      totalDuration: EVENT_CONFIG.BLOOD_MOON_DURATION,
    };

    // Extra enraged monster wave
    const extraCount = 4 + Math.min(this.shiftNumber, 4);
    for (let i = 0; i < extraCount; i++) {
      const type: MonsterType = i % 2 === 0 ? 'STALKER' : 'BRUTE';
      const config = MONSTER_CONFIG[type];
      const id = `mon_blood_${this.monsterIdCounter++}`;
      const spawnX = (Math.random() - 0.5) * 16.0;
      this.monsters.set(id, {
        id,
        type,
        position: { x: spawnX, y: 0, z: 13.5 },
        rotationY: Math.PI,
        health: config.health * 1.25,
        maxHealth: config.health * 1.25,
        state: 'CHASING_PLAYER',
        isEnraged: true,
      });
    }

    for (const m of this.monsters.values()) {
      m.isEnraged = true;
    }

    this.broadcastEventTriggered();
    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'error',
        message: '🩸 ВЗОШЛА КРОВАВАЯ ЛУНА! Натиск орды усилился! Отражайте нападение (двойная премия)!',
      },
    });
  }

  public triggerBlackout(): void {
    this.breakerRepairProgress = 0;
    this.breakerRepairingPlayers.clear();
    this.activeEvent = {
      type: 'blackout',
      title: '⚡ БЛЭКАУТ / АВАРИЯ',
      description: 'Свет погас! Удерживайте [E] у электрощитка на складе, чтобы починить питание!',
      icon: '⚡',
      durationRemaining: EVENT_CONFIG.BLACKOUT_DURATION,
      totalDuration: EVENT_CONFIG.BLACKOUT_DURATION,
      progress: 0,
    };
    this.broadcastEventTriggered();
    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'warning',
        message: '⚡ АВАРИЯ НА ПОДСТАНЦИИ! Свет отключен! Почините рубильник на складе [E]!',
      },
    });
  }

  public endCurrentEvent(success: boolean, summary?: string): void {
    if (!this.activeEvent) return;
    const type = this.activeEvent.type;
    this.activeEvent = null;
    this.breakerRepairingPlayers.clear();
    this.breakerRepairProgress = 0;
    this.shoplifterCustomer = null;

    const summaryText = summary || (success ? 'Событие успешно завершено!' : 'Событие завершено.');
    this.broadcast({
      op: ServerOpCode.GAME_EVENT_ENDED,
      data: {
        eventType: type,
        success,
        rewardSummary: summaryText,
      },
    });

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: success ? 'success' : 'info',
        message: summaryText,
      },
    });
  }

  private broadcastEventTriggered(): void {
    if (!this.activeEvent) return;
    this.broadcast({
      op: ServerOpCode.GAME_EVENT_TRIGGERED,
      data: { event: this.activeEvent },
    });
  }

  private handleInteractBreaker(playerId: string, data: InteractBreakerPayload): void {
    if (data.isRepairing) {
      this.breakerRepairingPlayers.add(playerId);
    } else {
      this.breakerRepairingPlayers.delete(playerId);
    }
  }

  private broadcastShiftState(): void {
    this.broadcast({
      op: ServerOpCode.SHIFT_STATE_CHANGED,
      data: this.getShiftState(),
    });
  }

  private getShiftState(): ShiftState {
    const totalDuration = this.shiftPhase === 'DAY'
      ? SHIFT_CONFIG.DAY_DURATION
      : this.shiftPhase === 'EVENING'
        ? SHIFT_CONFIG.EVENING_DURATION
        : SHIFT_CONFIG.NIGHT_DURATION;

    return {
      shiftNumber: this.shiftNumber,
      phase: this.shiftPhase,
      phaseTimeRemaining: Math.max(0, Math.ceil(this.shiftTimer)),
      totalPhaseDuration: totalDuration,
      customersServedToday: this.customersServedToday,
      dailyRevenue: this.dailyRevenue,
      monstersRepelledTonight: this.monstersRepelledTonight,
      activeEvent: this.activeEvent,
    };
  }

  // ==========================================
  // CUSTOMER AI SIMULATION
  // ==========================================
  private updateCustomers(dt: number): void {
    if (this.shiftPhase === 'DAY') {
      let spawnInterval: number = this.teamUnlocks.has('bakery_dept')
        ? SHIFT_CONFIG.CUSTOMER_SPAWN_INTERVAL_BAKERY
        : SHIFT_CONFIG.CUSTOMER_SPAWN_INTERVAL_BASE;
      let maxCust: number = SHIFT_CONFIG.MAX_CUSTOMERS;
      if (this.activeEvent?.type === 'rush_hour') {
        spawnInterval = 1.2;
        maxCust = 14;
      }

      this.customerSpawnTimer += dt;
      if (this.customerSpawnTimer >= spawnInterval && this.customers.size < maxCust) {
        this.customerSpawnTimer = 0;
        this.spawnCustomer();
      }
    }

    const baseSpeed = 2.4;
    const toRemove: string[] = [];

    for (const [cId, c] of this.customers) {
      // --- SHOPLIFTER AI ---
      if (c.isShoplifter) {
        const thiefSpeed = 3.3;
        if (c.state === 'ENTERING') {
          const arrived = this.stepTowards(c, c.targetPos, thiefSpeed, dt);
          if (arrived) {
            const target = this.findStockedShelfSlot();
            if (target) {
              c.targetShelfId = target.shelfId;
              c.targetSlotIndex = target.slotIndex;
              c.targetPos = target.pos;
              c.state = 'BROWSING';
            } else {
              c.state = 'FLEEING';
              c.targetPos = { x: 0, y: 0, z: 14 };
            }
          }
        } else if (c.state === 'BROWSING') {
          const arrived = this.stepTowards(c, c.targetPos, thiefSpeed, dt);
          if (arrived) {
            if (c.targetShelfId && c.targetSlotIndex !== undefined) {
              const shelf = this.shelves.get(c.targetShelfId);
              const slot = shelf?.slots[c.targetSlotIndex];
              if (slot && slot.count > 0 && slot.productId) {
                c.heldProductId = slot.productId;
                slot.count -= 1;
                c.stolenItemName = PRODUCTS[slot.productId]?.name || 'товар';
                if (slot.count === 0) slot.productId = null;
                this.broadcast({
                  op: ServerOpCode.SHELF_STATE_CHANGED,
                  data: shelf!,
                });
                c.state = 'FLEEING';
                c.targetPos = { x: 0, y: 0, z: 14 };
                this.broadcast({
                  op: ServerOpCode.NOTIFICATION,
                  data: {
                    type: 'error',
                    message: `🚨 ВОР СХВАТИЛ "${c.stolenItemName}" И БЕЖИТ К ВЫХОДУ! Перехватите его [G] или [F]!`,
                  },
                });
              } else {
                c.state = 'FLEEING';
                c.targetPos = { x: 0, y: 0, z: 14 };
              }
            }
          }
        } else if (c.state === 'FLEEING') {
          const arrived = this.stepTowards(c, c.targetPos, thiefSpeed, dt);
          if (arrived || c.position.z >= 13.5) {
            toRemove.push(cId);
            this.endCurrentEvent(false, '❌ Вор успешно скрылся с украденным товаром!');
          }
        } else if (c.state === 'KNOCKED_OUT') {
          c.waitTimer = (c.waitTimer || 3.0) - dt;
          if (c.waitTimer <= 0) {
            toRemove.push(cId);
          }
        }
        continue;
      }

      // --- REGULAR CUSTOMER AI ---
      const speed = baseSpeed;
      if (c.state === 'ENTERING') {
        const arrived = this.stepTowards(c, c.targetPos, speed, dt);
        if (arrived) {
          const target = this.findStockedShelfSlot();
          if (target) {
            c.targetShelfId = target.shelfId;
            c.targetSlotIndex = target.slotIndex;
            c.targetPos = target.pos;
            c.state = 'BROWSING';
          } else {
            c.state = 'SAD_LEAVING';
            c.targetPos = { x: 0, y: 0, z: 14 };
          }
        }
      } else if (c.state === 'BROWSING') {
        const arrived = this.stepTowards(c, c.targetPos, speed, dt);
        if (arrived) {
          if (c.targetShelfId && c.targetSlotIndex !== undefined) {
            const shelf = this.shelves.get(c.targetShelfId);
            const slot = shelf?.slots[c.targetSlotIndex];
            if (slot && slot.count > 0 && slot.productId) {
              c.heldProductId = slot.productId;
              slot.count -= 1;
              if (slot.count === 0) slot.productId = null;
              this.broadcast({
                op: ServerOpCode.SHELF_STATE_CHANGED,
                data: shelf!,
              });
              c.state = 'HEADING_TO_CHECKOUT';
              c.targetPos = { x: STORE_LAYOUT.CHECKOUT_ZONE.center.x, y: 0, z: STORE_LAYOUT.CHECKOUT_ZONE.center.z };
            } else {
              const another = this.findStockedShelfSlot();
              if (another) {
                c.targetShelfId = another.shelfId;
                c.targetSlotIndex = another.slotIndex;
                c.targetPos = another.pos;
              } else {
                c.state = 'SAD_LEAVING';
                c.targetPos = { x: 0, y: 0, z: 14 };
              }
            }
          }
        }
      } else if (c.state === 'HEADING_TO_CHECKOUT') {
        const arrived = this.stepTowards(c, c.targetPos, speed, dt);
        if (arrived) {
          c.state = 'PAYING';
          c.waitTimer = 1.2;
        }
      } else if (c.state === 'PAYING') {
        c.waitTimer = (c.waitTimer || 1.2) - dt;
        if (c.waitTimer <= 0) {
          const prod = c.heldProductId ? PRODUCTS[c.heldProductId] : null;
          let price = prod?.price || 3.0;
          if (this.teamUnlocks.has('bakery_dept')) {
            price *= 1.2;
          }
          if (this.activeEvent?.type === 'rush_hour') {
            price *= 1.5;
          }
          this.storeMoney += price;
          this.dailyRevenue += price;
          this.customersServedToday++;

          this.broadcast({
            op: ServerOpCode.STORE_ECONOMY_CHANGED,
            data: { storeMoney: this.storeMoney, storeLevel: this.storeLevel },
          });

          this.broadcast({
            op: ServerOpCode.NOTIFICATION,
            data: {
              type: 'success',
              message: `🛒 Покупатель ${c.name} приобрёл "${prod?.name || 'товар'}" (+${price.toFixed(2)}$)!`,
            },
          });

          c.heldProductId = null;
          c.state = 'LEAVING';
          c.targetPos = { x: 0, y: 0, z: 14 };
        }
      } else if (c.state === 'LEAVING' || c.state === 'SAD_LEAVING') {
        const arrived = this.stepTowards(c, c.targetPos, speed, dt);
        if (arrived || c.position.z >= 13.5) {
          toRemove.push(cId);
        }
      }
    }

    for (const id of toRemove) {
      this.customers.delete(id);
    }
  }

  private spawnCustomer(): void {
    const names = ['Алексей', 'Елена', 'Дмитрий', 'Ольга', 'Максим', 'Анна', 'Сергей', 'Татьяна', 'Иван', 'Мария', 'Павел', 'Виктория'];
    const name = names[Math.floor(Math.random() * names.length)];
    const id = `cust_${this.customerIdCounter++}`;

    const spawnX = (Math.random() - 0.5) * 4.0;
    const customer: CustomerState = {
      id,
      name,
      position: { x: spawnX, y: 0, z: 13.5 },
      rotationY: Math.PI,
      state: 'ENTERING',
      targetPos: { x: 0, y: 0, z: 6.5 },
      heldProductId: null,
    };

    this.customers.set(id, customer);
  }

  private findStockedShelfSlot(): { shelfId: string; slotIndex: number; pos: Vector3D } | null {
    const available: Array<{ shelfId: string; slotIndex: number; pos: Vector3D }> = [];

    for (const shelf of this.shelves.values()) {
      for (const slot of shelf.slots) {
        if (slot.count > 0 && slot.productId) {
          const aisleOffset = 0.9;
          const cos = Math.cos(shelf.rotationY);
          const sin = Math.sin(shelf.rotationY);
          const frontX = shelf.position.x + slot.localOffset.x * cos + aisleOffset * sin;
          const frontZ = shelf.position.z - slot.localOffset.x * sin + aisleOffset * cos;

          available.push({
            shelfId: shelf.id,
            slotIndex: slot.index,
            pos: { x: frontX, y: 0, z: frontZ },
          });
        }
      }
    }

    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  // ==========================================
  // NIGHT MONSTERS AI & INVASION
  // ==========================================
  private spawnNightMonsters(): void {
    this.monsters.clear();
    const count = SHIFT_CONFIG.NIGHT_MONSTER_COUNT_BASE + Math.min(this.shiftNumber * 2, 8);

    for (let i = 0; i < count; i++) {
      let type: MonsterType = 'STALKER';
      if (i % 3 === 1) type = 'VANDAL';
      else if (i % 3 === 2) type = 'BRUTE';

      const config = MONSTER_CONFIG[type];
      const id = `mon_${this.monsterIdCounter++}`;
      const spawnX = (Math.random() - 0.5) * 16.0;

      this.monsters.set(id, {
        id,
        type,
        position: { x: spawnX, y: 0, z: 13.5 },
        rotationY: Math.PI,
        health: config.health,
        maxHealth: config.health,
        state: 'CHASING_PLAYER',
      });
    }
  }

  private updateMonsters(dt: number): void {
    if (this.shiftPhase !== 'NIGHT' || this.monsters.size === 0) return;

    for (const [mId, m] of this.monsters) {
      if (m.state === 'DEFEATED') continue;

      const config = MONSTER_CONFIG[m.type];
      let speed = config.speed;
      if (m.isEnraged) {
        speed *= 1.25;
      }

      if (m.stunTimer && m.stunTimer > 0) {
        m.stunTimer -= dt;
        continue;
      }

      // Shock Grid Defense
      if (this.teamUnlocks.has('shock_grid') && Math.abs(m.position.x) <= 3.8 && m.position.z >= 5.5 && m.position.z <= 7.5) {
        speed *= 0.5;
        m.health -= 6 * dt;
        if (m.health <= 0) {
          this.defeatMonster(mId, undefined, 'Шоковые ловушки магазина');
          continue;
        }
      }

      if (m.attackCooldown && m.attackCooldown > 0) {
        m.attackCooldown -= dt;
      }

      if (m.type === 'STALKER') {
        const targetPlayer = this.getClosestPlayer(m.position);
        if (targetPlayer) {
          const dist = distanceXZ(m.position, targetPlayer.state.position);
          this.stepTowards(m, targetPlayer.state.position, speed, dt);

          if (dist <= 1.2 && (!m.attackCooldown || m.attackCooldown <= 0)) {
            m.attackCooldown = 2.0;
            this.broadcast({
              op: ServerOpCode.PLAYER_TACKLED,
              data: {
                attackerId: m.id,
                victimId: targetPlayer.state.id,
                impulseX: Math.sin(m.rotationY) * 1.5,
                impulseZ: Math.cos(m.rotationY) * 1.5,
                force: 1.6,
                duration: 3.0,
              },
            });
            if (targetPlayer.state.heldBoxId) {
              this.handleDropBox(targetPlayer.state.id, { throwForce: 0.2 });
            }
          }
        }
      } else if (m.type === 'VANDAL') {
        const targetShelf = this.getClosestStockedShelf(m.position);
        if (targetShelf) {
          const dist = distanceXZ(m.position, targetShelf.position);
          this.stepTowards(m, targetShelf.position, speed, dt);

          if (dist <= 1.6 && (!m.attackCooldown || m.attackCooldown <= 0)) {
            m.attackCooldown = 2.5;
            for (const slot of targetShelf.slots) {
              if (slot.count > 0 && slot.productId) {
                if (this.teamUnlocks.has('reinforced_shelves') && Math.random() < 0.5) {
                  this.broadcast({
                    op: ServerOpCode.NOTIFICATION,
                    data: {
                      type: 'info',
                      message: '🛡️ Укреплённый стеллаж выдержал удар вандала!',
                    },
                  });
                  break;
                }

                slot.count -= 1;
                const prodId = slot.productId;
                if (slot.count === 0) slot.productId = null;

                const scatterX = m.position.x + (Math.random() - 0.5) * 0.8;
                const scatterZ = m.position.z + (Math.random() - 0.5) * 0.8;
                this.spawnBox(prodId, { x: scatterX, y: 0.2, z: scatterZ });

                this.broadcast({ op: ServerOpCode.SHELF_STATE_CHANGED, data: targetShelf });
                this.broadcast({
                  op: ServerOpCode.NOTIFICATION,
                  data: {
                    type: 'error',
                    message: `💥 Монстр-вандал раскидал товары со стеллажа!`,
                  },
                });
                break;
              }
            }
          }
        } else {
          this.stepTowards(m, { x: 0, y: 0, z: 0 }, speed, dt);
        }
      } else if (m.type === 'BRUTE') {
        const closestPlayer = this.getClosestPlayer(m.position);
        const playerDist = closestPlayer ? distanceXZ(m.position, closestPlayer.state.position) : 999;

        if (closestPlayer && playerDist <= 6.0) {
          this.stepTowards(m, closestPlayer.state.position, speed, dt);
          if (playerDist <= 1.4 && (!m.attackCooldown || m.attackCooldown <= 0)) {
            m.attackCooldown = 2.2;
            this.broadcast({
              op: ServerOpCode.PLAYER_TACKLED,
              data: {
                attackerId: m.id,
                victimId: closestPlayer.state.id,
                impulseX: Math.sin(m.rotationY) * 2.2,
                impulseZ: Math.cos(m.rotationY) * 2.2,
                force: 2.2,
                duration: 3.0,
              },
            });
            if (closestPlayer.state.heldBoxId) {
              this.handleDropBox(closestPlayer.state.id, { throwForce: 0.4 });
            }
          }
        } else {
          const shelf = this.getClosestStockedShelf(m.position);
          if (shelf) {
            const sDist = distanceXZ(m.position, shelf.position);
            this.stepTowards(m, shelf.position, speed, dt);
            if (sDist <= 1.6 && (!m.attackCooldown || m.attackCooldown <= 0)) {
              m.attackCooldown = 2.5;
              for (const slot of shelf.slots) {
                if (slot.count > 0 && slot.productId) {
                  const removeCount = Math.min(2, slot.count);
                  slot.count -= removeCount;
                  const prodId = slot.productId;
                  if (slot.count === 0) slot.productId = null;

                  for (let k = 0; k < removeCount; k++) {
                    const scatterX = m.position.x + (Math.random() - 0.5) * 1.2;
                    const scatterZ = m.position.z + (Math.random() - 0.5) * 1.2;
                    this.spawnBox(prodId, { x: scatterX, y: 0.2, z: scatterZ });
                  }

                  this.broadcast({ op: ServerOpCode.SHELF_STATE_CHANGED, data: shelf });
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  private defeatMonster(monsterId: string, killerPlayerId?: string, customKillerName?: string): void {
    const monster = this.monsters.get(monsterId);
    if (!monster || monster.state === 'DEFEATED') return;

    monster.state = 'DEFEATED';
    this.monstersRepelledTonight++;

    let bonus = monster.type === 'BRUTE' ? 30 : 15;
    if (this.activeEvent?.type === 'blood_moon') {
      bonus *= 2;
    }
    if (killerPlayerId) {
      const p = this.players.get(killerPlayerId);
      if (p) {
        p.state.personalCash = (p.state.personalCash || 0) + bonus;
      }
    }

    const killerName = killerPlayerId ? this.players.get(killerPlayerId)?.state.name : customKillerName || 'Защита магазина';

    this.broadcast({
      op: ServerOpCode.MONSTER_DEFEATED,
      data: {
        monsterId,
        defeatedByPlayerId: killerPlayerId,
        bonusCash: bonus,
      },
    });

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'success',
        message: `⚔️ ${killerName} уничтожил монстра "${MONSTER_CONFIG[monster.type].name}"! (+премия $${bonus})`,
      },
    });

    setTimeout(() => {
      this.monsters.delete(monsterId);
    }, 600);
  }

  private getClosestPlayer(pos: Vector3D): { state: PlayerState; ws: WebSocket } | null {
    let closest: { state: PlayerState; ws: WebSocket } | null = null;
    let minDist = 999;
    for (const p of this.players.values()) {
      const d = distanceXZ(pos, p.state.position);
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    }
    return closest;
  }

  private getClosestStockedShelf(pos: Vector3D): ShelfState | null {
    let closest: ShelfState | null = null;
    let minDist = 999;
    for (const s of this.shelves.values()) {
      const hasItems = s.slots.some(sl => sl.count > 0);
      if (!hasItems) continue;
      const d = distanceXZ(pos, s.position);
      if (d < minDist) {
        minDist = d;
        closest = s;
      }
    }
    return closest;
  }

  // ==========================================
  // CLEANER BOT AI
  // ==========================================
  private updateCleanerBot(dt: number): void {
    if (!this.teamUnlocks.has('cleaner_bot')) {
      this.cleanerBot = null;
      return;
    }

    if (!this.cleanerBot) {
      this.cleanerBot = {
        id: 'cleaner_bot_1',
        position: { x: -6, y: 0.15, z: 6 },
        rotationY: 0,
        state: 'PATROLLING',
      };
    }

    let targetBox: BoxState | null = null;
    let minD = 999;
    for (const b of this.boxes.values()) {
      if (b.remainingItems === 0 && !b.isHeld) {
        const d = distanceXZ(this.cleanerBot.position, b.position);
        if (d < minD) {
          minD = d;
          targetBox = b;
        }
      }
    }

    if (targetBox) {
      this.cleanerBot.state = 'CLEANING';
      const arrived = this.stepTowards(this.cleanerBot, targetBox.position, 2.6, dt);
      if (arrived || minD <= 0.6) {
        this.boxes.delete(targetBox.id);
        this.broadcast({
          op: ServerOpCode.NOTIFICATION,
          data: {
            type: 'info',
            message: '🤖 Робот-уборщик утилизировал пустую коробку!',
          },
        });
      }
    } else {
      this.cleanerBot.state = 'PATROLLING';
      if (!this.cleanerBot.targetPos || distanceXZ(this.cleanerBot.position, this.cleanerBot.targetPos) < 0.5) {
        const waypoints = [
          { x: -3.5, y: 0.15, z: -5 },
          { x: -3.5, y: 0.15, z: 5 },
          { x: 3.5, y: 0.15, z: 5 },
          { x: 3.5, y: 0.15, z: -5 },
          { x: 0, y: 0.15, z: 5 },
        ];
        this.cleanerBot.targetPos = waypoints[Math.floor(Math.random() * waypoints.length)];
      }
      this.stepTowards(this.cleanerBot, this.cleanerBot.targetPos, 2.0, dt);
    }
  }

  private stepTowards(entity: { position: Vector3D; rotationY: number }, target: Vector3D, speed: number, dt: number): boolean {
    const dx = target.x - entity.position.x;
    const dz = target.z - entity.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.15) {
      entity.position.x = target.x;
      entity.position.z = target.z;
      return true;
    }

    const step = Math.min(dist, speed * dt);
    entity.position.x += (dx / dist) * step;
    entity.position.z += (dz / dist) * step;
    entity.rotationY = Math.atan2(-dx, -dz);
    return false;
  }

  // ==========================================
  // BALLISTIC FLYING BOXES & PHYSICS
  // ==========================================
  private updateFlyingBoxes(dt: number): void {
    if (this.flyingBoxes.size === 0) return;

    const halfW = STORE_LAYOUT.FLOOR_WIDTH / 2 - 0.4;
    const halfD = STORE_LAYOUT.FLOOR_DEPTH / 2 - 0.4;

    for (const [boxId, flight] of Array.from(this.flyingBoxes.entries())) {
      const box = this.boxes.get(boxId);
      if (!box || box.isHeld) {
        this.flyingBoxes.delete(boxId);
        continue;
      }

      flight.flightTime = (flight.flightTime || 0) + dt;
      flight.vy -= 16.0 * dt; // gravity
      flight.vx *= Math.pow(0.96, dt * 25);
      flight.vz *= Math.pow(0.96, dt * 25);

      box.position.x += flight.vx * dt;
      box.position.y += flight.vy * dt;
      box.position.z += flight.vz * dt;

      const speed = Math.hypot(flight.vx, flight.vy, flight.vz);

      if (speed > 1.2) {
        // 1. Check Collision with Monsters!
        for (const [mId, m] of this.monsters) {
          if (m.state === 'DEFEATED') continue;
          const distM = distanceXZ(box.position, m.position);
          if (distM < 1.1 && Math.abs(box.position.y - 0.7) < 0.9) {
            m.health -= 35;
            m.stunTimer = 1.5;
            if (m.health <= 0) {
              this.defeatMonster(mId, flight.throwerId, 'Точный бросок коробки');
            } else {
              this.broadcast({
                op: ServerOpCode.NOTIFICATION,
                data: {
                  type: 'warning',
                  message: `💥 Коробка попала в монстра! Урон: 35 (HP: ${Math.max(0, Math.round(m.health))}/${m.maxHealth})`,
                },
              });
            }
            flight.vx = -flight.vx * 0.3;
            flight.vz = -flight.vz * 0.3;
            flight.vy = 2.2;
            break;
          }
        }

        // 2. Check Collision with Shoplifter!
        for (const [cId, c] of this.customers) {
          if (c.isShoplifter && c.state !== 'KNOCKED_OUT') {
            const distC = distanceXZ(box.position, c.position);
            if (distC < 1.0 && Math.abs(box.position.y - 0.7) < 1.0) {
              c.state = 'KNOCKED_OUT';
              c.waitTimer = 3.0;
              if (c.heldProductId) {
                this.spawnBox(c.heldProductId, { x: c.position.x, y: 0.2, z: c.position.z });
                c.heldProductId = null;
              }
              this.storeMoney += EVENT_CONFIG.SHOPLIFTER_REWARD_STORE;
              const thrower = flight.throwerId ? this.players.get(flight.throwerId) : null;
              if (thrower) {
                thrower.state.personalCash = (thrower.state.personalCash || 0) + EVENT_CONFIG.SHOPLIFTER_REWARD_PERSONAL;
              }
              this.broadcast({
                op: ServerOpCode.STORE_ECONOMY_CHANGED,
                data: { storeMoney: this.storeMoney, storeLevel: this.storeLevel },
              });
              this.broadcastUpgrades();
              const heroName = thrower ? thrower.state.name : 'Игрок';
              this.endCurrentEvent(true, `🎯 ${heroName} метким броском коробки сбил вора с ног! Товар возвращён (+30$ казна, +15$ личная)!`);
              flight.vx = -flight.vx * 0.3;
              flight.vz = -flight.vz * 0.3;
              flight.vy = 2.2;
              break;
            }
          }
        }

        // 3. Check Collision with Players (3s Ragdoll Stun)
        for (const [targetPlayerId, p] of this.players.entries()) {
          if (targetPlayerId === flight.throwerId && (flight.flightTime || 0) < 0.25) continue;

          const dx = box.position.x - p.state.position.x;
          const dz = box.position.z - p.state.position.z;
          const dy = box.position.y - (p.state.position.y + 0.85);
          const horizDist = Math.hypot(dx, dz);

          if (horizDist < 0.85 && Math.abs(dy) < 0.95) {
            const hitDirX = flight.vx / (speed || 1);
            const hitDirZ = flight.vz / (speed || 1);

            this.broadcast({
              op: ServerOpCode.PLAYER_TACKLED,
              data: {
                attackerId: flight.throwerId || 'box',
                victimId: targetPlayerId,
                impulseX: hitDirX,
                impulseZ: hitDirZ,
                force: Math.min(2.0, speed / 3.0),
                duration: 3.0,
              },
            });

            this.broadcast({
              op: ServerOpCode.NOTIFICATION,
              data: {
                type: 'warning',
                message: `💥 В игрока ${p.state.name} попала коробка! Оглушен на 3 сек!`,
              },
            });

            flight.vx = -flight.vx * 0.35;
            flight.vz = -flight.vz * 0.35;
            flight.vy = 2.0;
            break;
          }
        }
      }

      // Walls bounce
      if (box.position.x < -halfW) {
        box.position.x = -halfW;
        flight.vx = -flight.vx * 0.4;
      } else if (box.position.x > halfW) {
        box.position.x = halfW;
        flight.vx = -flight.vx * 0.4;
      }

      if (box.position.z < -halfD) {
        box.position.z = -halfD;
        flight.vz = -flight.vz * 0.4;
      } else if (box.position.z > halfD) {
        box.position.z = halfD;
        flight.vz = -flight.vz * 0.4;
      }

      // Floor bounce & landing
      if (box.position.y <= 0.18) {
        box.position.y = 0.18;
        if (flight.vy < -2.0) {
          flight.vy = -flight.vy * 0.35;
          flight.vx *= 0.65;
          flight.vz *= 0.65;
        } else {
          flight.vy = 0;
          flight.vx *= 0.5;
          flight.vz *= 0.5;
        }

        if (Math.hypot(flight.vx, flight.vy, flight.vz) < 0.25) {
          this.flyingBoxes.delete(boxId);
        }
      }

      this.broadcast({
        op: ServerOpCode.BOX_STATE_CHANGED,
        data: box,
      });
    }
  }

  public addPlayer(ws: WebSocket, playerId: string, playerName: string): PlayerState {
    const playerColors = ['#e63946', '#457b9d', '#2a9d8f', '#e76f51', '#9b5de5', '#00bbf9'];
    const color = playerColors[this.players.size % playerColors.length];

    // Spawn near the store entrance
    const spawnPos: Vector3D = {
      x: 0 + (Math.random() - 0.5) * 2,
      y: 0,
      z: 7 + (Math.random() - 0.5) * 2,
    };

    const playerState: PlayerState = {
      id: playerId,
      name: playerName,
      color,
      position: spawnPos,
      rotationY: 0,
      isMoving: false,
      heldBoxId: null,
      personalCash: 50,
      personalSkills: [],
    };

    this.players.set(playerId, { state: playerState, ws });

    // Send full initial state to this player
    const initMessage: ServerMessage = {
      op: ServerOpCode.INIT_ROOM,
      data: {
        yourPlayerId: playerId,
        room: this.getRoomState(),
      },
    };
    ws.send(JSON.stringify(initMessage));

    // Notify other players
    this.broadcast(
      {
        op: ServerOpCode.PLAYER_JOINED,
        data: playerState,
      },
      playerId
    );

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'info',
        message: `${playerName} заступил на смену!`,
      },
    });

    return playerState;
  }

  public removePlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;

    // If player was holding a box, drop it on the floor
    if (p.state.heldBoxId) {
      const box = this.boxes.get(p.state.heldBoxId);
      if (box) {
        box.isHeld = false;
        box.heldByPlayerId = null;
        box.position.y = 0.2;
        this.broadcast({
          op: ServerOpCode.BOX_STATE_CHANGED,
          data: box,
        });
      }
    }

    this.players.delete(playerId);

    this.broadcast({
      op: ServerOpCode.PLAYER_LEFT,
      data: { playerId },
    });

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'info',
        message: `${p.state.name} покинул магазин.`,
      },
    });
  }

  public handleClientMessage(playerId: string, message: ClientMessage): void {
    const playerEntry = this.players.get(playerId);
    if (!playerEntry) return;

    switch (message.op) {
      case ClientOpCode.PLAYER_INPUT:
        this.handlePlayerInput(playerId, message.data);
        break;

      case ClientOpCode.INTERACT_BOX_PICKUP:
        this.handlePickupBox(playerId, message.data);
        break;

      case ClientOpCode.INTERACT_BOX_DROP:
        this.handleDropBox(playerId, message.data);
        break;

      case ClientOpCode.INTERACT_BOX_OPEN:
        this.handleOpenBox(playerId, message.data?.boxId);
        break;

      case ClientOpCode.INTERACT_PLACE_PRODUCT:
        this.handlePlaceProduct(playerId, message.data);
        break;

      case ClientOpCode.INTERACT_TAKE_PRODUCT:
        this.handleTakeProduct(playerId, message.data);
        break;

      case ClientOpCode.ORDER_DELIVERY:
        this.handleOrderDelivery(playerId, message.data);
        break;

      case ClientOpCode.PLAYER_TACKLE:
        this.handlePlayerTackle(playerId, message.data);
        break;

      case ClientOpCode.BUY_TEAM_UPGRADE:
        this.handleBuyTeamUpgrade(playerId, message.data);
        break;

      case ClientOpCode.BUY_PERSONAL_SKILL:
        this.handleBuyPersonalSkill(playerId, message.data);
        break;

      case ClientOpCode.PLAYER_ATTACK:
        this.handlePlayerAttack(playerId, message.data);
        break;

      case ClientOpCode.SKIP_PHASE:
        this.handleSkipPhase(playerId);
        break;

      case ClientOpCode.INTERACT_BREAKER:
        this.handleInteractBreaker(playerId, message.data);
        break;
    }
  }

  private handlePlayerTackle(playerId: string, data: PlayerTacklePayload): void {
    if (!data.victimId || data.victimId === playerId) return;

    // Broadcast tackle event to all players in the room
    this.broadcast({
      op: ServerOpCode.PLAYER_TACKLED,
      data: {
        attackerId: playerId,
        victimId: data.victimId,
        impulseX: data.impulseX,
        impulseZ: data.impulseZ,
        force: data.force || 1.0,
      },
    });

    // If the victim was holding a box, drop it!
    const victim = this.players.get(data.victimId);
    if (victim && victim.state.heldBoxId) {
      this.handleDropBox(data.victimId, { throwForce: 0.35 });
    }
  }

  private handlePlayerInput(playerId: string, input: PlayerInputPayload): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    const p = entry.state;
    p.rotationY = input.rotationY;
    p.isMoving = input.isMoving;

    // Direct synchronization: clamp player within supermarket boundaries
    const halfW = STORE_LAYOUT.FLOOR_WIDTH / 2 - 0.4;
    const halfD = STORE_LAYOUT.FLOOR_DEPTH / 2 - 0.4;

    p.position.x = Math.max(-halfW, Math.min(halfW, input.position.x));
    p.position.y = Math.max(0, input.position.y);
    // Front walls block Z > halfD, but entrance doorway (|X| <= 3.8) allows walking out onto dock terrace
    p.position.z = Math.max(-halfD, input.position.z);
    if (Math.abs(p.position.x) > 3.8) {
      p.position.z = Math.min(halfD, p.position.z);
    } else {
      p.position.z = Math.min(13.8, p.position.z);
    }
  }

  private handlePickupBox(playerId: string, data: InteractBoxPickupPayload): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    if (entry.state.heldBoxId) {
      this.sendError(playerId, 'Вы уже держите коробку');
      return;
    }

    const box = this.boxes.get(data.boxId);
    if (!box) {
      this.sendError(playerId, 'Коробка не найдена');
      return;
    }

    if (box.isHeld) {
      this.sendError(playerId, 'Эту коробку уже держит другой игрок');
      return;
    }

    const dist = distanceXZ(entry.state.position, box.position);
    if (dist > 5.0) {
      this.sendError(playerId, `Слишком далеко (${dist.toFixed(1)}м)`);
      return;
    }

    // Attach to player
    box.isHeld = true;
    box.heldByPlayerId = playerId;
    entry.state.heldBoxId = box.id;

    this.broadcast({
      op: ServerOpCode.BOX_STATE_CHANGED,
      data: box,
    });
  }

  private handleDropBox(playerId: string, data?: InteractBoxDropPayload): void {
    const entry = this.players.get(playerId);
    if (!entry || !entry.state.heldBoxId) return;

    const box = this.boxes.get(entry.state.heldBoxId);
    if (!box) return;

    box.isHeld = false;
    box.heldByPlayerId = null;
    entry.state.heldBoxId = null;

    const rotY = entry.state.rotationY;
    const throwForce = data?.throwForce ?? 0;

    if (throwForce <= 0.05) {
      // Gentle drop on floor in front of player
      const dropDist = 0.75;
      box.position = {
        x: entry.state.position.x - Math.sin(rotY) * dropDist,
        y: 0.18,
        z: entry.state.position.z - Math.cos(rotY) * dropDist,
      };
      this.flyingBoxes.delete(box.id);
      this.broadcast({
        op: ServerOpCode.BOX_STATE_CHANGED,
        data: box,
      });
    } else {
      // Ballistic throw
      const startDist = 0.65;
      box.position = {
        x: entry.state.position.x - Math.sin(rotY) * startDist,
        y: entry.state.position.y + 0.85,
        z: entry.state.position.z - Math.cos(rotY) * startDist,
      };

      const hasHeavyLifter = entry.state.personalSkills?.includes('heavy_lifter');
      const forceMult = hasHeavyLifter ? 1.5 : 1.0;

      const speed = (3.5 + Math.min(throwForce, 1.0) * 11.5) * forceMult;
      let vx = data?.throwVelocity?.x ?? (-Math.sin(rotY) * speed);
      let vy = data?.throwVelocity?.y ?? ((1.6 + throwForce * 3.6) * forceMult);
      let vz = data?.throwVelocity?.z ?? (-Math.cos(rotY) * speed);

      const maxSpd = 25;
      vx = Math.max(-maxSpd, Math.min(maxSpd, vx));
      vy = Math.max(-maxSpd, Math.min(maxSpd, vy));
      vz = Math.max(-maxSpd, Math.min(maxSpd, vz));

      this.flyingBoxes.set(box.id, { vx, vy, vz, throwerId: playerId, flightTime: 0 });

      this.broadcast({
        op: ServerOpCode.BOX_STATE_CHANGED,
        data: box,
      });
    }
  }

  private handleOpenBox(playerId: string, targetBoxId?: string): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    const boxId = targetBoxId || entry.state.heldBoxId;
    if (!boxId) return;

    const box = this.boxes.get(boxId);
    if (!box || box.isOpen) return;

    box.isOpen = true;
    this.broadcast({
      op: ServerOpCode.BOX_STATE_CHANGED,
      data: box,
    });

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'info',
        message: `${entry.state.name} открыл коробку: ${PRODUCTS[box.productId]?.name ?? box.productId}`,
      },
    });
  }

  private handlePlaceProduct(playerId: string, data: InteractPlaceProductPayload): void {
    const entry = this.players.get(playerId);
    if (!entry || !entry.state.heldBoxId) {
      this.sendError(playerId, 'Для раскладки товаров возьмите открытую коробку');
      return;
    }

    const box = this.boxes.get(entry.state.heldBoxId);
    if (!box || !box.isOpen) {
      this.sendError(playerId, 'Сначала откройте коробку (нажмите R)');
      return;
    }

    if (box.remainingItems <= 0) {
      this.sendError(playerId, 'В коробке больше нет товаров');
      return;
    }

    const shelf = this.shelves.get(data.shelfId);
    const slot = shelf?.slots[data.slotIndex];
    if (!shelf || !slot) return;

    if (slot.productId !== null && slot.productId !== box.productId && slot.count > 0) {
      this.sendError(playerId, 'В слоте размещен другой товар');
      return;
    }

    const prod = PRODUCTS[box.productId];
    const maxCapacity = (prod?.shelfCols && prod?.shelfRows)
      ? prod.shelfCols * prod.shelfRows
      : (prod?.boxCapacity || SHELF_CONFIG.MAX_ITEMS_PER_SLOT);

    slot.maxCount = maxCapacity;

    if (slot.count >= maxCapacity) {
      this.sendError(playerId, `Слот уже полон (макс. ${maxCapacity} шт.)`);
      return;
    }

    // Check Speed Stocker Perk: places 2 items per click
    const hasSpeedStocker = entry.state.personalSkills?.includes('speed_stocker');
    const placeCount = Math.min(hasSpeedStocker ? 2 : 1, box.remainingItems, maxCapacity - slot.count);

    box.remainingItems -= placeCount;
    slot.productId = box.productId;
    slot.count += placeCount;

    if (box.remainingItems === 0) {
      this.broadcast({
        op: ServerOpCode.NOTIFICATION,
        data: {
          type: 'success',
          message: `Коробка пуста! Товар "${prod?.name || box.productId}" разложен на полку.`,
        },
      });
    }

    this.broadcast({ op: ServerOpCode.SHELF_STATE_CHANGED, data: shelf });
    this.broadcast({ op: ServerOpCode.BOX_STATE_CHANGED, data: box });
  }

  private handleTakeProduct(playerId: string, data: InteractTakeProductPayload): void {
    const entry = this.players.get(playerId);
    if (!entry || !entry.state.heldBoxId) return;

    const box = this.boxes.get(entry.state.heldBoxId);
    if (!box || !box.isOpen) return;

    const shelf = this.shelves.get(data.shelfId);
    const slot = shelf?.slots[data.slotIndex];
    if (!shelf || !slot || slot.count <= 0 || slot.productId !== box.productId) return;

    if (box.remainingItems >= box.maxItems) {
      this.sendError(playerId, 'Коробка уже полная');
      return;
    }

    slot.count -= 1;
    if (slot.count === 0) slot.productId = null;
    box.remainingItems += 1;

    this.broadcast({ op: ServerOpCode.SHELF_STATE_CHANGED, data: shelf });
    this.broadcast({ op: ServerOpCode.BOX_STATE_CHANGED, data: box });
  }

  private handlePlayerAttack(playerId: string, _data: PlayerAttackPayload): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    const pPos = entry.state.position;
    const pRot = entry.state.rotationY;

    const hasBat = entry.state.personalSkills?.includes('security_bat');
    const attackDmg = hasBat ? 65 : 25;
    const knockForce = hasBat ? 2.8 : 1.5;
    const range = 2.0;

    let hitAny = false;
    for (const [mId, m] of this.monsters) {
      if (m.state === 'DEFEATED') continue;

      const dist = distanceXZ(pPos, m.position);
      if (dist <= range) {
        const dx = m.position.x - pPos.x;
        const dz = m.position.z - pPos.z;
        const angle = Math.atan2(-dx, -dz);
        let diff = Math.abs(angle - pRot);
        while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);

        if (diff < 1.2) {
          hitAny = true;
          m.health -= attackDmg;
          m.stunTimer = 0.8;

          m.position.x += -Math.sin(pRot) * knockForce;
          m.position.z += -Math.cos(pRot) * knockForce;

          if (m.health <= 0) {
            this.defeatMonster(mId, playerId, entry.state.name);
          } else {
            this.broadcast({
              op: ServerOpCode.NOTIFICATION,
              data: {
                type: 'info',
                message: `💥 ${entry.state.name} нанёс ${attackDmg} урона монстру!`,
              },
            });
          }
          break;
        }
      }
    }

    // Check hit on Shoplifter!
    for (const [cId, c] of this.customers) {
      if (c.isShoplifter && c.state !== 'KNOCKED_OUT') {
        const dist = distanceXZ(pPos, c.position);
        if (dist <= range + 0.3) {
          hitAny = true;
          c.state = 'KNOCKED_OUT';
          c.waitTimer = 3.0;
          if (c.heldProductId) {
            this.spawnBox(c.heldProductId, { x: c.position.x, y: 0.2, z: c.position.z });
            c.heldProductId = null;
          }
          this.storeMoney += EVENT_CONFIG.SHOPLIFTER_REWARD_STORE;
          entry.state.personalCash = (entry.state.personalCash || 0) + EVENT_CONFIG.SHOPLIFTER_REWARD_PERSONAL;
          this.broadcast({
            op: ServerOpCode.STORE_ECONOMY_CHANGED,
            data: { storeMoney: this.storeMoney, storeLevel: this.storeLevel },
          });
          this.broadcastUpgrades();
          this.endCurrentEvent(true, `👮 ${entry.state.name} задержал вора! Товар возвращён (+30$ казна, +15$ личная)!`);
          break;
        }
      }
    }

    if (!hitAny && hasBat) {
      this.broadcast({
        op: ServerOpCode.NOTIFICATION,
        data: {
          type: 'info',
          message: `🏏 ${entry.state.name} взмахнул битой!`,
        },
      });
    }
  }

  private handleBuyTeamUpgrade(playerId: string, data: BuyTeamUpgradePayload): void {
    const upgrade = TEAM_UPGRADES[data.upgradeId];
    if (!upgrade) return;

    if (this.teamUnlocks.has(upgrade.id)) {
      this.sendError(playerId, 'Это командное улучшение уже куплено');
      return;
    }

    if (this.storeMoney < upgrade.cost) {
      this.sendError(playerId, `Недостаточно казны ($${this.storeMoney.toFixed(2)} < $${upgrade.cost})`);
      return;
    }

    this.storeMoney -= upgrade.cost;
    this.teamUnlocks.add(upgrade.id);

    this.broadcast({
      op: ServerOpCode.STORE_ECONOMY_CHANGED,
      data: { storeMoney: this.storeMoney, storeLevel: this.storeLevel },
    });

    this.broadcastUpgrades();

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'success',
        message: `🎉 Разблокировано командное открытие: "${upgrade.name}" (${upgrade.icon})!`,
      },
    });
  }

  private handleBuyPersonalSkill(playerId: string, data: BuyPersonalSkillPayload): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    const skill = PERSONAL_SKILLS[data.skillId];
    if (!skill) return;

    entry.state.personalSkills = entry.state.personalSkills || [];
    if (entry.state.personalSkills.includes(skill.id)) {
      this.sendError(playerId, 'Этот навык уже изучен');
      return;
    }

    const cash = entry.state.personalCash || 0;
    if (cash < skill.cost) {
      this.sendError(playerId, `Недостаточно личных средств ($${cash} < $${skill.cost})`);
      return;
    }

    entry.state.personalCash = cash - skill.cost;
    entry.state.personalSkills.push(skill.id);

    this.broadcastUpgrades();

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'success',
        message: `⭐ ${entry.state.name} освоил навык: "${skill.name}" (${skill.icon})!`,
      },
    });
  }

  private handleSkipPhase(playerId: string): void {
    if (this.shiftTimer > 5) {
      this.shiftTimer = 2.0;
      const p = this.players.get(playerId);
      this.broadcast({
        op: ServerOpCode.NOTIFICATION,
        data: {
          type: 'info',
          message: `⏩ ${p?.state.name || 'Игрок'} ускорил переход к следующей фазе смены!`,
        },
      });
    }
  }

  private broadcastUpgrades(): void {
    const playerSkillsMap: Record<string, string[]> = {};
    const personalCashMap: Record<string, number> = {};

    for (const [id, p] of this.players) {
      playerSkillsMap[id] = p.state.personalSkills || [];
      personalCashMap[id] = p.state.personalCash || 0;
    }

    this.broadcast({
      op: ServerOpCode.UPGRADES_CHANGED,
      data: {
        teamUnlocks: Array.from(this.teamUnlocks),
        playerSkills: playerSkillsMap,
        personalCash: personalCashMap,
      },
    });
  }

  private handleOrderDelivery(playerId: string, data: OrderDeliveryPayload): void {
    const product = PRODUCTS[data.productId];
    if (!product) return;

    const qty = Math.max(1, Math.min(10, data.quantity));
    const totalCost = product.cost * qty * product.boxCapacity;

    if (this.storeMoney < totalCost) {
      this.sendError(playerId, `Недостаточно средств магазина. Требуется $${totalCost.toFixed(2)}, баланс $${this.storeMoney.toFixed(2)}`);
      return;
    }

    this.storeMoney -= totalCost;

    // Spawn delivery boxes in delivery zone
    const spawnZStart = 5.5;
    for (let i = 0; i < qty; i++) {
      const offsetX = (i % 3) * 0.9 - 1.0;
      const offsetZ = Math.floor(i / 3) * 0.9;
      this.spawnBox(data.productId, {
        x: STORE_LAYOUT.DELIVERY_ZONE.center.x + offsetX,
        y: 0.2,
        z: spawnZStart + offsetZ,
      });
    }

    this.broadcast({
      op: ServerOpCode.STORE_ECONOMY_CHANGED,
      data: {
        storeMoney: this.storeMoney,
        storeLevel: this.storeLevel,
      },
    });

    this.broadcast({
      op: ServerOpCode.NOTIFICATION,
      data: {
        type: 'success',
        message: `Доставка прибыла: ${qty} кор. "${product.name}". Списано: $${totalCost.toFixed(2)}`,
      },
    });
  }

  private sendError(playerId: string, reason: string): void {
    const entry = this.players.get(playerId);
    if (!entry) return;

    const msg: ServerMessage = {
      op: ServerOpCode.ACTION_REJECTED,
      data: {
        reason,
        code: 'ACTION_FAILED',
      },
    };
    entry.ws.send(JSON.stringify(msg));
  }

  public broadcast(message: ServerMessage, excludePlayerId?: string): void {
    const raw = JSON.stringify(message);
    for (const [id, entry] of this.players) {
      if (excludePlayerId && id === excludePlayerId) continue;
      if (entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(raw);
      }
    }
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public getRoomState(): RoomState {
    const playersObj: Record<string, PlayerState> = {};
    for (const [id, p] of this.players) {
      playersObj[id] = p.state;
    }

    const shelvesObj: Record<string, ShelfState> = {};
    for (const [id, s] of this.shelves) {
      shelvesObj[id] = s;
    }

    const boxesObj: Record<string, BoxState> = {};
    for (const [id, b] of this.boxes) {
      boxesObj[id] = b;
    }

    const customersObj: Record<string, CustomerState> = {};
    for (const [id, c] of this.customers) {
      customersObj[id] = c;
    }

    const monstersObj: Record<string, MonsterState> = {};
    for (const [id, m] of this.monsters) {
      monstersObj[id] = m;
    }

    const cleanerBotsObj: Record<string, CleanerBotState> = {};
    if (this.cleanerBot) {
      cleanerBotsObj[this.cleanerBot.id] = this.cleanerBot;
    }

    return {
      roomId: this.id,
      name: this.name,
      createdAt: this.createdAt,
      hostId: this.hostId,
      players: playersObj,
      shelves: shelvesObj,
      boxes: boxesObj,
      storeMoney: this.storeMoney,
      storeLevel: this.storeLevel,
      shift: this.getShiftState(),
      teamUnlocks: Array.from(this.teamUnlocks),
      customers: customersObj,
      monsters: monstersObj,
      cleanerBots: cleanerBotsObj,
    };
  }
}
