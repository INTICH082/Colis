import * as THREE from 'three';
import { CustomerState, PRODUCTS } from '@colis/shared';

interface CustomerRenderEntry {
  group: THREE.Group;
  targetPos: THREE.Vector3;
  targetRotY: number;
  nameSprite: THREE.Sprite;
  basketMesh: THREE.Group;
  heldItemMesh: THREE.Mesh | null;
  currentProductId: string | null;
  walkCycleTime: number;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
}

export class CustomerEntityManager {
  private scene: THREE.Scene;
  private customers: Map<string, CustomerRenderEntry> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public syncCustomers(serverCustomers: Record<string, {
    position: { x: number; y: number; z: number };
    rotationY: number;
    state: string;
    heldProductId: string | null;
    isShoplifter?: boolean;
    isKnockedOut?: boolean;
    stolenItemName?: string;
  }> | undefined): void {
    if (!serverCustomers) {
      for (const entry of this.customers.values()) {
        this.scene.remove(entry.group);
      }
      this.customers.clear();
      return;
    }

    const activeIds = new Set<string>();

    for (const [id, data] of Object.entries(serverCustomers)) {
      activeIds.add(id);

      let entry = this.customers.get(id);
      if (!entry) {
        entry = this.buildCustomerMesh(id, !!data.isShoplifter);
        this.customers.set(id, entry);
        this.scene.add(entry.group);
        entry.group.position.set(data.position.x, data.position.y, data.position.z);
        entry.group.rotation.y = data.rotationY;
      }

      entry.targetPos.set(data.position.x, data.position.y, data.position.z);
      entry.targetRotY = data.rotationY;

      if (data.isKnockedOut) {
        entry.group.rotation.x = -Math.PI / 2;
        entry.group.position.y = 0.15;
      } else {
        entry.group.rotation.x = 0;
      }

      if (entry.currentProductId !== data.heldProductId) {
        entry.currentProductId = data.heldProductId;
        this.updateHeldProduct(entry, data.heldProductId);
      }

      this.updateNameTag(entry, data.state, !!data.isShoplifter, !!data.isKnockedOut);
    }

    for (const [id, entry] of this.customers) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.group);
        this.customers.delete(id);
      }
    }
  }

  public update(dt: number): void {
    const lerpRate = Math.min(1, 14 * dt);

    for (const entry of this.customers.values()) {
      const prevPos = entry.group.position.clone();
      entry.group.position.lerp(entry.targetPos, lerpRate);

      let diff = entry.targetRotY - entry.group.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      entry.group.rotation.y += diff * lerpRate;

      const distMoved = entry.group.position.distanceTo(prevPos);
      if (distMoved > 0.002) {
        entry.walkCycleTime += dt * 10;
        const swing = Math.sin(entry.walkCycleTime) * 0.45;
        entry.leftLeg.rotation.x = swing;
        entry.rightLeg.rotation.x = -swing;
      } else {
        entry.leftLeg.rotation.x *= 0.8;
        entry.rightLeg.rotation.x *= 0.8;
      }
    }
  }

  private buildCustomerMesh(id: string, isShoplifter: boolean = false): CustomerRenderEntry {
    const group = new THREE.Group();

    const shirtColors = [0x10b981, 0x06b6d4, 0xf59e0b, 0xec4899, 0x8b5cf6, 0x3b82f6];
    const shirtColor = isShoplifter ? 0x111827 : shirtColors[Math.abs(id.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % shirtColors.length];

    const torsoGeo = new THREE.BoxGeometry(0.42, 0.54, 0.26);
    const torsoMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.6 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.82;
    torso.castShadow = true;
    torso.receiveShadow = true;
    group.add(torso);

    const headGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.7 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.25;
    head.castShadow = true;
    group.add(head);

    const hairGeo = new THREE.BoxGeometry(0.30, 0.12, 0.30);
    const hairMat = new THREE.MeshStandardMaterial({ color: isShoplifter ? 0x0f172a : 0x3d2314, roughness: 0.9 });
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 1.38;
    group.add(hair);

    const legGeo = new THREE.BoxGeometry(0.14, 0.52, 0.16);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.11, 0.28, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.11, 0.28, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    const basketMesh = new THREE.Group();
    const basketBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.22, 0.24),
      new THREE.MeshStandardMaterial({ color: isShoplifter ? 0x1e293b : 0xd97706, roughness: 0.4 })
    );
    basketBox.castShadow = true;
    basketMesh.add(basketBox);
    basketMesh.position.set(0, 0.72, -0.32);
    group.add(basketMesh);

    const nameSprite = this.createCustomerSprite(isShoplifter ? '🚨 ВОР' : 'Покупатель');
    nameSprite.position.set(0, 1.75, 0);
    group.add(nameSprite);

    return {
      group,
      targetPos: new THREE.Vector3(),
      targetRotY: 0,
      nameSprite,
      basketMesh,
      heldItemMesh: null,
      currentProductId: null,
      walkCycleTime: Math.random() * Math.PI * 2,
      leftLeg,
      rightLeg,
    };
  }

  private updateHeldProduct(entry: CustomerRenderEntry, productId: string | null): void {
    if (entry.heldItemMesh) {
      entry.basketMesh.remove(entry.heldItemMesh);
      entry.heldItemMesh = null;
    }

    if (!productId) return;

    const prod = PRODUCTS[productId];
    const col = prod?.color || '#38bdf8';

    const itemGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.18, 12);
    const itemMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.4 });
    const itemMesh = new THREE.Mesh(itemGeo, itemMat);
    itemMesh.position.set(0, 0.12, 0);
    itemMesh.castShadow = true;
    entry.basketMesh.add(itemMesh);
    entry.heldItemMesh = itemMesh;
  }

  private updateNameTag(entry: CustomerRenderEntry, state: string, isShoplifter: boolean = false, isKnockedOut: boolean = false): void {
    let icon = '🛒';
    let borderColor = '#10b981';

    if (isShoplifter) {
      borderColor = '#ef4444';
      if (isKnockedOut) {
        icon = '😵 ОГЛУШЕН!';
      } else if (state === 'FLEEING') {
        icon = '🚨 ВОР УБЕГАЕТ!';
      } else {
        icon = '🚨 ВОР В ЗАЛЕ!';
      }
    } else {
      if (state === 'PAYING') icon = '💳 Оплата...';
      else if (state === 'SAD_LEAVING') { icon = '😞 Нет товара!'; borderColor = '#ef4444'; }
      else if (state === 'LEAVING') icon = '😊 Спасибо!';
      else if (state === 'BROWSING') icon = '👀 Выбирает...';
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.roundRect(8, 8, 240, 48, 10);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px "Handgeschrieben", cursive, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    (entry.nameSprite.material as THREE.SpriteMaterial).map = tex;
    (entry.nameSprite.material as THREE.SpriteMaterial).needsUpdate = true;
  }

  private createCustomerSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.roundRect(8, 8, 240, 48, 10);
    ctx.fill();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px "Handgeschrieben", cursive, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.4, 0.35, 1);
    return sprite;
  }
}
