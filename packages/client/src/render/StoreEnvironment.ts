import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
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

  private static stelajAsset: THREE.Group | null = null;
  private static loadPromise: Promise<void> | null = null;

  public static async loadAssets(): Promise<void> {
    if (this.stelajAsset) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise<void>((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        `/models/furniture/stelaj.glb?v=${Date.now()}`,
        (gltf) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat && mat.map) {
                mat.map.magFilter = THREE.NearestFilter;
                mat.map.minFilter = THREE.NearestMipmapLinearFilter;
                mat.map.needsUpdate = true;
              }
            }
          });
          StoreEnvironment.stelajAsset = gltf.scene;
          resolve();
        },
        undefined,
        (err) => {
          console.error('[StoreEnvironment] Failed to load stelaj model:', err);
          reject(err);
        }
      );
    });

    return this.loadPromise;
  }

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
      dithering: true,
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

    // 4. Electrical Breaker Panel
    this.buildElectricalBreaker();
  }

  public wallMeshes: THREE.Mesh[] = [];
  private occlusionRaycaster = new THREE.Raycaster();
  private baseWallMaterial: THREE.MeshStandardMaterial | null = null;

  /**
   * Generates a box geometry with UV coordinates scaled proportionally to world units (meters),
   * preventing stretching and maintaining consistent texture resolution across walls of any size.
   */
  private createWallGeometry(width: number, height: number, depth: number, tileSize: number = 2.5): THREE.BoxGeometry {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const uvs = geo.attributes.uv;
    const faceSizes = [
      [depth, height], // +X (right)
      [depth, height], // -X (left)
      [width, depth],  // +Y (top)
      [width, depth],  // -Y (bottom)
      [width, height], // +Z (front)
      [width, height], // -Z (back)
    ];

    for (let i = 0; i < 6; i++) {
      const [faceW, faceH] = faceSizes[i];
      const uRepeat = faceW / tileSize;
      const vRepeat = faceH / tileSize;
      const offset = i * 4;
      for (let v = 0; v < 4; v++) {
        const idx = offset + v;
        uvs.setXY(idx, uvs.getX(idx) * uRepeat, uvs.getY(idx) * vRepeat);
      }
    }
    uvs.needsUpdate = true;
    return geo;
  }

  /**
   * Creates a PBR wall material with:
   * 1. Color map (Albedo / Diffuse)
   * 2. Normal map
   * 3. Reflection / Roughness map
   */
  private createWallMaterial(): THREE.MeshStandardMaterial {
    if (!this.baseWallMaterial) {
      const textureLoader = new THREE.TextureLoader();

      // 1. Карта цвета (Albedo / Diffuse)
      const diffuseMap = textureLoader.load('/textures/walls/wall_diffuse.jpg');
      diffuseMap.wrapS = THREE.RepeatWrapping;
      diffuseMap.wrapT = THREE.RepeatWrapping;
      diffuseMap.colorSpace = THREE.SRGBColorSpace;
      diffuseMap.generateMipmaps = true;
      diffuseMap.minFilter = THREE.LinearMipmapLinearFilter;
      diffuseMap.magFilter = THREE.LinearFilter;
      diffuseMap.anisotropy = 8;

      // 2. Карта нормалей (Normal map)
      const normalMap = textureLoader.load('/textures/walls/wall_normal.jpg');
      normalMap.wrapS = THREE.RepeatWrapping;
      normalMap.wrapT = THREE.RepeatWrapping;
      normalMap.generateMipmaps = true;
      normalMap.minFilter = THREE.LinearMipmapLinearFilter;
      normalMap.magFilter = THREE.LinearFilter;
      normalMap.anisotropy = 8;

      // 3. Карта отражений / шероховатости (Roughness / Specular reflection map)
      const roughnessMap = textureLoader.load('/textures/walls/wall_roughness.jpg');
      roughnessMap.wrapS = THREE.RepeatWrapping;
      roughnessMap.wrapT = THREE.RepeatWrapping;
      roughnessMap.generateMipmaps = true;
      roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
      roughnessMap.magFilter = THREE.LinearFilter;
      roughnessMap.anisotropy = 8;

      this.baseWallMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xb8b2aa), // Приглушённый оттенок (чуть темнее на ~25-30%)
        map: diffuseMap,
        normalMap: normalMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: roughnessMap,
        roughness: 0.88,
        metalness: 0.03,
        transparent: true,
        opacity: 1.0,
        depthWrite: true,
        dithering: true,
      });

      // Shader injection: рандомизация отражений по тайлам, стохастическое устранение повторов и органика
      this.baseWallMaterial.customProgramCacheKey = () => 'wall_stochastic_pbr_v1';
      this.baseWallMaterial.onBeforeCompile = (shader) => {
        // Передаём мировые координаты вершин в пиксельный шейдер
        shader.vertexShader = `
          varying vec3 vWallWorldPos;
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          `
          vWallWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #include <project_vertex>
          `
        );

        // Математические функции шума и хеширования
        shader.fragmentShader = `
          varying vec3 vWallWorldPos;

          // 2D Hash
          float wallHash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }

          // Smooth 2D Value Noise (квинтовая интерполяция для плавных переходов между ячейками тайлов)
          float wallValueNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

            float a = wallHash21(i);
            float b = wallHash21(i + vec2(1.0, 0.0));
            float c = wallHash21(i + vec2(0.0, 1.0));
            float d = wallHash21(i + vec2(1.0, 1.0));

            return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
          }

          // Multi-octave FBM для крупных органических зон на стене
          float wallFBM(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            mat2 rot = mat2(0.877, 0.479, -0.479, 0.877);
            for (int i = 0; i < 3; ++i) {
              v += a * wallValueNoise(p);
              p = rot * p * 2.02 + vec2(17.3, 31.7);
              a *= 0.5;
            }
            return v;
          }
        ` + shader.fragmentShader;

        // 1. Модификация карты отражений / шероховатости (Roughness)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `
          float roughnessFactor = roughness;

          #ifdef USE_ROUGHNESSMAP
            // Базовая выборка из карты отражений
            vec4 texelRoughness1 = texture2D(roughnessMap, vRoughnessMapUv);

            // Вторая десинхронизированная выборка по мировым координатам, разбивающая паттерн повторения
            vec2 jitterUv = vRoughnessMapUv * 1.37 + vec2(vWallWorldPos.x + vWallWorldPos.z, vWallWorldPos.y) * 0.18 + vec2(3.14, 1.59);
            vec4 texelRoughness2 = texture2D(roughnessMap, jitterUv);

            // Случайный коэффициент отражений для каждого тайла стены (~2.5м)
            float tileNoise = wallValueNoise(vRoughnessMapUv * 0.95 + vec2(42.1, 13.7));
            // Макро-неоднородность (пятна влажности, износа, полировки)
            float macroNoise = wallFBM(vec2(vWallWorldPos.x + vWallWorldPos.z, vWallWorldPos.y) * 0.35);

            // Стохастическое смешивание выборок карты отражений
            float blendWeight = smoothstep(0.3, 0.7, macroNoise);
            float blendedRoughness = mix(texelRoughness1.g, texelRoughness2.g, blendWeight * 0.65);

            // Разброс отражений по тайлам: одни участки более глянцевые с сочными бликами, другие матовые
            float randomTileRoughness = mix(0.40, 1.30, tileNoise);

            // Глянцевые потёртости и разглаженные мастерком полосы
            float glossScuffs = smoothstep(0.68, 0.90, macroNoise) * 0.36;

            roughnessFactor = clamp(roughnessFactor * blendedRoughness * randomTileRoughness - glossScuffs, 0.16, 1.0);
          #endif
          `
        );

        // 2. Устранение однообразия цвета (разбивка повторений и лёгкие тональные переходы между тайлами)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          #ifdef USE_MAP
            vec2 jitterUvMap = vMapUv * 1.37 + vec2(vWallWorldPos.x + vWallWorldPos.z, vWallWorldPos.y) * 0.18 + vec2(3.14, 1.59);
            vec4 sampledDiffuseColor1 = texture2D(map, vMapUv);
            vec4 sampledDiffuseColor2 = texture2D(map, jitterUvMap);

            float macroNoiseMap = wallFBM(vec2(vWallWorldPos.x + vWallWorldPos.z, vWallWorldPos.y) * 0.35);
            float blendMap = smoothstep(0.35, 0.65, macroNoiseMap);
            vec4 sampledDiffuseColor = mix(sampledDiffuseColor1, sampledDiffuseColor2, blendMap * 0.4);

            #ifdef DECODE_VIDEO_TEXTURE
              sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
            #endif

            // Естественная вариация тона штукатурки между партиями/участками стены
            float tileTone = wallValueNoise(vMapUv * 0.95 + vec2(17.3, 89.2));
            sampledDiffuseColor.rgb *= (0.92 + 0.16 * tileTone);

            diffuseColor *= sampledDiffuseColor;
          #endif
          `
        );

        // 3. Органическая неровность нормалей (широкие волны ручной штукатурки стен)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          `
          #include <normal_fragment_maps>
          #if defined( USE_NORMALMAP_TANGENTSPACE )
            vec2 broadWave = vec2(
              wallValueNoise(vec2(vWallWorldPos.x + vWallWorldPos.z, vWallWorldPos.y) * 0.9 + vec2(2.4, 5.1)),
              wallValueNoise(vec2(vWallWorldPos.x + vWallWorldPos.z, vWallWorldPos.y) * 0.9 + vec2(8.7, 1.3))
            ) * 2.0 - 1.0;
            normal = normalize(normal + vec3(broadWave * 0.08, 0.0));
          #endif
          `
        );
      };
    }

    // Clone to allow independent wall occlusion fading
    return this.baseWallMaterial.clone();
  }

  private buildWalls(): void {
    const w = STORE_LAYOUT.FLOOR_WIDTH;
    const d = STORE_LAYOUT.FLOOR_DEPTH;
    const h = STORE_LAYOUT.WALL_HEIGHT;

    // Back wall (-Z)
    const backWall = new THREE.Mesh(this.createWallGeometry(w, h, 0.4), this.createWallMaterial());
    backWall.position.set(0, h / 2, -d / 2 - 0.2);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    // Left wall (-X)
    const leftWall = new THREE.Mesh(this.createWallGeometry(0.4, h, d), this.createWallMaterial());
    leftWall.position.set(-w / 2 - 0.2, h / 2, 0);
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    // Right wall (+X)
    const rightWall = new THREE.Mesh(this.createWallGeometry(0.4, h, d), this.createWallMaterial());
    rightWall.position.set(w / 2 + 0.2, h / 2, 0);
    rightWall.receiveShadow = true;
    this.scene.add(rightWall);
    this.wallMeshes.push(rightWall);

    // Front Wall (+Z) with wide entrance glass/opening
    const frontWallLeft = new THREE.Mesh(this.createWallGeometry((w - 8) / 2, h, 0.4), this.createWallMaterial());
    frontWallLeft.position.set(-w / 4 - 2, h / 2, d / 2 + 0.2);
    frontWallLeft.receiveShadow = true;
    this.scene.add(frontWallLeft);
    this.wallMeshes.push(frontWallLeft);

    const frontWallRight = new THREE.Mesh(this.createWallGeometry((w - 8) / 2, h, 0.4), this.createWallMaterial());
    frontWallRight.position.set(w / 4 + 2, h / 2, d / 2 + 0.2);
    frontWallRight.receiveShadow = true;
    this.scene.add(frontWallRight);
    this.wallMeshes.push(frontWallRight);
  }

  private breakerLedMaterial?: THREE.MeshBasicMaterial;
  private breakerElapsed: number = 0;

  private buildElectricalBreaker(): void {
    const breakerGroup = new THREE.Group();
    // Mounted on warehouse back wall (X = -8.0, Y = 1.6, Z = -9.8)
    breakerGroup.position.set(-8.0, 1.6, -9.8);

    // 1. Steel cabinet body
    const cabinetMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.4,
      metalness: 0.8,
    });
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.95, 0.18), cabinetMat);
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    breakerGroup.add(cabinet);

    // 2. Hazard warning door
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.5,
      metalness: 0.2,
    });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.02), doorMat);
    door.position.z = 0.095;
    breakerGroup.add(door);

    // 3. Lightning bolt sign canvas
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 76px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', 64, 64);

    const signTex = new THREE.CanvasTexture(canvas);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), signMat);
    signMesh.position.z = 0.11;
    breakerGroup.add(signMesh);

    // 4. Status LED
    this.breakerLedMaterial = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), this.breakerLedMaterial);
    ledMesh.position.set(0, 0.35, 0.11);
    breakerGroup.add(ledMesh);

    this.scene.add(breakerGroup);
  }

  public updateBreaker(isBlackout: boolean, progress: number, dt: number): void {
    if (!this.breakerLedMaterial) return;
    this.breakerElapsed += dt;

    if (isBlackout) {
      if (progress >= 100) {
        this.breakerLedMaterial.color.setHex(0x10b981); // Solid green when fixed
      } else {
        // Blinking amber/red emergency warning
        const blink = Math.sin(this.breakerElapsed * 8.0) > 0;
        this.breakerLedMaterial.color.setHex(blink ? 0xef4444 : 0xf59e0b);
      }
    } else {
      this.breakerLedMaterial.color.setHex(0x10b981); // Normal green
    }
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
    this.occlusionRaycaster.far = Math.max(0.5, distToPlayer - 0.2);

    const hits = this.occlusionRaycaster.intersectObjects(this.wallMeshes, false);
    const occludingSet = new Set<THREE.Object3D>();

    for (const hit of hits) {
      // Only fade if the player is within 4.5m of the occluding wall
      if (hit.point.distanceTo(target) < 4.5) {
        occludingSet.add(hit.object);
      }
    }

    for (const wall of this.wallMeshes) {
      const mat = wall.material as THREE.MeshStandardMaterial;
      // "слегка пропадала": slightly fade to 0.55 opacity, maintaining visibility and solid appearance
      const targetOpacity = occludingSet.has(wall) ? 0.55 : 1.0;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, Math.min(1.0, 8.0 * dt));
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

    if (StoreEnvironment.stelajAsset) {
      const shelfModel = SkeletonUtils.clone(StoreEnvironment.stelajAsset);
      // Rotate by Math.PI around Y so front faces +Z
      shelfModel.rotation.y = Math.PI;
      // Scale to fit SHELF_CONFIG (width 2.2, height 2.14, depth 0.65)
      shelfModel.scale.set(1.18, 0.56, 0.62);
      shelfModel.position.set(0, 0, 0.05);

      shelfModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      group.add(shelfModel);
    } else {
      const metalMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        metalness: 0.8,
        roughness: 0.3,
      });
      const backGeo = new THREE.BoxGeometry(SHELF_CONFIG.WIDTH, SHELF_CONFIG.HEIGHT, 0.04);
      const back = new THREE.Mesh(backGeo, metalMat);
      back.position.set(0, SHELF_CONFIG.HEIGHT / 2, -SHELF_CONFIG.DEPTH / 2 + 0.02);
      back.castShadow = true;
      back.receiveShadow = true;
      group.add(back);
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
