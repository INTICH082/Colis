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
  MAX_ITEMS_PER_SLOT: 6, // 6 cans/boxes per slot in depth
  TIER_Y_OFFSETS: [0.45, 1.05, 1.65], // vertical offsets for 3 shelves
} as const;

export const PRODUCTS: Record<string, ProductDefinition> = {
  'cola_can': {
    id: 'cola_can',
    name: 'Sparkling Cola',
    category: 'beverages',
    price: 2.5,
    cost: 1.2,
    unitWeight: 0.35,
    color: '#e63946',
    secondaryColor: '#f1faee',
    modelType: 'can',
    dimensions: { width: 0.09, height: 0.18, depth: 0.09 },
    boxCapacity: 12,
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
