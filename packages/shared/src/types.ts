export type Vector3D = {
  x: number;
  y: number;
  z: number;
};

export type Quaternion4D = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export interface ProductDefinition {
  id: string;
  name: string;
  category: 'beverages' | 'snacks' | 'dairy' | 'canned' | 'grocery' | 'breakfast';
  price: number;
  cost: number;
  unitWeight: number; // in kg
  color: string;
  secondaryColor?: string;
  iconUrl?: string;
  modelPath?: string;
  modelType: 'can' | 'box_tall' | 'box_wide' | 'carton' | 'bottle';
  dimensions: {
    width: number;
    height: number;
    depth: number;
  };
  boxCapacity: number; // how many units fit in one delivery box
  shelfCols?: number;  // items across in width (left to right)
  shelfRows?: number;  // rows in depth (front to back)
}

export interface BoxState {
  id: string;
  productId: string;
  remainingItems: number;
  maxItems: number;
  isOpen: boolean;
  isHeld: boolean;
  heldByPlayerId: string | null;
  position: Vector3D;
  rotation: Quaternion4D;
}

export interface ShelfSlotState {
  index: number;
  tier: number;
  productId: string | null;
  count: number;
  maxCount: number;
  localOffset: Vector3D;
}

export interface ShelfState {
  id: string;
  type: 'standard_shelf' | 'fridge' | 'display_stand';
  position: Vector3D;
  rotationY: number; // in radians
  slots: ShelfSlotState[];
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  position: Vector3D;
  rotationY: number;
  isMoving: boolean;
  heldBoxId: string | null;
  ping?: number;
  personalCash?: number;
  personalSkills?: string[];
}

export type ShiftPhase = 'DAY' | 'EVENING' | 'NIGHT';

export interface ShiftState {
  shiftNumber: number;
  phase: ShiftPhase;
  phaseTimeRemaining: number; // in seconds
  totalPhaseDuration: number;
  customersServedToday: number;
  dailyRevenue: number;
  monstersRepelledTonight: number;
}

export type CustomerBehaviorState = 'ENTERING' | 'BROWSING' | 'HEADING_TO_CHECKOUT' | 'PAYING' | 'LEAVING' | 'SAD_LEAVING';

export interface CustomerState {
  id: string;
  name: string;
  position: Vector3D;
  rotationY: number;
  state: CustomerBehaviorState;
  targetPos: Vector3D;
  heldProductId: string | null;
  targetShelfId?: string;
  targetSlotIndex?: number;
  waitTimer?: number;
}

export type MonsterType = 'STALKER' | 'VANDAL' | 'BRUTE';
export type MonsterBehaviorState = 'SPAWNING' | 'CHASING_PLAYER' | 'ATTACKING_PLAYER' | 'TARGETING_SHELF' | 'ATTACKING_SHELF' | 'STUNNED' | 'DEFEATED';

export interface MonsterState {
  id: string;
  type: MonsterType;
  position: Vector3D;
  rotationY: number;
  health: number;
  maxHealth: number;
  state: MonsterBehaviorState;
  targetId?: string; // playerId or shelfId
  attackCooldown?: number;
  stunTimer?: number;
}

export interface CleanerBotState {
  id: string;
  position: Vector3D;
  rotationY: number;
  state: 'PATROLLING' | 'CLEANING';
  targetPos?: Vector3D;
}

export interface TeamUpgradeDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon: string;
}

export interface PersonalSkillDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon: string;
}

export interface RoomState {
  roomId: string;
  name: string;
  createdAt: number;
  hostId: string;
  players: Record<string, PlayerState>;
  shelves: Record<string, ShelfState>;
  boxes: Record<string, BoxState>;
  storeMoney: number;
  storeLevel: number;
  shift: ShiftState;
  teamUnlocks: string[];
  customers: Record<string, CustomerState>;
  monsters: Record<string, MonsterState>;
  cleanerBots?: Record<string, CleanerBotState>;
}
