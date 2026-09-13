import * as THREE from 'three';

export class AtmosphereManager {
  private scene: THREE.Scene;
  private skyMesh!: THREE.Mesh;
  private oceanMesh!: THREE.Mesh;
  private pierGroup!: THREE.Group;

  private skyMaterial!: THREE.ShaderMaterial;
  private oceanMaterial!: THREE.ShaderMaterial;

  public dirLight?: THREE.DirectionalLight;
  public ambientLight?: THREE.AmbientLight;

  // Day/Night cycle configuration: 240 seconds (4 minutes) for a full 24-hour cycle
  public dayCycleDuration: number = 240.0;
  // Start at 0.28 (~10:45 AM - bright morning sun)
  public timeOfDay: number = 0.28;
  private elapsedTime: number = 0;

  // Working vectors & colors to avoid GC allocations
  private currentSunDir = new THREE.Vector3();
  private currentMoonDir = new THREE.Vector3();
  private activeLightDir = new THREE.Vector3();

  // Dynamic palette colors
  private colDayZenith = new THREE.Color(0x196eb8);
  private colSunsetZenith = new THREE.Color(0x2e1065);
  private colNightZenith = new THREE.Color(0x050a14);

  private colDayMid = new THREE.Color(0x56a5eb);
  private colSunsetMid = new THREE.Color(0x9333ea);
  private colNightMid = new THREE.Color(0x0f172a);

  private colDayHorizon = new THREE.Color(0xcde3f5);
  private colSunsetHorizon = new THREE.Color(0xf97316);
  private colNightHorizon = new THREE.Color(0x1e293b);

  private colDaySun = new THREE.Color(0xfff6dd);
  private colSunsetSun = new THREE.Color(0xff6b35);
  private colMoon = new THREE.Color(0xdbeafe);

  private colDayOceanDeep = new THREE.Color(0x023047);
  private colNightOceanDeep = new THREE.Color(0x020f1c);

  private colDayOceanShallow = new THREE.Color(0x0891b2);
  private colNightOceanShallow = new THREE.Color(0x0f3b5f);

  private currentZenith = new THREE.Color();
  private currentMid = new THREE.Color();
  private currentHorizon = new THREE.Color();
  private currentSunColor = new THREE.Color();
  private currentOceanDeep = new THREE.Color();
  private currentOceanShallow = new THREE.Color();

  constructor(scene: THREE.Scene, dirLight?: THREE.DirectionalLight, ambientLight?: THREE.AmbientLight) {
    this.scene = scene;
    this.dirLight = dirLight;
    this.ambientLight = ambientLight;

    this.createSky();
    this.createOcean();
    this.createPierFoundation();
  }

  private createSky(): void {
    const skyGeo = new THREE.SphereGeometry(900, 32, 24);

    this.skyMaterial = new THREE.ShaderMaterial({
      name: 'DynamicProceduralSky',
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uTime: { value: 0 },
        uDayWeight: { value: 1.0 },
        uZenithColor: { value: this.colDayZenith.clone() },
        uMidColor: { value: this.colDayMid.clone() },
        uHorizonColor: { value: this.colDayHorizon.clone() },
        uSunColor: { value: this.colDaySun.clone() },
        uMoonColor: { value: this.colMoon.clone() },
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
        uniform vec3 uMoonDir;
        uniform float uTime;
        uniform float uDayWeight;
        uniform vec3 uZenithColor;
        uniform vec3 uMidColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunColor;
        uniform vec3 uMoonColor;

        varying vec3 vWorldPosition;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float height = dir.y;

          // Vertical atmospheric gradient
          vec3 skyColor;
          if (height > 0.0) {
            float h = clamp(height * 2.2, 0.0, 1.0);
            skyColor = mix(uHorizonColor, mix(uMidColor, uZenithColor, h), h);
          } else {
            skyColor = mix(uHorizonColor, uZenithColor * 0.7, clamp(-height * 4.0, 0.0, 1.0));
          }

          // Daytime: Sun disk & Solar corona
          float cosSun = dot(dir, normalize(uSunDir));
          if (cosSun > 0.0 && uSunDir.y > -0.15) {
            float sunDisk = smoothstep(0.9982, 0.9997, cosSun);
            float corona = pow(cosSun, 16.0) * 0.45 + pow(cosSun, 64.0) * 0.35;
            skyColor += uSunColor * (sunDisk * 2.0 + corona) * clamp(uDayWeight * 1.5, 0.0, 1.0);
          }

          // Nighttime: Moon disk & Lunar glow
          float cosMoon = dot(dir, normalize(uMoonDir));
          if (cosMoon > 0.0 && uMoonDir.y > -0.15) {
            float moonDisk = smoothstep(0.9978, 0.9995, cosMoon);
            float moonGlow = pow(cosMoon, 24.0) * 0.35;
            skyColor += uMoonColor * (moonDisk * 1.6 + moonGlow) * (1.0 - uDayWeight);
          }

          // Nighttime: Procedural Twinkling Stars
          if (uDayWeight < 0.65 && height > 0.08) {
            vec2 starSeed = floor(dir.xz / (height + 0.15) * 360.0);
            float starVal = fract(sin(dot(starSeed, vec2(12.9898, 78.233))) * 43758.5453);
            if (starVal > 0.987) {
              float twinkle = 0.65 + 0.35 * sin(uTime * 3.5 + starVal * 90.0);
              float starIntensity = (starVal - 0.987) * 90.0 * twinkle * (1.0 - uDayWeight);
              skyColor += vec3(0.92, 0.96, 1.0) * starIntensity;
            }
          }

          // Procedural cloud drift
          if (height > 0.05) {
            vec2 skyUV = dir.xz / (height + 0.28) * 0.06 + vec2(uTime * 0.002, uTime * 0.0015);
            float n1 = sin(skyUV.x * 6.0 + sin(skyUV.y * 5.0)) * 0.5 + 0.5;
            float n2 = cos(skyUV.y * 8.0 + cos(skyUV.x * 7.0)) * 0.5 + 0.5;
            float cloud = smoothstep(0.68, 0.92, (n1 + n2) * 0.5) * clamp(height * 1.5, 0.0, 0.6);
            vec3 cloudColor = mix(vec3(0.2, 0.25, 0.35), vec3(1.0, 0.98, 0.94), uDayWeight);
            skyColor = mix(skyColor, cloudColor, cloud * 0.32);
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
    const oceanGeo = new THREE.PlaneGeometry(1600, 1600, 128, 128);
    oceanGeo.rotateX(-Math.PI / 2);

    this.oceanMaterial = new THREE.ShaderMaterial({
      name: 'DynamicGerstnerOcean',
      transparent: true,
      fog: true,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uTime: { value: 0 },
        uActiveLightDir: { value: new THREE.Vector3(0, 1, 0) },
        uCameraPos: { value: new THREE.Vector3(0, 10, 10) },
        uDeepColor: { value: this.colDayOceanDeep.clone() },
        uShallowColor: { value: this.colDayOceanShallow.clone() },
        uFoamColor: { value: new THREE.Color(0xf1f8fe) },
        uHorizonColor: { value: this.colDayHorizon.clone() },
        uSpecColor: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>

        uniform float uTime;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vWaveHeight;

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

          float k1 = 2.0 * 3.14159 / w1.wavelength;
          float phase1 = k1 * dot(w1.dir, pos.xz) - uTime * w1.speed;
          totalDispY += w1.amplitude * sin(phase1);
          normal.x -= w1.dir.x * k1 * w1.amplitude * cos(phase1);
          normal.z -= w1.dir.y * k1 * w1.amplitude * cos(phase1);

          float k2 = 2.0 * 3.14159 / w2.wavelength;
          float phase2 = k2 * dot(w2.dir, pos.xz) - uTime * w2.speed;
          totalDispY += w2.amplitude * sin(phase2);
          normal.x -= w2.dir.x * k2 * w2.amplitude * cos(phase2);
          normal.z -= w2.dir.y * k2 * w2.amplitude * cos(phase2);

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

        uniform vec3 uActiveLightDir;
        uniform vec3 uCameraPos;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSpecColor;
        uniform float uTime;

        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vWaveHeight;

        void main() {
          vec3 viewDir = normalize(uCameraPos - vWorldPosition);
          vec3 norm = normalize(vNormal);

          float NdotV = max(0.0, dot(norm, viewDir));
          float fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 4.0);

          // Specular highlight from Sun or Moon
          vec3 lightDir = normalize(uActiveLightDir);
          vec3 halfDir = normalize(viewDir + lightDir);
          float NdotH = max(0.0, dot(norm, halfDir));
          float specular = pow(NdotH, 64.0) * 1.5;

          float depthFactor = clamp(vWaveHeight * 2.2 + 0.45, 0.0, 1.0);
          vec3 waterColor = mix(uDeepColor, uShallowColor, depthFactor);

          waterColor = mix(waterColor, uHorizonColor, fresnel * 0.78);

          // Crest foam
          float crestFoam = smoothstep(0.18, 0.28, vWaveHeight);
          waterColor = mix(waterColor, uFoamColor, crestFoam * 0.65);

          // Shoreline foam against supermarket concrete pier
          float dx = max(0.0, abs(vWorldPosition.x) - 15.2);
          float dz = max(0.0, abs(vWorldPosition.z - 0.8) - 13.2);
          float distToPier = length(vec2(dx, dz));

          if (distToPier < 1.6) {
            float shoreWave = sin(uTime * 3.2 - distToPier * 4.5) * 0.5 + 0.5;
            float shoreFoam = smoothstep(1.6, 0.05, distToPier) * (0.6 + 0.4 * shoreWave);
            waterColor = mix(waterColor, uFoamColor, shoreFoam * 0.75);
          }

          // Add solar/lunar specular glint
          waterColor += uSpecColor * specular;

          gl_FragColor = vec4(waterColor, 0.95);
          #include <fog_fragment>
        }
      `,
    });

    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMaterial);
    this.oceanMesh.position.set(0, -0.85, 0);
    this.oceanMesh.receiveShadow = true;
    this.scene.add(this.oceanMesh);
  }

  private createPierFoundation(): void {
    this.pierGroup = new THREE.Group();
    this.pierGroup.name = 'PierFoundation';

    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.85,
      metalness: 0.08,
    });

    const dockWoodMat = new THREE.MeshStandardMaterial({
      color: 0x785338,
      roughness: 0.75,
      metalness: 0.05,
    });

    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.7,
    });

    const pilingMat = new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.9,
    });

    // 1. Concrete foundation slab underneath supermarket
    // IMPORTANT: Top of slab is placed safely at y = -0.05 to eliminate Z-fighting with store floor
    const pierWidth = 30.5;
    const pierDepth = 26.5;
    const pierHeight = 1.5;
    const slabGeo = new THREE.BoxGeometry(pierWidth, pierHeight, pierDepth);
    const slabMesh = new THREE.Mesh(slabGeo, concreteMat);
    slabMesh.position.set(0, -pierHeight / 2 - 0.05, 0.8);
    slabMesh.receiveShadow = true;
    this.pierGroup.add(slabMesh);

    // 2. Seawall curb along back and sides
    const curbHeight = 0.45;
    const curbWidth = 0.4;

    const backCurbGeo = new THREE.BoxGeometry(pierWidth, curbHeight, curbWidth);
    const backCurb = new THREE.Mesh(backCurbGeo, curbMat);
    backCurb.position.set(0, curbHeight / 2, -pierDepth / 2 + 0.8 + curbWidth / 2);
    backCurb.castShadow = true;
    backCurb.receiveShadow = true;
    this.pierGroup.add(backCurb);

    const sideCurbGeo = new THREE.BoxGeometry(curbWidth, curbHeight, pierDepth);
    const leftCurb = new THREE.Mesh(sideCurbGeo, curbMat);
    leftCurb.position.set(-pierWidth / 2 + curbWidth / 2, curbHeight / 2, 0.8);
    leftCurb.castShadow = true;
    leftCurb.receiveShadow = true;
    this.pierGroup.add(leftCurb);

    const rightCurb = new THREE.Mesh(sideCurbGeo, curbMat);
    rightCurb.position.set(pierWidth / 2 - curbWidth / 2, curbHeight / 2, 0.8);
    rightCurb.castShadow = true;
    rightCurb.receiveShadow = true;
    this.pierGroup.add(rightCurb);

    // 3. Wooden seaside promenade in front (+Z)
    const terraceWidth = 14.0;
    const terraceDepth = 4.2;
    const terraceGeo = new THREE.BoxGeometry(terraceWidth, 0.12, terraceDepth);
    const terraceMesh = new THREE.Mesh(terraceGeo, dockWoodMat);
    terraceMesh.position.set(0, 0.02, 12.2);
    terraceMesh.receiveShadow = true;
    this.pierGroup.add(terraceMesh);

    // 4. Marine wooden pilings around perimeter
    const pilingGeo = new THREE.CylinderGeometry(0.22, 0.24, 2.6, 12);
    const pilingPositions: [number, number][] = [
      [-6.8, 14.1], [-2.3, 14.1], [2.3, 14.1], [6.8, 14.1],
      [-pierWidth / 2 - 0.15, -10], [-pierWidth / 2 - 0.15, 0], [-pierWidth / 2 - 0.15, 10],
      [pierWidth / 2 + 0.15, -10], [pierWidth / 2 + 0.15, 0], [pierWidth / 2 + 0.15, 10],
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

  /**
   * Main atmosphere & Day/Night tick
   */
  public update(dt: number, cameraPos: THREE.Vector3): void {
    this.elapsedTime += dt;

    // Advance time of day (0.0 to 1.0)
    this.timeOfDay = (this.timeOfDay + dt / this.dayCycleDuration) % 1.0;

    // Celestial arc angle:
    // 0.0 = Sunrise (East), 0.25 = Noon (High Sun), 0.50 = Sunset (West), 0.75 = Midnight (High Moon)
    const theta = 2.0 * Math.PI * this.timeOfDay - Math.PI / 2.0;

    const sunElev = Math.cos(theta); // 1.0 at noon, 0.0 at dawn/dusk, -1.0 at midnight
    const sunEastWest = Math.sin(theta);
    const sunTiltZ = 0.38 * Math.cos(theta); // subtle tilt for isometric shelf illumination

    this.currentSunDir.set(sunEastWest, sunElev, sunTiltZ).normalize();
    this.currentMoonDir.set(-sunEastWest, -sunElev, -sunTiltZ).normalize();

    // Day weight: 1.0 in full daylight, 0.0 in dead of night
    const dayWeight = THREE.MathUtils.clamp((sunElev + 0.12) / 0.35, 0.0, 1.0);
    // Sunset / Golden Hour weight: peak near horizon (sunElev ~ 0.0)
    const sunsetWeight = Math.exp(-Math.pow(sunElev / 0.18, 2.0));

    // Interpolate Sky Colors
    // Zenith
    this.currentZenith.copy(this.colNightZenith).lerp(this.colDayZenith, dayWeight);
    if (sunsetWeight > 0.05) {
      this.currentZenith.lerp(this.colSunsetZenith, sunsetWeight * 0.75);
    }

    // Mid
    this.currentMid.copy(this.colNightMid).lerp(this.colDayMid, dayWeight);
    if (sunsetWeight > 0.05) {
      this.currentMid.lerp(this.colSunsetMid, sunsetWeight * 0.75);
    }

    // Horizon
    this.currentHorizon.copy(this.colNightHorizon).lerp(this.colDayHorizon, dayWeight);
    if (sunsetWeight > 0.05) {
      this.currentHorizon.lerp(this.colSunsetHorizon, sunsetWeight * 0.95);
    }

    // Sun color
    this.currentSunColor.copy(this.colSunsetSun).lerp(this.colDaySun, THREE.MathUtils.clamp(sunElev * 2.5, 0.0, 1.0));

    // Ocean colors
    this.currentOceanDeep.copy(this.colNightOceanDeep).lerp(this.colDayOceanDeep, dayWeight);
    this.currentOceanShallow.copy(this.colNightOceanShallow).lerp(this.colDayOceanShallow, dayWeight);

    // Update Scene Fog & Background to match horizon color dynamically
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.currentHorizon);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.currentHorizon);
    }

    // Determine Active Celestial Light (Sun by day, Moon by night)
    const isDayLight = sunElev > -0.05;
    this.activeLightDir.copy(isDayLight ? this.currentSunDir : this.currentMoonDir);

    let activeLightColor: THREE.Color;
    let lightIntensity: number;
    let specColor: THREE.Color;

    if (isDayLight) {
      activeLightColor = this.currentSunColor;
      lightIntensity = 0.45 + 1.05 * THREE.MathUtils.clamp(sunElev * 2.2, 0.0, 1.0);
      specColor = this.currentSunColor;
    } else {
      activeLightColor = this.colMoon;
      lightIntensity = 0.38 + 0.15 * THREE.MathUtils.clamp(-sunElev * 1.8, 0.0, 1.0);
      specColor = this.colMoon;
    }

    // Directional Light & Dynamic Rotating Shadows
    if (this.dirLight) {
      this.dirLight.color.copy(activeLightColor);
      this.dirLight.intensity = lightIntensity;

      // Position sun light along arc centered on camera target so shadows dynamically rotate!
      const shadowDist = 32.0;
      this.dirLight.position.set(
        cameraPos.x + this.activeLightDir.x * shadowDist,
        Math.max(14.0, this.activeLightDir.y * shadowDist),
        cameraPos.z + this.activeLightDir.z * shadowDist
      );
    }

    // Ambient Light adjustments
    if (this.ambientLight) {
      const dayAmbient = new THREE.Color(0xffffff);
      const nightAmbient = new THREE.Color(0x384c6e);
      this.ambientLight.color.copy(nightAmbient).lerp(dayAmbient, dayWeight);
      this.ambientLight.intensity = 0.45 + 0.45 * dayWeight;
    }

    // Update Sky Shader uniforms
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uTime.value = this.elapsedTime;
      this.skyMaterial.uniforms.uDayWeight.value = dayWeight;
      this.skyMaterial.uniforms.uSunDir.value.copy(this.currentSunDir);
      this.skyMaterial.uniforms.uMoonDir.value.copy(this.currentMoonDir);
      this.skyMaterial.uniforms.uZenithColor.value.copy(this.currentZenith);
      this.skyMaterial.uniforms.uMidColor.value.copy(this.currentMid);
      this.skyMaterial.uniforms.uHorizonColor.value.copy(this.currentHorizon);
      this.skyMaterial.uniforms.uSunColor.value.copy(this.currentSunColor);

      this.skyMesh.position.copy(cameraPos);
    }

    // Update Ocean Shader uniforms
    if (this.oceanMaterial) {
      this.oceanMaterial.uniforms.uTime.value = this.elapsedTime;
      this.oceanMaterial.uniforms.uCameraPos.value.copy(cameraPos);
      this.oceanMaterial.uniforms.uActiveLightDir.value.copy(this.activeLightDir);
      this.oceanMaterial.uniforms.uDeepColor.value.copy(this.currentOceanDeep);
      this.oceanMaterial.uniforms.uShallowColor.value.copy(this.currentOceanShallow);
      this.oceanMaterial.uniforms.uHorizonColor.value.copy(this.currentHorizon);
      this.oceanMaterial.uniforms.uSpecColor.value.copy(specColor);
    }
  }
}
