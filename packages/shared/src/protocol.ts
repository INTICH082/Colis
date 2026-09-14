import { BoxState, PlayerState, RoomState, ShelfState, Vector3D } from './types.js';

export enum ClientOpCode {
  JOIN_ROOM = 'JOIN_ROOM',
  LEAVE_ROOM = 'LEAVE_ROOM',
  PLAYER_INPUT = 'PLAYER_INPUT',
  INTERACT_BOX_PICKUP = 'INTERACT_BOX_PICKUP',
  INTERACT_BOX_DROP = 'INTERACT_BOX_DROP',
  INTERACT_BOX_OPEN = 'INTERACT_BOX_OPEN',
  INTERACT_PLACE_PRODUCT = 'INTERACT_PLACE_PRODUCT',
  INTERACT_TAKE_PRODUCT = 'INTERACT_TAKE_PRODUCT',
  ORDER_DELIVERY = 'ORDER_DELIVERY',
  PLAYER_TACKLE = 'PLAYER_TACKLE',
  BUY_TEAM_UPGRADE = 'BUY_TEAM_UPGRADE',
  BUY_PERSONAL_SKILL = 'BUY_PERSONAL_SKILL',
  PLAYER_ATTACK = 'PLAYER_ATTACK',
  SKIP_PHASE = 'SKIP_PHASE',
}

export enum ServerOpCode {
  INIT_ROOM = 'INIT_ROOM',
  PLAYER_JOINED = 'PLAYER_JOINED',
  PLAYER_LEFT = 'PLAYER_LEFT',
  WORLD_TICK = 'WORLD_TICK',
  BOX_STATE_CHANGED = 'BOX_STATE_CHANGED',
  SHELF_STATE_CHANGED = 'SHELF_STATE_CHANGED',
  STORE_ECONOMY_CHANGED = 'STORE_ECONOMY_CHANGED',
  ACTION_REJECTED = 'ACTION_REJECTED',
  NOTIFICATION = 'NOTIFICATION',
  PLAYER_TACKLED = 'PLAYER_TACKLED',
  SHIFT_STATE_CHANGED = 'SHIFT_STATE_CHANGED',
  UPGRADES_CHANGED = 'UPGRADES_CHANGED',
  MONSTER_DEFEATED = 'MONSTER_DEFEATED',
  SHIFT_SUMMARY = 'SHIFT_SUMMARY',
}

// Client -> Server
export interface JoinRoomPayload {
  roomId: string;
  playerName: string;
}

export interface PlayerInputPayload {
  sequence: number;
  position: Vector3D;
  rotationY: number; // Aim angle in isometric view
  isMoving: boolean;
  isSprinting: boolean;
  deltaMs: number;
}

export interface InteractBoxPickupPayload {
  boxId: string;
  playerPosition?: Vector3D;
}

export interface InteractBoxDropPayload {
  position?: Vector3D;
  throwForce?: number; // 0 for gentle drop, 0.1-1.0 for throw
  throwVelocity?: Vector3D;
}

export interface InteractBoxOpenPayload {
  boxId?: string; // If omitted, current held box
  playerPosition?: Vector3D;
}

export interface InteractPlaceProductPayload {
  shelfId: string;
  slotIndex: number;
  playerPosition?: Vector3D;
}

export interface InteractTakeProductPayload {
  shelfId: string;
  slotIndex: number;
  playerPosition?: Vector3D;
}

export interface OrderDeliveryPayload {
  productId: string;
  quantity: number; // number of boxes
}

export interface PlayerTacklePayload {
  attackerId: string;
  victimId: string;
  impulseX: number;
  impulseZ: number;
  force?: number;
  duration?: number;
}

export interface BuyTeamUpgradePayload {
  upgradeId: string;
}

export interface BuyPersonalSkillPayload {
  skillId: string;
}

export interface PlayerAttackPayload {
  hitDirection: Vector3D;
  position?: Vector3D;
}

export type ClientMessage =
  | { op: ClientOpCode.JOIN_ROOM; data: JoinRoomPayload }
  | { op: ClientOpCode.LEAVE_ROOM }
  | { op: ClientOpCode.PLAYER_INPUT; data: PlayerInputPayload }
  | { op: ClientOpCode.INTERACT_BOX_PICKUP; data: InteractBoxPickupPayload }
  | { op: ClientOpCode.INTERACT_BOX_DROP; data: InteractBoxDropPayload }
  | { op: ClientOpCode.INTERACT_BOX_OPEN; data: InteractBoxOpenPayload }
  | { op: ClientOpCode.INTERACT_PLACE_PRODUCT; data: InteractPlaceProductPayload }
  | { op: ClientOpCode.INTERACT_TAKE_PRODUCT; data: InteractTakeProductPayload }
  | { op: ClientOpCode.ORDER_DELIVERY; data: OrderDeliveryPayload }
  | { op: ClientOpCode.PLAYER_TACKLE; data: PlayerTacklePayload }
  | { op: ClientOpCode.BUY_TEAM_UPGRADE; data: BuyTeamUpgradePayload }
  | { op: ClientOpCode.BUY_PERSONAL_SKILL; data: BuyPersonalSkillPayload }
  | { op: ClientOpCode.PLAYER_ATTACK; data: PlayerAttackPayload }
  | { op: ClientOpCode.SKIP_PHASE };

// Server -> Client
export interface InitRoomPayload {
  yourPlayerId: string;
  room: RoomState;
}

export interface WorldTickPayload {
  tick: number;
  timestamp: number;
  players: Record<string, {
    position: Vector3D;
    rotationY: number;
    isMoving: boolean;
    heldBoxId: string | null;
    lastProcessedInput?: number;
  }>;
  dynamicBoxes?: Record<string, {
    position: Vector3D;
    rotation: { x: number; y: number; z: number; w: number };
  }>;
  customers?: Record<string, {
    position: Vector3D;
    rotationY: number;
    state: string;
    heldProductId: string | null;
  }>;
  monsters?: Record<string, {
    position: Vector3D;
    rotationY: number;
    state: string;
    health: number;
    maxHealth: number;
    type: string;
  }>;
  cleanerBots?: Record<string, {
    position: Vector3D;
    rotationY: number;
    state: string;
  }>;
  shiftTimeRemaining?: number;
}

export interface ActionRejectedPayload {
  reason: string;
  code: string;
}

export interface NotificationPayload {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface UpgradesChangedPayload {
  teamUnlocks: string[];
  playerSkills: Record<string, string[]>;
  personalCash: Record<string, number>;
}

export interface MonsterDefeatedPayload {
  monsterId: string;
  defeatedByPlayerId?: string;
  bonusCash: number;
}

export interface ShiftSummaryPayload {
  shiftNumber: number;
  revenue: number;
  customersServed: number;
  monstersRepelled: number;
  salaryBonus: number;
}

export type ServerMessage =
  | { op: ServerOpCode.INIT_ROOM; data: InitRoomPayload }
  | { op: ServerOpCode.PLAYER_JOINED; data: PlayerState }
  | { op: ServerOpCode.PLAYER_LEFT; data: { playerId: string } }
  | { op: ServerOpCode.WORLD_TICK; data: WorldTickPayload }
  | { op: ServerOpCode.BOX_STATE_CHANGED; data: BoxState }
  | { op: ServerOpCode.SHELF_STATE_CHANGED; data: ShelfState }
  | { op: ServerOpCode.STORE_ECONOMY_CHANGED; data: { storeMoney: number; storeLevel: number } }
  | { op: ServerOpCode.ACTION_REJECTED; data: ActionRejectedPayload }
  | { op: ServerOpCode.NOTIFICATION; data: NotificationPayload }
  | { op: ServerOpCode.PLAYER_TACKLED; data: PlayerTacklePayload }
  | { op: ServerOpCode.SHIFT_STATE_CHANGED; data: import('./types.js').ShiftState }
  | { op: ServerOpCode.UPGRADES_CHANGED; data: UpgradesChangedPayload }
  | { op: ServerOpCode.MONSTER_DEFEATED; data: MonsterDefeatedPayload }
  | { op: ServerOpCode.SHIFT_SUMMARY; data: ShiftSummaryPayload };
