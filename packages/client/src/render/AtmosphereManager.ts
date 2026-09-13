import * as THREE from 'three';

export class AtmosphereManager {
  private scene: THREE.Scene;
  private skyMesh!: THREE.Mesh;
  private oceanMesh!: THREE.Mesh;
  private pierGroup!: THREE.Group;

  private skyMaterial!: THREE.ShaderMaterial;
  private oceanMaterial!: THREE.ShaderMaterial;

  private sunDirection: THREE.Vector3 = new THREE.Vector3(15, 25, 12).normalize();
  private elapsedTime: number = 0;

  constructor(scene: THREE.Scene, sunLight?: THREE.DirectionalLight) {
    this.scene = scene;
    if (sunLight) {
      this.sunDirection.copy(sunLight.position).normalize();
    }

    this.createSky();
    this.createOcean();
    this.createPierFoundation();
  }

  private createSky(): void {
    const skyGeo = new THREE.SphereGeometry(900, 32, 24);

    this.skyMaterial = new THREE.ShaderMaterial({
      name: 'OptimizedProceduralSky',
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: this.sunDirection.clone() },
        uTime: { value: 0 },
        uZenithColor: { value: new THREE.Color(0x196eb8) }, // Rich azure zenith
        uMidColor: { value: new THREE.Color(0x56a5eb) },    // Pleasant sky blue
        uHorizonColor: { value: new THREE.Color(0xcde3f5) },// Atmospheric haze
        uSunColor: { value: new THREE.Color(0xfff6dd) },    // Warm solar color
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uTime;
        uniform vec3 uZenithColor;
        uniform vec3 uMidColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunColor;

        varying vec3 vWorldPosition;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float height = dir.y;

          // Atmospheric vertical gradient
          vec3 skyColor;
          if (height > 0.0) {
            float h = clamp(height * 2.2, 0.0, 1.0);
            skyColor = mix(uHorizonColor, mix(uMidColor, uZenithColor, h), h);
          } else {
            // Below horizon haze
            skyColor = mix(uHorizonColor, vec3(0.58, 0.76, 0.88), clamp(-height * 4.0, 0.0, 1.0));
          }

          // Directional Sun Disk & Corona Glow
          float cosTheta = dot(dir, normalize(uSunDir));
          if (cosTheta > 0.0) {
            // Crisp sun disk
            float sunDisk = smoothstep(0.9982, 0.9997, cosTheta);
            // Solar corona & atmospheric bloom
            float corona = pow(cosTheta, 16.0) * 0.42 + pow(cosTheta, 64.0) * 0.35;
            skyColor += uSunColor * (sunDisk * 1.8 + corona);
          }

          // Subtle procedural cloud wisps
          if (height > 0.05) {
            vec2 skyUV = dir.xz / (height + 0.28) * 0.06 + vec2(uTime * 0.002, uTime * 0.0015);
            float n1 = sin(skyUV.x * 6.0 + sin(skyUV.y * 5.0)) * 0.5 + 0.5;
            float n2 = cos(skyUV.y * 8.0 + cos(skyUV.x * 7.0)) * 0.5 + 0.5;
            float cloud = smoothstep(0.68, 0.92, (n1 + n2) * 0.5) * clamp(height * 1.5, 0.0, 0.6);
            skyColor = mix(skyColor, vec3(1.0, 1.0, 1.0), cloud * 0.35);
          }

          gl_FragColor = vec4(skyColor, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.renderOrder = -1000;
    this.scene.add(this.skyMesh);
  }

  private createOcean(): void {
    // 1600m x 1600m ocean plane with 128x128 segments for smooth wave displacement
    const oceanGeo = new THREE.PlaneGeometry(1600, 1600, 128, 128);
    oceanGeo.rotateX(-Math.PI / 2);

    this.oceanMaterial = new THREE.ShaderMaterial({
      name: 'OptimizedGerstnerOcean',
      transparent: true,
      fog: true,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uTime: { value: 0 },
        uSunDir: { value: this.sunDirection.clone() },
        uCameraPos: { value: new THREE.Vector3(0, 10, 10) },
        uDeepColor: { value: new THREE.Color(0x023047) },     // Deep navy blue
        uShallowColor: { value: new THREE.Color(0x0891b2) },  // Coastal turquoise
        uFoamColor: { value: new THREE.Color(0xf1f8fe) },     // Crisp white ocean foam
        uHorizonColor: { value: new THREE.Color(0xcde3f5) },  // Matches sky horizon
      },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>

        uniform float uTime;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vWaveHeight;

        // Gerstner Wave Calculation
        struct Wave {
          vec2 dir;
          float amplitude;
          float wavelength;
          float speed;
        };

        void main() {
          vec3 pos = position;

          // 3 Harmonized Trochoidal Gerstner Waves
          Wave w1 = Wave(normalize(vec2(1.0, 0.7)), 0.16, 18.0, 1.3);
          Wave w2 = Wave(normalize(vec2(-0.7, 0.8)), 0.10, 10.0, 1.8);
          Wave w3 = Wave(normalize(vec2(0.4, -0.9)), 0.05, 4.5, 2.6);

          float totalDispY = 0.0;
          vec3 normal = vec3(0.0, 1.0, 0.0);

          // Wave 1
          float k1 = 2.0 * 3.14159 / w1.wavelength;
          float phase1 = k1 * dot(w1.dir, pos.xz) - uTime * w1.speed;
          totalDispY += w1.amplitude * sin(phase1);
          normal.x -= w1.dir.x * k1 * w1.amplitude * cos(phase1);
          normal.z -= w1.dir.y * k1 * w1.amplitude * cos(phase1);

          // Wave 2
          float k2 = 2.0 * 3.14159 / w2.wavelength;
          float phase2 = k2 * dot(w2.dir, pos.xz) - uTime * w2.speed;
          totalDispY += w2.amplitude * sin(phase2);
          normal.x -= w2.dir.x * k2 * w2.amplitude * cos(phase2);
          normal.z -= w2.dir.y * k2 * w2.amplitude * cos(phase2);

          // Wave 3 (High-frequency surface chop)
          float k3 = 2.0 * 3.14159 / w3.wavelength;
          float phase3 = k3 * dot(w3.dir, pos.xz) - uTime * w3.speed;
          totalDispY += w3.amplitude * sin(phase3);
          normal.x -= w3.dir.x * k3 * w3.amplitude * cos(phase3);
          normal.z -= w3.dir.y * k3 * w3.amplitude * cos(phase3);

          pos.y += totalDispY;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPosition = worldPos.xyz;
          vNormal = normalize(normalMatrix * normal);
          vWaveHeight = totalDispY;

          gl_Position = projectionMatrix * viewMatrix * worldPos;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>

        uniform vec3 uSunDir;
        uniform vec3 uCameraPos;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;
        uniform vec3 uHorizonColor;
        uniform float uTime;

        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vWaveHeight;

        void main() {
          vec3 viewDir = normalize(uCameraPos - vWorldPosition);
          vec3 norm = normalize(vNormal);

          // Fresnel reflectance: grazing angles mirror the sky, direct angles reveal crystal turquoise depth
          float NdotV = max(0.0, dot(norm, viewDir));
          float fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 4.0);

          // Sun Specular Highlight (Blinn-Phong)
          vec3 sunDir = normalize(uSunDir);
          vec3 halfDir = normalize(viewDir + sunDir);
          float NdotH = max(0.0, dot(norm, halfDir));
          float specular = pow(NdotH, 64.0) * 1.6;

          // Water body gradient based on wave height and view
          float depthFactor = clamp(vWaveHeight * 2.2 + 0.45, 0.0, 1.0);
          vec3 waterColor = mix(uDeepColor, uShallowColor, depthFactor);

          // Sky reflection via Fresnel
          waterColor = mix(waterColor, uHorizonColor, fresnel * 0.78);

          // Wave crest foam
          float crestFoam = smoothstep(0.18, 0.28, vWaveHeight);
          waterColor = mix(waterColor, uFoamColor, crestFoam * 0.65);

          // Shoreline foam against the concrete supermarket pier
          // Pier boundaries: X in [-15.5, 15.5], Z in [-12.5, 14.5]
          float dx = max(0.0, abs(vWorldPosition.x) - 15.2);
          float dz = max(0.0, abs(vWorldPosition.z - 0.8) - 13.2);
          float distToPier = length(vec2(dx, dz));

          if (distToPier < 1.6) {
            float shoreWave = sin(uTime * 3.2 - distToPier * 4.5) * 0.5 + 0.5;
            float shoreFoam = smoothstep(1.6, 0.05, distToPier) * (0.6 + 0.4 * shoreWave);
            waterColor = mix(waterColor, uFoamColor, shoreFoam * 0.75);
          }

          // Add crisp solar glint
          waterColor += vec3(1.0, 0.96, 0.86) * specular;

          gl_FragColor = vec4(waterColor, 0.95);
          #include <fog_fragment>
        }
      `,
    });

    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMaterial);
    // Water level sits naturally at y = -0.85 (below pier surface at y = 0.0)
    this.oceanMesh.position.set(0, -0.85, 0);
    this.oceanMesh.receiveShadow = true;
    this.scene.add(this.oceanMesh);
  }

  private createPierFoundation(): void {
    this.pierGroup = new THREE.Group();
    this.pierGroup.name = 'PierFoundation';

    // Materials
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x475569, // Slate concrete
      roughness: 0.85,
      metalness: 0.08,
    });

    const dockWoodMat = new THREE.MeshStandardMaterial({
      color: 0x785338, // Warm marine timber
      roughness: 0.75,
      metalness: 0.05,
    });

    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // Dark seawall edge
      roughness: 0.7,
    });

    const pilingMat = new THREE.MeshStandardMaterial({
      color: 0x3e2723, // Weathered wood pilings
      roughness: 0.9,
    });

    // 1. Main concrete foundation slab underneath supermarket (24x20m store -> 30x26m pier)
    // Extends from Y = -1.5m to 0.0m
    const pierWidth = 30.5;
    const pierDepth = 26.5;
    const pierHeight = 1.5;
    const slabGeo = new THREE.BoxGeometry(pierWidth, pierHeight, pierDepth);
    const slabMesh = new THREE.Mesh(slabGeo, concreteMat);
    slabMesh.position.set(0, -pierHeight / 2, 0.8);
    slabMesh.receiveShadow = true;
    this.pierGroup.add(slabMesh);

    // 2. Concrete seawall curb along back and sides (keeps deliveries and players safe)
    const curbHeight = 0.45;
    const curbWidth = 0.4;

    // Back curb (-Z)
    const backCurbGeo = new THREE.BoxGeometry(pierWidth, curbHeight, curbWidth);
    const backCurb = new THREE.Mesh(backCurbGeo, curbMat);
    backCurb.position.set(0, curbHeight / 2, -pierDepth / 2 + 0.8 + curbWidth / 2);
    backCurb.castShadow = true;
    backCurb.receiveShadow = true;
    this.pierGroup.add(backCurb);

    // Left curb (-X)
    const sideCurbGeo = new THREE.BoxGeometry(curbWidth, curbHeight, pierDepth);
    const leftCurb = new THREE.Mesh(sideCurbGeo, curbMat);
    leftCurb.position.set(-pierWidth / 2 + curbWidth / 2, curbHeight / 2, 0.8);
    leftCurb.castShadow = true;
    leftCurb.receiveShadow = true;
    this.pierGroup.add(leftCurb);

    // Right curb (+X)
    const rightCurb = new THREE.Mesh(sideCurbGeo, curbMat);
    rightCurb.position.set(pierWidth / 2 - curbWidth / 2, curbHeight / 2, 0.8);
    rightCurb.castShadow = true;
    rightCurb.receiveShadow = true;
    this.pierGroup.add(rightCurb);

    // 3. Wooden seaside promenade / entrance dock terrace in front (+Z)
    const terraceWidth = 14.0;
    const terraceDepth = 4.2;
    const terraceGeo = new THREE.BoxGeometry(terraceWidth, 0.12, terraceDepth);
    const terraceMesh = new THREE.Mesh(terraceGeo, dockWoodMat);
    terraceMesh.position.set(0, 0.05, 12.2);
    terraceMesh.receiveShadow = true;
    this.pierGroup.add(terraceMesh);

    // 4. Heavy marine wooden pilings around perimeter into the water
    const pilingGeo = new THREE.CylinderGeometry(0.22, 0.24, 2.6, 12);
    const pilingPositions: [number, number][] = [
      // Front terrace pilings
      [-6.8, 14.1], [-2.3, 14.1], [2.3, 14.1], [6.8, 14.1],
      // Side pilings
      [-pierWidth / 2 - 0.15, -10], [-pierWidth / 2 - 0.15, 0], [-pierWidth / 2 - 0.15, 10],
      [pierWidth / 2 + 0.15, -10], [pierWidth / 2 + 0.15, 0], [pierWidth / 2 + 0.15, 10],
      // Back pilings
      [-10, -pierDepth / 2 + 0.6], [0, -pierDepth / 2 + 0.6], [10, -pierDepth / 2 + 0.6],
    ];

    for (const [px, pz] of pilingPositions) {
      const piling = new THREE.Mesh(pilingGeo, pilingMat);
      piling.position.set(px, -0.6, pz);
      piling.castShadow = true;
      piling.receiveShadow = true;
      this.pierGroup.add(piling);
    }

    this.scene.add(this.pierGroup);
  }

  public update(dt: number, cameraPos: THREE.Vector3): void {
    this.elapsedTime += dt;

    // Update shader uniforms
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uTime.value = this.elapsedTime;
      // Sky dome follows camera to maintain infinite horizon effect
      this.skyMesh.position.copy(cameraPos);
    }

    if (this.oceanMaterial) {
      this.oceanMaterial.uniforms.uTime.value = this.elapsedTime;
      this.oceanMaterial.uniforms.uCameraPos.value.copy(cameraPos);
    }
  }
}
