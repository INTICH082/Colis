import * as THREE from 'three';
import { PlayerState, PRODUCTS } from '@colis/shared';

export class PlayerEntity {
  public id: string;
  public group: THREE.Group;
  private bodyMesh!: THREE.Mesh;
  private headMesh!: THREE.Mesh;
  private nameSprite!: THREE.Sprite;
  private heldBoxMesh!: THREE.Group;
  private heldBoxFlaps: THREE.Mesh[] = [];
  private heldBoxItemsGroup!: THREE.Group;

  private targetPosition: THREE.Vector3 = new THREE.Vector3();
  private targetRotationY: number = 0;
  private walkCycle: number = 0;

  constructor(state: PlayerState, isLocal: boolean) {
    this.id = state.id;
    this.group = new THREE.Group();
    this.group.position.set(state.position.x, state.position.y, state.position.z);
    this.group.rotation.y = state.rotationY;
    this.targetPosition.copy(this.group.position);

    // Build stylized store employee model
    const playerColor = new THREE.Color(state.color || '#3b82f6');

    // 1. Torso (Uniform Vest)
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.24, 0.75, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: playerColor,
      roughness: 0.5,
      metalness: 0.1,
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bodyMesh.position.y = 0.85;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.group.add(this.bodyMesh);

    // 2. Head
    const headGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xffdfba,
      roughness: 0.6,
    });
    this.headMesh = new THREE.Mesh(headGeo, skinMat);
    this.headMesh.position.y = 1.45;
    this.headMesh.castShadow = true;
    this.group.add(this.headMesh);

    // Employee cap / visor
    const capGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16);
    const capMat = new THREE.MeshStandardMaterial({ color: playerColor });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 1.6;
    this.group.add(cap);

    // Visor brim pointing forward (-Z)
    const brimGeo = new THREE.BoxGeometry(0.24, 0.02, 0.15);
    const brim = new THREE.Mesh(brimGeo, capMat);
    brim.position.set(0, 1.58, -0.22);
    this.group.add(brim);

    // 3. Hands / Held item anchor
    this.heldBoxMesh = this.buildHeldBox();
    this.heldBoxMesh.position.set(0, 0.95, -0.6);
    this.heldBoxMesh.visible = false;
    this.group.add(this.heldBoxMesh);

    // 4. Name Tag Billboard Sprite
    this.nameSprite = this.createNameSprite(state.name, state.color, isLocal);
    this.nameSprite.position.set(0, 2.0, 0);
    this.group.add(this.nameSprite);
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
    ctx.font = 'bold 22px Inter, sans-serif';
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

    // Cardboard texture / material
    const cardboardMat = new THREE.MeshStandardMaterial({
      color: 0xcd853f,
      roughness: 0.85,
    });

    const boxW = 0.45;
    const boxH = 0.32;
    const boxD = 0.35;

    // Box body
    const body = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, boxD), cardboardMat);
    body.castShadow = true;
    body.receiveShadow = true;
    boxGroup.add(body);

    // Group for preview of goods inside
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

  public tickInterpolation(dt: number, isLocal: boolean): void {
    if (!isLocal) {
      // Smooth lerp for remote players
      this.group.position.lerp(this.targetPosition, 15 * dt);

      // Slerp angle
      let diff = this.targetRotationY - this.group.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.group.rotation.y += diff * 15 * dt;
    }

    // Walking bob animation
    const isMoving = isLocal
      ? false
      : this.group.position.distanceTo(this.targetPosition) > 0.05;

    if (isMoving) {
      this.walkCycle += dt * 10;
      this.bodyMesh.position.y = 0.85 + Math.sin(this.walkCycle * 2) * 0.04;
      this.headMesh.position.y = 1.45 + Math.sin(this.walkCycle * 2) * 0.03;
    } else {
      this.bodyMesh.position.y = 0.85;
      this.headMesh.position.y = 1.45;
    }
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
