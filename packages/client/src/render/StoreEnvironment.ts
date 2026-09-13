import * as THREE from 'three';
import { SHELF_CONFIG, STORE_LAYOUT, ShelfState } from '@colis/shared';

export interface SlotMeshInfo {
  shelfId: string;
  slotIndex: number;
  mesh: THREE.Mesh;
}

export class StoreEnvironment {
  private scene: THREE.Scene;
  public slotHitboxes: SlotMeshInfo[] = [];
  public shelfMeshes: Map<string, THREE.Group> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildSupermarketRoom();
  }

  private buildSupermarketRoom(): void {
    // 1. Floor
    const floorGeo = new THREE.PlaneGeometry(STORE_LAYOUT.FLOOR_WIDTH, STORE_LAYOUT.FLOOR_DEPTH);
    floorGeo.rotateX(-Math.PI / 2);

    // Load high-resolution PBR floor textures
    const textureLoader = new THREE.TextureLoader();
    const repeatX = 6;
    const repeatY = 5;

    const diffuseMap = textureLoader.load('/textures/floor/floor_diffuse.png');
    diffuseMap.wrapS = THREE.RepeatWrapping;
    diffuseMap.wrapT = THREE.RepeatWrapping;
    diffuseMap.repeat.set(repeatX, repeatY);
    diffuseMap.colorSpace = THREE.SRGBColorSpace;
    diffuseMap.generateMipmaps = true;
    diffuseMap.minFilter = THREE.LinearMipmapLinearFilter;
    diffuseMap.magFilter = THREE.LinearFilter;
    diffuseMap.anisotropy = 8;

    const normalMap = textureLoader.load('/textures/floor/floor_normal.jpg');
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(repeatX, repeatY);
    normalMap.generateMipmaps = true;
    normalMap.minFilter = THREE.LinearMipmapLinearFilter;
    normalMap.magFilter = THREE.LinearFilter;
    normalMap.anisotropy = 8;

    const roughnessMap = textureLoader.load('/textures/floor/floor_roughness.png');
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.repeat.set(repeatX, repeatY);
    roughnessMap.generateMipmaps = true;
    roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
    roughnessMap.magFilter = THREE.LinearFilter;
    roughnessMap.anisotropy = 8;

    const floorMat = new THREE.MeshStandardMaterial({
      map: diffuseMap,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: roughnessMap,
      roughness: 0.42,
      metalness: 0.03,
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    floor.position.y = 0.001; // Slightly above foundation to prevent Z-fighting
    floor.name = 'floor';
    this.scene.add(floor);

    // 2. Delivery Zone Ground Decal
    const zoneW = STORE_LAYOUT.DELIVERY_ZONE.maxX - STORE_LAYOUT.DELIVERY_ZONE.minX;
    const zoneD = STORE_LAYOUT.DELIVERY_ZONE.maxZ - STORE_LAYOUT.DELIVERY_ZONE.minZ;
    const zoneGeo = new THREE.PlaneGeometry(zoneW, zoneD);
    zoneGeo.rotateX(-Math.PI / 2);
    const zoneMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    });
    const zoneMesh = new THREE.Mesh(zoneGeo, zoneMat);
    zoneMesh.position.set(
      (STORE_LAYOUT.DELIVERY_ZONE.minX + STORE_LAYOUT.DELIVERY_ZONE.maxX) / 2,
      0.015,
      (STORE_LAYOUT.DELIVERY_ZONE.minZ + STORE_LAYOUT.DELIVERY_ZONE.maxZ) / 2
    );
    this.scene.add(zoneMesh);

    // Border line for delivery zone
    const borderGeo = new THREE.EdgesGeometry(zoneGeo);
    const borderMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 });
    const borderLine = new THREE.LineSegments(borderGeo, borderMat);
    borderLine.position.copy(zoneMesh.position);
    borderLine.position.y += 0.005;
    this.scene.add(borderLine);

    // 3. Walls
    this.buildWalls();
  }

  public wallMeshes: THREE.Mesh[] = [];
  private occlusionRaycaster = new THREE.Raycaster();

  private createWallMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.8,
      transparent: true,
      opacity: 1.0,
    });
  }

  private buildWalls(): void {
    const w = STORE_LAYOUT.FLOOR_WIDTH;
    const d = STORE_LAYOUT.FLOOR_DEPTH;
    const h = STORE_LAYOUT.WALL_HEIGHT;

    // Back wall (-Z)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), this.createWallMaterial());
    backWall.position.set(0, h / 2, -d / 2 - 0.2);
    backWall.receiveShadow = true;
    this.scene.add(backWall);
    this.wallMeshes.push(backWall);

    // Left wall (-X)
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, d), this.createWallMaterial());
    leftWall.position.set(-w / 2 - 0.2, h / 2, 0);
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);
    this.wallMeshes.push(leftWall);

    // Right wall (+X)
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, d), this.createWallMaterial());
    rightWall.position.set(w / 2 + 0.2, h / 2, 0);
    rightWall.receiveShadow = true;
    this.scene.add(rightWall);
    this.wallMeshes.push(rightWall);

    // Front Wall (+Z) with wide entrance glass/opening
    const frontWallLeft = new THREE.Mesh(new THREE.BoxGeometry((w - 8) / 2, h, 0.4), this.createWallMaterial());
    frontWallLeft.position.set(-w / 4 - 2, h / 2, d / 2 + 0.2);
    frontWallLeft.receiveShadow = true;
    this.scene.add(frontWallLeft);
    this.wallMeshes.push(frontWallLeft);

    const frontWallRight = new THREE.Mesh(new THREE.BoxGeometry((w - 8) / 2, h, 0.4), this.createWallMaterial());
    frontWallRight.position.set(w / 4 + 2, h / 2, d / 2 + 0.2);
    frontWallRight.receiveShadow = true;
    this.scene.add(frontWallRight);
    this.wallMeshes.push(frontWallRight);
  }

  /**
   * Smoothly fades walls that occlude the player from the camera's point of view
   */
  public updateWallOcclusion(cameraPos: THREE.Vector3, playerPos: THREE.Vector3, dt: number): void {
    const target = new THREE.Vector3(playerPos.x, playerPos.y + 0.9, playerPos.z);
    const dir = new THREE.Vector3().subVectors(target, cameraPos);
    const distToPlayer = dir.length();
    dir.normalize();

    this.occlusionRaycaster.set(cameraPos, dir);
    this.occlusionRaycaster.near = 0.5;
    this.occlusionRaycaster.far = Math.max(0.5, distToPlayer - 0.3);

    const hits = this.occlusionRaycaster.intersectObjects(this.wallMeshes, false);
    const occludingSet = new Set(hits.map((h) => h.object));

    for (const wall of this.wallMeshes) {
      const mat = wall.material as THREE.MeshStandardMaterial;
      const targetOpacity = occludingSet.has(wall) ? 0.22 : 1.0;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, Math.min(1.0, 10.0 * dt));
      mat.depthWrite = mat.opacity > 0.85;
    }
  }


  /**
   * Builds or updates shelves in the 3D scene from server state.
   */
  public syncShelves(shelves: Record<string, ShelfState>): void {
    for (const [id, shelf] of Object.entries(shelves)) {
      if (!this.shelfMeshes.has(id)) {
        const shelfGroup = this.buildShelfMesh(shelf);
        this.shelfMeshes.set(id, shelfGroup);
        this.scene.add(shelfGroup);
      }
    }
  }

  private buildShelfMesh(shelf: ShelfState): THREE.Group {
    const group = new THREE.Group();
    group.position.set(shelf.position.x, shelf.position.y, shelf.position.z);
    group.rotation.y = shelf.rotationY;

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.8,
      roughness: 0.3,
    });

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.5,
      roughness: 0.4,
    });

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.2,
      roughness: 0.5,
    });

    // 1. Back panel
    const backGeo = new THREE.BoxGeometry(SHELF_CONFIG.WIDTH, SHELF_CONFIG.HEIGHT, 0.04);
    const back = new THREE.Mesh(backGeo, metalMat);
    back.position.set(0, SHELF_CONFIG.HEIGHT / 2, -SHELF_CONFIG.DEPTH / 2 + 0.02);
    back.castShadow = true;
    back.receiveShadow = true;
    group.add(back);

    // 2. Upright vertical side pillars
    const pillarGeo = new THREE.BoxGeometry(0.06, SHELF_CONFIG.HEIGHT, SHELF_CONFIG.DEPTH);
    const leftPillar = new THREE.Mesh(pillarGeo, metalMat);
    leftPillar.position.set(-SHELF_CONFIG.WIDTH / 2 + 0.03, SHELF_CONFIG.HEIGHT / 2, 0);
    leftPillar.castShadow = true;
    group.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, metalMat);
    rightPillar.position.set(SHELF_CONFIG.WIDTH / 2 - 0.03, SHELF_CONFIG.HEIGHT / 2, 0);
    rightPillar.castShadow = true;
    group.add(rightPillar);

    // 3. Tiers (horizontal plates)
    for (let t = 0; t < SHELF_CONFIG.TIERS; t++) {
      const tierY = SHELF_CONFIG.TIER_Y_OFFSETS[t];

      // Shelf plate
      const tierPlateGeo = new THREE.BoxGeometry(SHELF_CONFIG.WIDTH - 0.06, 0.03, SHELF_CONFIG.DEPTH - 0.02);
      const tierPlate = new THREE.Mesh(tierPlateGeo, plateMat);
      tierPlate.position.set(0, tierY, 0);
      tierPlate.castShadow = true;
      tierPlate.receiveShadow = true;
      group.add(tierPlate);

      // Price rail along front
      const railGeo = new THREE.BoxGeometry(SHELF_CONFIG.WIDTH - 0.06, 0.04, 0.02);
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(0, tierY + 0.02, SHELF_CONFIG.DEPTH / 2 - 0.01);
      group.add(rail);
    }

    // 4. Invisible Slot Hitboxes for Raycasting interactions
    const slotW = SHELF_CONFIG.WIDTH / SHELF_CONFIG.SLOTS_PER_TIER;
    for (const slot of shelf.slots) {
      const slotBoxGeo = new THREE.BoxGeometry(slotW * 0.9, 0.35, SHELF_CONFIG.DEPTH * 0.85);
      const slotMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.0, // invisible until hovered
      });
      const slotMesh = new THREE.Mesh(slotBoxGeo, slotMat);
      slotMesh.position.set(slot.localOffset.x, slot.localOffset.y + 0.18, slot.localOffset.z);
      slotMesh.userData = {
        type: 'shelf_slot',
        shelfId: shelf.id,
        slotIndex: slot.index,
      };

      group.add(slotMesh);
      this.slotHitboxes.push({
        shelfId: shelf.id,
        slotIndex: slot.index,
        mesh: slotMesh,
      });
    }

    return group;
  }
}
