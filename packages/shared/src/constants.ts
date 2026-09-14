import { ProductDefinition, Vector3D } from './types.js';

export const NETWORK_CONFIG = {
  SERVER_TICK_RATE: 25, // 25 updates per second
  TICK_INTERVAL_MS: 1000 / 25, // 40ms
  INTERPOLATION_OFFSET_MS: 100, // 100ms snapshot buffer for smooth rendering
  MAX_INTERACTION_DISTANCE: 2.8, // in meters
  RECONCILIATION_THRESHOLD: 0.25, // position delta threshold to trigger snap
} as const;

export const PLAYER_CONFIG = {
  MOVE_SPEED: 4.8, // meters per second
  SPRINT_SPEED: 7.2,
  ROTATION_LERP_FACTOR: 0.2,
  RADIUS: 0.35,
  HEIGHT: 1.7,
} as const;

export const SHELF_CONFIG = {
  WIDTH: 2.2,
  DEPTH: 0.65,
  HEIGHT: 2.1,
  TIERS: 3,
  SLOTS_PER_TIER: 4,
  MAX_ITEMS_PER_SLOT: 12, // Up to 12 cans/bottles per slot in 3x4 grid
  TIER_Y_OFFSETS: [0.45, 1.05, 1.65], // vertical offsets for 3 shelves
} as const;

export const PRODUCTS: Record<string, ProductDefinition> = {
  'cola_can': {
    id: 'cola_can',
    name: 'Classic Cola',
    category: 'beverages',
    price: 2.5,
    cost: 1.2,
    unitWeight: 0.35,
    color: '#e63946',
    secondaryColor: '#f1faee',
    iconUrl: '/textures/products/cola_cola_label.png',
    modelPath: '/models/products/cola.glb',
    modelType: 'can',
    dimensions: { width: 0.09, height: 0.18, depth: 0.09 },
    boxCapacity: 12,
    shelfCols: 4,
    shelfRows: 3,
  },
  'chipsi': {
    id: 'chipsi',
    name: 'Crispy Chips',
    category: 'snacks',
    price: 3.2,
    cost: 1.5,
    unitWeight: 0.25,
    color: '#f4a261',
    secondaryColor: '#e76f51',
    iconUrl: '/textures/products/chipsi_chip_bag_body.png',
    modelPath: '/models/products/chipsi.glb',
    modelType: 'box_tall',
    dimensions: { width: 0.17, height: 0.20, depth: 0.08 },
    boxCapacity: 8,
    shelfCols: 4,
    shelfRows: 2,
  },
  'egg_tray': {
    id: 'egg_tray',
    name: 'Farm Fresh Eggs',
    category: 'dairy',
    price: 4.5,
    cost: 2.2,
    unitWeight: 0.6,
    color: '#e9c46a',
    secondaryColor: '#f4a261',
    iconUrl: '/textures/products/Egg_Tray_carton_tex.png',
    modelPath: '/models/products/egg_tray.glb',
    modelType: 'box_wide',
    dimensions: { width: 0.25, height: 0.10, depth: 0.18 },
    boxCapacity: 6,
    shelfCols: 3,
    shelfRows: 2,
  },
  'orange_soda': {
    id: 'orange_soda',
    name: 'Orange Fizz',
    category: 'beverages',
    price: 2.2,
    cost: 1.0,
    unitWeight: 0.35,
    color: '#f77f00',
    secondaryColor: '#fcbf49',
    modelType: 'can',
    dimensions: { width: 0.09, height: 0.18, depth: 0.09 },
    boxCapacity: 12,
    shelfCols: 4,
    shelfRows: 3,
  },
  'cereal_crunch': {
    id: 'cereal_crunch',
    name: 'Golden Flakes',
    category: 'breakfast',
    price: 4.8,
    cost: 2.4,
    unitWeight: 0.5,
    color: '#fcbf49',
    secondaryColor: '#003049',
    modelType: 'box_tall',
    dimensions: { width: 0.14, height: 0.26, depth: 0.08 },
    boxCapacity: 8,
    shelfCols: 4,
    shelfRows: 2,
  },
  'fresh_milk': {
    id: 'fresh_milk',
    name: 'Farm Fresh Milk',
    category: 'dairy',
    price: 3.1,
    cost: 1.6,
    unitWeight: 1.0,
    color: '#457b9d',
    secondaryColor: '#f1faee',
    modelType: 'carton',
    dimensions: { width: 0.11, height: 0.22, depth: 0.11 },
    boxCapacity: 8,
    shelfCols: 4,
    shelfRows: 2,
  },
  'pasta_spaghetti': {
    id: 'pasta_spaghetti',
    name: 'Italian Pasta',
    category: 'grocery',
    price: 2.9,
    cost: 1.3,
    unitWeight: 0.5,
    color: '#2a9d8f',
    secondaryColor: '#e76f51',
    modelType: 'box_wide',
    dimensions: { width: 0.13, height: 0.22, depth: 0.07 },
    boxCapacity: 10,
    shelfCols: 5,
    shelfRows: 2,
  },
  'coffee_jar': {
    id: 'coffee_jar',
    name: 'Espresso Roast',
    category: 'beverages',
    price: 7.5,
    cost: 4.0,
    unitWeight: 0.4,
    color: '#3d2b1f',
    secondaryColor: '#d4a373',
    modelType: 'bottle',
    dimensions: { width: 0.1, height: 0.16, depth: 0.1 },
    boxCapacity: 8,
    shelfCols: 4,
    shelfRows: 2,
  },
};

export const STORE_LAYOUT = {
  FLOOR_WIDTH: 24,
  FLOOR_DEPTH: 20,
  WALL_HEIGHT: 3.5,
  DELIVERY_ZONE: {
    minX: -10,
    maxX: -6,
    minZ: 5,
    maxZ: 9,
    center: { x: -8, y: 0, z: 7 } as Vector3D,
  },
  CHECKOUT_ZONE: {
    center: { x: 7, y: 0, z: 6 } as Vector3D,
  }
} as const;

export const SHIFT_CONFIG = {
  DAY_DURATION: 90, // 90 seconds
  EVENING_DURATION: 45, // 45 seconds
  NIGHT_DURATION: 60, // 60 seconds
  BASE_SALARY: 50, // base salary paid to each player per shift
  CUSTOMER_SPAWN_INTERVAL_BASE: 4.5, // seconds between customer spawns
  CUSTOMER_SPAWN_INTERVAL_BAKERY: 2.5, // with bakery upgrade
  MAX_CUSTOMERS: 8,
  NIGHT_MONSTER_COUNT_BASE: 5,
} as const;

export const TEAM_UPGRADES: Record<string, {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon: string;
}> = {
  cleaner_bot: {
    id: 'cleaner_bot',
    name: 'Робот-уборщик',
    description: 'Автономный уборщик патрулирует магазин и собирает пустые коробки с пола.',
    cost: 300,
    icon: '🤖',
  },
  bakery_dept: {
    id: 'bakery_dept',
    name: 'Отдел свежей выпечки',
    description: 'Привлекает на 50% больше покупателей и повышает ежедневную выручку.',
    cost: 450,
    icon: '🥐',
  },
  reinforced_shelves: {
    id: 'reinforced_shelves',
    name: 'Укрепленные стеллажи',
    description: 'Стеллажи становятся намного прочнее и выдерживают атаки ночных монстров.',
    cost: 350,
    icon: '🛡️',
  },
  shock_grid: {
    id: 'shock_grid',
    name: 'Электро-ловушки на входе',
    description: 'Шоковые барьеры у дверей наносят урон и замедляют вторгшихся монстров.',
    cost: 500,
    icon: '⚡',
  },
};

export const PERSONAL_SKILLS: Record<string, {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon: string;
}> = {
  security_bat: {
    id: 'security_bat',
    name: 'Бита охранника',
    description: 'Личное оружие! Клавиша [F / ЛКМ] наносит сокрушительный удар и отбрасывает монстров.',
    cost: 50,
    icon: '🏏',
  },
  heavy_lifter: {
    id: 'heavy_lifter',
    name: 'Силач',
    description: 'Спринт с коробками без потери скорости, а сила и дальность броска увеличены на 50%.',
    cost: 40,
    icon: '💪',
  },
  marathoner: {
    id: 'marathoner',
    name: 'Марафонец',
    description: 'Выносливость увеличена в 2 раза (10 сек бега) и начинает восстанавливаться быстрее.',
    cost: 35,
    icon: '🏃',
  },
  speed_stocker: {
    id: 'speed_stocker',
    name: 'Супер-мерчендайзер',
    description: 'Раскладка товаров на полку происходит сразу по 2 единицы за клик.',
    cost: 45,
    icon: '⚡',
  },
};

export const MONSTER_CONFIG = {
  STALKER: {
    type: 'STALKER' as const,
    name: 'Охотник',
    health: 40,
    speed: 4.0,
    damage: 15,
    tackleForce: 1.5,
    tackleDuration: 3.0,
    attackRange: 1.1,
    color: '#ef4444',
  },
  VANDAL: {
    type: 'VANDAL' as const,
    name: 'Вандал',
    health: 30,
    speed: 3.2,
    shelfDamage: 1,
    attackInterval: 2.2,
    attackRange: 1.4,
    color: '#a855f7',
  },
  BRUTE: {
    type: 'BRUTE' as const,
    name: 'Опустошитель',
    health: 85,
    speed: 2.3,
    damage: 25,
    tackleForce: 2.2,
    tackleDuration: 3.0,
    shelfDamage: 2,
    attackRange: 1.5,
    color: '#ea580c',
  },
} as const;

export const BREAKER_CONFIG = {
  position: { x: -8.0, y: 1.5, z: -9.8 },
  INTERACTION_RADIUS: 2.4,
  REPAIR_TIME_SECONDS: 4.5,
} as const;

export const EVENT_CONFIG = {
  EVENT_CHANCE_DAY: 0.70, // 70% chance of day event
  EVENT_CHANCE_NIGHT: 0.75, // 75% chance of night event
  RUSH_HOUR_DURATION: 40,
  SAN_INSPECTION_DURATION: 45,
  SAN_INSPECTION_BONUS: 200,
  SAN_INSPECTION_FINE: 150,
  SHOPLIFTER_REWARD_STORE: 30,
  SHOPLIFTER_REWARD_PERSONAL: 15,
  BLOOD_MOON_DURATION: 55,
  BLACKOUT_DURATION: 50,
  BLACKOUT_REPAIR_REWARD: 50,
} as const;
