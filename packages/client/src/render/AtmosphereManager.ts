import * as THREE from 'three';

export class AtmosphereManager {
  private scene: THREE.Scene;
  private skyMesh!: THREE.Mesh;
  private oceanMesh!: THREE.Mesh;
  private pierGroup!: THREE.Group;

  private skyMaterial!: THREE.ShaderMaterial;
  private oceanMaterial!: THREE.ShaderMaterial;

  // Primary celestial lights
  public dirLight?: THREE.DirectionalLight; // Alias for sunLight
  public sunLight!: THREE.DirectionalLight;
  public moonLight!: THREE.DirectionalLight;
  public hemiLight!: THREE.HemisphereLight;
  public ambientLight?: THREE.AmbientLight;

  // Day/Night cycle configuration: 480 seconds (8 minutes) for a full cycle (65% day, 35% night)
  public dayCycleDuration: number = 480.0;
  // Start at 0.20 (bright morning ~10:00 AM)
  public timeOfDay: number = 0.20;
  private elapsedTime: number = 0;

  // Debug smooth time transition
  private targetTimeOfDay: number | null = null;
  private timeTransitionSpeed: number = 0.16; // Smooth time scrubbing speed

  // Working vectors & colors to avoid GC allocations
  private currentSunDir = new THREE.Vector3();
  private currentMoonDir = new THREE.Vector3();

  // Dynamic palette colors for Sky
  private colDayZenith = new THREE.Color(0x196eb8);
  private colSunsetZenith = new THREE.Color(0x2e1065);
  private colNightZenith = new THREE.Color(0x0e1c33); // Crisp midnight sapphire (never black)

  private colDayMid = new THREE.Color(0x56a5eb);
  private colSunsetMid = new THREE.Color(0x9333ea);
  private colNightMid = new THREE.Color(0x182c47);

  private colDayHorizon = new THREE.Color(0xcde3f5);
  private colSunsetHorizon = new THREE.Color(0xf97316);
  private colNightHorizon = new THREE.Color(0x283d5a);

  // Celestial disk colors
  private colSunMidday = new THREE.Color(0xfffaed);
  private colSunGolden = new THREE.Color(0xffa138);
  private colSunCrimson = new THREE.Color(0xff4d26);
  private colMoon = new THREE.Color(0xcbe4ff);

  // Oceanic water colors (Deep & Shallow)
  private colDayOceanDeep = new THREE.Color(0x022442);
  private colNightOceanDeep = new THREE.Color(0x041830);

  private colDayOceanShallow = new THREE.Color(0x0ea5e9);
  private colNightOceanShallow = new THREE.Color(0x103d68);

  private currentZenith = new THREE.Color();
  private currentMid = new THREE.Color();
  private currentHorizon = new THREE.Color();
  private currentSunColor = new THREE.Color();
  private currentOceanDeep = new THREE.Color();
  private currentOceanShallow = new THREE.Color();

  constructor(scene: THREE.Scene, dirLight?: THREE.DirectionalLight, ambientLight?: THREE.AmbientLight) {
    this.scene = scene;
    this.ambientLight = ambientLight;

    this.initLights(dirLight);
    this.createSky();
    this.createOcean();
    this.createPierFoundation();
  }

  private initLights(existingDirLight?: THREE.DirectionalLight): void {
    const shadowFrustumSize = 18.0;

    // 1. Sun Directional Light
    if (existingDirLight) {
      this.sunLight = existingDirLight;
    } else {
      this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.35);
      this.scene.add(this.sunLight);
    }
    this.scene.add(this.sunLight.target);

    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 140.0;
    this.sunLight.shadow.bias = 0.00005;
    this.sunLight.shadow.normalBias = 0.045;
    this.sunLight.shadow.radius = 2.0;
    this.sunLight.shadow.camera.left = -shadowFrustumSize;
    this.sunLight.shadow.camera.right = shadowFrustumSize;
    this.sunLight.shadow.camera.top = shadowFrustumSize;
    this.sunLight.shadow.camera.bottom = -shadowFrustumSize;
    this.sunLight.shadow.camera.updateProjectionMatrix();

    this.dirLight = this.sunLight;

    // 2. Moon Directional Light (Independent nocturnal source)
    this.moonLight = new THREE.DirectionalLight(0xaad0f8, 0.0);
    this.moonLight.castShadow = false;
    this.moonLight.shadow.mapSize.width = 2048;
    this.moonLight.shadow.mapSize.height = 2048;
    this.moonLight.shadow.camera.near = 0.5;
    this.moonLight.shadow.camera.far = 140.0;
    this.moonLight.shadow.bias = 0.00005;
    this.moonLight.shadow.normalBias = 0.045;
    this.moonLight.shadow.radius = 2.0;
    this.moonLight.shadow.camera.left = -shadowFrustumSize;
    this.moonLight.shadow.camera.right = shadowFrustumSize;
    this.moonLight.shadow.camera.top = shadowFrustumSize;
    this.moonLight.shadow.camera.bottom = -shadowFrustumSize;
    this.moonLight.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // 3. Hemisphere Light (Natural atmospheric sky/ground ambient balance)
    this.hemiLight = new THREE.HemisphereLight(0xcde3f5, 0x745842, 0.35);
    this.scene.add(this.hemiLight);
  }

  private createSky(): void {
    const skyGeo = new THREE.SphereGeometry(950, 32, 24);

    this.skyMaterial = new THREE.ShaderMaterial({
      name: 'DynamicProceduralSky',
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uTime: { value: 0 },
        uDayWeight: { value: 1.0 },
        uSunIntensity: { value: 1.0 },
        uMoonIntensity: { value: 0.0 },
        uZenithColor: { value: this.colDayZenith.clone() },
        uMidColor: { value: this.colDayMid.clone() },
        uHorizonColor: { value: this.colDayHorizon.clone() },
        uSunColor: { value: this.colSunMidday.clone() },
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
        uniform float uSunIntensity;
        uniform float uMoonIntensity;
        uniform vec3 uZenithColor;
        uniform vec3 uMidColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunColor;
        uniform vec3 uMoonColor;

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
            skyColor = mix(uHorizonColor, uZenithColor * 0.7, clamp(-height * 4.0, 0.0, 1.0));
          }

          // Daytime: Sun disk & Solar corona
          float cosSun = dot(dir, normalize(uSunDir));
          if (cosSun > 0.0 && uSunDir.y > -0.06) {
            float sunDisk = smoothstep(0.9982, 0.9997, cosSun);
            float corona = pow(cosSun, 18.0) * 0.40 + pow(cosSun, 64.0) * 0.30;
            float horizonFade = smoothstep(-0.06, 0.06, uSunDir.y);
            skyColor += uSunColor * (sunDisk * 2.5 + corona) * horizonFade;
          }

          // Moon disk: visible in afternoon, dusk, and night (realistic daytime moon)
          float cosMoon = dot(dir, normalize(uMoonDir));
          if (cosMoon > 0.0 && uMoonDir.y > -0.06) {
            float moonDisk = smoothstep(0.9976, 0.9995, cosMoon);
            float moonGlow = pow(cosMoon, 24.0) * 0.30;
            float horizonFade = smoothstep(-0.06, 0.06, uMoonDir.y);
            // Daytime moon is pale white; nocturnal moon glows bright silver
            vec3 currentMoonTint = mix(uMoonColor * 1.5, vec3(0.90, 0.94, 1.0) * 0.75, uDayWeight);
            float glowFactor = (1.0 - uDayWeight * 0.75);
            skyColor += currentMoonTint * (moonDisk * 1.8 + moonGlow * glowFactor) * horizonFade;
          }

          // Nighttime: Procedural Twinkling Stars
          if (uDayWeight < 0.70 && height > 0.06) {
            vec2 starSeed = floor(dir.xz / (height + 0.15) * 360.0);
            float starVal = fract(sin(dot(starSeed, vec2(12.9898, 78.233))) * 43758.5453);
            if (starVal > 0.986) {
              float twinkle = 0.65 + 0.35 * sin(uTime * 3.5 + starVal * 90.0);
              float starIntensity = (starVal - 0.986) * 95.0 * twinkle * (1.0 - uDayWeight);
              skyColor += vec3(0.92, 0.96, 1.0) * starIntensity;
            }
          }

          // Natural cloud drift
          if (height > 0.04) {
            vec2 skyUV = dir.xz / (height + 0.28) * 0.05 + vec2(uTime * 0.0018, uTime * 0.0012);
            float n1 = sin(skyUV.x * 6.0 + sin(skyUV.y * 5.0)) * 0.5 + 0.5;
            float n2 = cos(skyUV.y * 8.0 + cos(skyUV.x * 7.0)) * 0.5 + 0.5;
            float cloud = smoothstep(0.68, 0.92, (n1 + n2) * 0.5) * clamp(height * 1.5, 0.0, 0.6);
            vec3 cloudColor = mix(vec3(0.18, 0.22, 0.32), vec3(1.0, 0.98, 0.95), uDayWeight);
            skyColor = mix(skyColor, cloudColor, cloud * 0.30);
          }

          gl_FragColor = vec4(skyColor, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
  }

  /**
   * Beautiful Stylized Gerstner Ocean Shader
   * Features: Natural wind-driven ocean swells, analytical normal computation,
   * directional surface micro-sparkles (zero spiral or ring artifacts),
   * subsurface scattering translucency, independent sun/moon road specular highlights,
   * natural crest foam and rectangular pier shoreline foam.
   */
  private createOcean(): void {
    const oceanGeo = new THREE.PlaneGeometry(1800, 1800, 32, 32);
    oceanGeo.rotateX(-Math.PI / 2);
    oceanGeo.boundingBox = new THREE.Box3(
      new THREE.Vector3(-900, -0.5, -900),
      new THREE.Vector3(900, 0.6, 900)
    );
    oceanGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1280);

    this.oceanMaterial = new THREE.ShaderMaterial({
      name: 'SeascapeOcean',
      transparent: false,
      depthTest: true,
      depthWrite: true,
      fog: true,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3(0, 10, 10) },
        uResolution: {
          value: new THREE.Vector2(
            typeof window !== 'undefined' ? window.innerWidth : 1920,
            typeof window !== 'undefined' ? window.innerHeight : 1080
          ),
        },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfffaed) },
        uSunIntensity: { value: 1.0 },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonColor: { value: new THREE.Color(0xdbeafe) },
        uMoonIntensity: { value: 0.0 },
        uDayWeight: { value: 1.0 },
        uSeaLevel: { value: -0.85 },
      },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>

        varying vec3 vWorldPosition;

        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          vec4 mvPosition = viewMatrix * worldPos;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>

        uniform float uTime;
        uniform vec3 uCameraPos;
        uniform vec2 uResolution;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uMoonDir;
        uniform vec3 uMoonColor;
        uniform float uMoonIntensity;
        uniform float uDayWeight;
        uniform float uSeaLevel;

        varying vec3 vWorldPosition;

        // "Seascape" by Alexander Alekseev aka TDM - 2014
        // Original: https://www.shadertoy.com/view/Ms2SD1
        const float PI = 3.14159265358;
        const float EPSILON = 1e-3;
        #define EPSILON_NRM (0.35 / uResolution.x)

        const int NUM_STEPS = 6;
        const int ITER_GEOMETRY = 2;
        const int ITER_FRAGMENT = 3;

        const float SEA_HEIGHT = 0.5;
        const float SEA_CHOPPY = 3.0;
        const float SEA_SPEED = 1.9;
        const float SEA_FREQ = 0.24;
        const vec3 SEA_BASE = vec3(0.04, 0.12, 0.24);       // Deep rich oceanic sapphire blue
        const vec3 SEA_WATER_COLOR = vec3(0.14, 0.52, 0.74); // Vibrant clear ocean azure (B > G > R: completely natural, zero acid green)
        #define SEA_TIME (uTime * SEA_SPEED)

        const mat2 octave_m = mat2(1.7, 1.2, -1.2, 1.4);

        // Vectorized SIMD 4-corner hash: calculates all 4 noise corners in parallel
        vec4 hash4(vec2 i) {
            vec4 p = vec4(i.x, i.y, i.x + 1.0, i.y + 1.0);
            vec4 h = vec4(
                dot(p.xy, vec2(127.1, 311.7)),
                dot(p.zy, vec2(127.1, 311.7)),
                dot(p.xw, vec2(127.1, 311.7)),
                dot(p.zw, vec2(127.1, 311.7))
            );
            return fract(sin(h) * 83758.5453123);
        }

        float noise(in vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);	
            vec2 u = f * f * (3.0 - 2.0 * f);
            vec4 h = hash4(i);
            return -1.0 + 2.0 * mix(
                mix(h.x, h.y, u.x),
                mix(h.z, h.w, u.x),
                u.y
            );
        }

        float diffuse(vec3 n, vec3 l, float p) {
            return pow(dot(n, l) * 0.4 + 0.6, p);
        }

        float specular(vec3 n, vec3 l, vec3 e, float s) {    
            float nrm = (s + 8.0) / (3.1415 * 8.0);
            return pow(max(dot(reflect(e, n), l), 0.0), s) * nrm;
        }

        vec3 getSkyColor(vec3 e) {
            e.y = max(e.y, 0.0);
            vec3 ret;
            ret.x = pow(1.0 - e.y, 2.0);
            ret.y = 1.0 - e.y;
            ret.z = 0.6 + (1.0 - e.y) * 0.4;
            // Naturally adjust reflection brightness between day and night
            return ret * (0.08 + 0.92 * uDayWeight);
        }

        float sea_octave(vec2 uv, float choppy) {
            uv += noise(uv);
            vec2 wv = 1.0 - abs(sin(uv)); 
            vec2 swv = abs(cos(uv));  
            wv = mix(wv, swv, wv);
            return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
        }

        float map(vec3 p) {
            float freq = SEA_FREQ;
            float amp = SEA_HEIGHT;
            float choppy = SEA_CHOPPY;
            vec2 uv = p.xz; uv.x *= 0.75;
            
            float d, h = 0.0;    
            for(int i = 0; i < ITER_GEOMETRY; i++) {
                d = sea_octave((uv + SEA_TIME) * freq, choppy);
                h += d * amp;
                uv *= octave_m;
                freq *= 1.9;
                amp *= 0.22;
                choppy = mix(choppy, 1.0, 0.2);
            }
            return (p.y - uSeaLevel) - h;
        }

        float map_detailed(vec3 p) {
            float freq = SEA_FREQ;
            float amp = SEA_HEIGHT;
            float choppy = SEA_CHOPPY;
            vec2 uv = p.xz; uv.x *= 0.75;
            
            float d, h = 0.0;    
            for(int i = 0; i < ITER_FRAGMENT; i++) {
                d = sea_octave((uv + SEA_TIME) * freq, choppy);
                d += sea_octave((uv - SEA_TIME) * freq, choppy);
                h += d * amp;
                uv *= octave_m * 0.833333;
                freq *= 1.9;
                amp *= 0.22;
                choppy = mix(choppy, 1.0, 0.2);
            }
            return (p.y - uSeaLevel) - h;
        }

        vec3 getSeaColor(vec3 p, vec3 n, vec3 eye, vec3 dist) {  
            float fresnel = clamp(1.0 - dot(n, -eye), 0.0, 1.0);
            fresnel = min(pow(fresnel, 3.0), 0.55);
                
            vec3 reflected = getSkyColor(reflect(eye, n));    
            float sunDiff = max(0.0, dot(n, uSunDir) * 0.4 + 0.6);
            vec3 refracted = SEA_BASE + sunDiff * SEA_WATER_COLOR * 0.28 * clamp(uSunIntensity, 0.15, 1.0); 
            
            vec3 color = mix(refracted, reflected, fresnel);
            
            // Subsurface wave translucency at crests
            float atten = max(1.0 - dot(dist, dist) * 0.0008, 0.0);
            float waveDepth = clamp((p.y - uSeaLevel) / SEA_HEIGHT, 0.0, 1.0);
            color += SEA_WATER_COLOR * pow(waveDepth, 1.4) * 0.22 * atten * (0.15 + 0.85 * uDayWeight);

            // 1. Sun specular highlight & light road (smoothly dims as sun sets)
            if (uSunIntensity > 0.001) {
                float sunSpec = specular(n, uSunDir, eye, 65.0);
                color += uSunColor * sunSpec * uSunIntensity * 0.75;
            }

            // 2. Moon specular highlight & silver light road (smoothly brightens at night)
            if (uMoonIntensity > 0.001) {
                float moonSpec = specular(n, uMoonDir, eye, 65.0);
                color += uMoonColor * moonSpec * uMoonIntensity * 0.85;
            }
            
            return color;
        }

        vec3 getNormal(vec3 p, float eps, float distSq) {
            vec3 n;
            float e = max(eps, EPSILON);
            // Distance LOD: beyond 70m, subpixel wave ripples are invisible to human eye.
            // Using 2-octave map() instead of 3-octave map_detailed() saves 300% instructions on distant water!
            if (distSq > 5000.0) {
                n.y = map(p);
                n.x = map(vec3(p.x + e, p.y, p.z)) - n.y;
                n.z = map(vec3(p.x, p.y, p.z + e)) - n.y;
            } else {
                n.y = map_detailed(p);
                n.x = map_detailed(vec3(p.x + e, p.y, p.z)) - n.y;
                n.z = map_detailed(vec3(p.x, p.y, p.z + e)) - n.y;
            }
            n.y = e; 
            return normalize(n);
        }

        float heightMapTracing(vec3 ori, vec3 dir, out vec3 p) {  
            // If ray points towards sky or horizontal, bail early
            if (dir.y >= -1e-4) {
                p = ori + dir * 1000.0;
                return 1000.0;
            }

            // Analytical interval where water waves exist [uSeaLevel, uSeaLevel + SEA_HEIGHT]
            float tm = max(0.0, (uSeaLevel + SEA_HEIGHT - ori.y) / dir.y);
            float tx = (uSeaLevel - 0.15 - ori.y) / dir.y;
            if (tx < tm) {
                float tmp = tm; tm = tx; tx = tmp;
            }

            // Far horizon optimization: beyond 600m, water surface is 100% sky/fog blended
            if (tm > 600.0) {
                p = ori + dir * tm;
                return tm;
            }

            float hx = map(ori + dir * tx);
            float hm = map(ori + dir * tm);
            p = ori + dir * tm;

            float tmid = tm;
            for(int i = 0; i < NUM_STEPS; i++) {
                float denom = hm - hx;
                if (abs(denom) < 1e-5) denom = 1e-5;
                tmid = mix(tm, tx, hm / denom);
                p = ori + dir * tmid; 
                float hmid = map(p);
                if(hmid < 0.0) {
                    tx = tmid;
                    hx = hmid;
                } else {
                    tm = tmid;
                    hm = hmid;
                }
            }
            return tmid;
        }

        void main() {
            vec3 ori = uCameraPos;
            vec3 dir = normalize(vWorldPosition - uCameraPos);

            // 1. Above-horizon fast early-exit:
            // Any fragment looking at or above the water line is sky/air.
            // Bypasses 100% of raymarching, normal loops, and lighting math!
            if (dir.y >= -1e-4) {
                gl_FragColor = vec4(getSkyColor(dir), 1.0);
                #include <fog_fragment>
                return;
            }

            vec3 p;
            float t = heightMapTracing(ori, dir, p);

            vec3 dist = p - ori;
            float distSq = dot(dist, dist);

            vec3 n = getNormal(p, distSq * EPSILON_NRM, distSq);
                     
            vec3 skyColor = getSkyColor(dir);
            vec3 seaColor = getSeaColor(p, n, dir, dist);

            // Day / Night lighting modulation (smoothly darkens at night to midnight sapphire, never black)
            vec3 finalSea = seaColor * (0.35 + 0.65 * uDayWeight);

            // Blend to sky / horizon smoothly at far distance
            float seaFactor = pow(clamp(-dir.y * 16.0, 0.0, 1.0), 0.35);
            vec3 color = mix(skyColor, finalSea, seaFactor);
                
            // Gamma curve (Alexander Alekseev original)
            color = pow(max(color, vec3(0.0)), vec3(0.75));

            // Clean, natural vibrance (luma-based saturation boost, strictly preserving blue hues without any acid/lime tint)
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, 1.20);

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
            #include <fog_fragment>
        }
      `,
    });

    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMaterial);
    this.oceanMesh.position.set(0, -0.85, 0);
    this.oceanMesh.receiveShadow = false;
    this.oceanMesh.frustumCulled = true;
    this.scene.add(this.oceanMesh);
  }

  private createPierFoundation(): void {
    this.pierGroup = new THREE.Group();
    this.pierGroup.name = 'PierFoundation';

    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.85,
      metalness: 0.08,
      dithering: true,
    });

    const dockWoodMat = new THREE.MeshStandardMaterial({
      color: 0x785338,
      roughness: 0.75,
      metalness: 0.05,
      dithering: true,
    });

    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.7,
      dithering: true,
    });

    const pilingMat = new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.9,
      dithering: true,
    });

    // 1. Concrete foundation slab underneath supermarket
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
   * Smoothly transitions time of day towards targetTime (0.0 to 1.0).
   * Used for debug controls and time shifts.
   */
  public transitionToTime(targetTime: number): void {
    this.targetTimeOfDay = ((targetTime % 1.0) + 1.0) % 1.0;
  }

  /**
   * Main atmosphere & Day/Night tick
   * - Smooth time transition handling for debug keys.
   * - 65% Daytime / 35% Nighttime cycle remapping.
   * - Celestial antipode moon orbit (moon rises as sun sets, eliminating pitch black periods).
   * - World-space shadow texel snapping to completely eliminate shadow jitter and swimming.
   * - Seamless shadow projection centered on the player ground position.
   */
  public update(dt: number, cameraPos: THREE.Vector3, focusTarget?: THREE.Vector3): void {
    this.elapsedTime += dt;

    // 1. Advance time of day (0.0 to 1.0) with smooth scrub support
    if (this.targetTimeOfDay !== null) {
      let diff = this.targetTimeOfDay - this.timeOfDay;
      // Shortest circular wrap [-0.5, 0.5]
      if (diff > 0.5) diff -= 1.0;
      if (diff < -0.5) diff += 1.0;

      const step = Math.sign(diff) * Math.min(Math.abs(diff), this.timeTransitionSpeed * dt);
      this.timeOfDay = (this.timeOfDay + step + 1.0) % 1.0;

      if (Math.abs(diff) < 0.002) {
        this.timeOfDay = this.targetTimeOfDay;
        this.targetTimeOfDay = null;
      }
    } else {
      this.timeOfDay = (this.timeOfDay + dt / this.dayCycleDuration) % 1.0;
    }

    // 2. Daytime extension remapping: 65% daytime, 35% nighttime
    // cycleT in [0, 0.65] maps to astronomy [0, 0.50] (Sunrise to Sunset)
    // cycleT in [0.65, 1.00] maps to astronomy [0.50, 1.00] (Sunset to Sunrise)
    const cycleT = this.timeOfDay;
    let astronomyTime: number;
    if (cycleT < 0.65) {
      astronomyTime = (cycleT / 0.65) * 0.50;
    } else {
      astronomyTime = 0.50 + ((cycleT - 0.65) / 0.35) * 0.50;
    }

    // Sun arc: 0.0 = Sunrise (East), 0.25 = Noon (High Sun), 0.50 = Sunset (West), 0.75 = Midnight
    const sunTheta = 2.0 * Math.PI * astronomyTime - Math.PI / 2.0;
    const sunElev = Math.cos(sunTheta);
    const sunEastWest = Math.sin(sunTheta);
    const sunTiltZ = 0.36 * Math.cos(sunTheta);
    this.currentSunDir.set(sunEastWest, sunElev, sunTiltZ).normalize();

    // Exact Celestial Antipode: Moon is 180 degrees (Math.PI) opposite to Sun.
    // When Sun sets in the West, Moon rises in the East! Night is NEVER left without moonlight.
    const moonTheta = sunTheta - Math.PI;
    const moonElev = Math.cos(moonTheta);
    const moonEastWest = Math.sin(moonTheta);
    const moonTiltZ = -0.32 * Math.cos(moonTheta);
    this.currentMoonDir.set(moonEastWest, moonElev, moonTiltZ).normalize();

    // 3. Day & Sunset weights
    const dayWeight = THREE.MathUtils.smoothstep(sunElev, -0.05, 0.18);
    const sunsetWeight = Math.exp(-Math.pow(sunElev / 0.14, 2.0));

    // 4. Interpolate Sky Colors (Zenith, Mid, Horizon)
    this.currentZenith.copy(this.colNightZenith).lerp(this.colDayZenith, dayWeight);
    if (sunsetWeight > 0.05) {
      this.currentZenith.lerp(this.colSunsetZenith, sunsetWeight * 0.75);
    }

    this.currentMid.copy(this.colNightMid).lerp(this.colDayMid, dayWeight);
    if (sunsetWeight > 0.05) {
      this.currentMid.lerp(this.colSunsetMid, sunsetWeight * 0.75);
    }

    this.currentHorizon.copy(this.colNightHorizon).lerp(this.colDayHorizon, dayWeight);
    if (sunsetWeight > 0.05) {
      this.currentHorizon.lerp(this.colSunsetHorizon, sunsetWeight * 0.95);
    }

    // 5. Interpolate Sun Color smoothly across elevations (Midday -> Golden Hour -> Crimson Sunset)
    if (sunElev > 0.18) {
      this.currentSunColor.copy(this.colSunMidday);
    } else if (sunElev > 0.02) {
      const t = (sunElev - 0.02) / 0.16;
      this.currentSunColor.copy(this.colSunGolden).lerp(this.colSunMidday, t);
    } else {
      const t = THREE.MathUtils.clamp((sunElev + 0.06) / 0.08, 0.0, 1.0);
      this.currentSunColor.copy(this.colSunCrimson).lerp(this.colSunGolden, t);
    }

    // 6. Interpolate Ocean Colors
    this.currentOceanDeep.copy(this.colNightOceanDeep).lerp(this.colDayOceanDeep, dayWeight);
    this.currentOceanShallow.copy(this.colNightOceanShallow).lerp(this.colDayOceanShallow, dayWeight);

    // 7. Update Scene Fog & Background
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.currentHorizon);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.currentHorizon);
    }

    // 8. Light Intensities & Shadow Projection (Texel-Snapped, Zero Jitter/Swimming!)
    const focus = focusTarget || new THREE.Vector3(cameraPos.x, 0, cameraPos.z);

    // World-space shadow texel snapping:
    // With 2048x2048 shadow map and 76.0m frustum, 1 texel = 76.0 / 2048 ≈ 0.0371m.
    // Snapping the light focus to world-space texel boundaries keeps the shadow projection
    // matrix rigidly aligned with the world geometry, eliminating shadow jitter and swimming!
    const shadowFrustumSize = 18.0;
    const shadowMapSize = 2048;
    const worldTexelSize = (shadowFrustumSize * 2.0) / shadowMapSize;
    const snappedFocusX = Math.round(focus.x / worldTexelSize) * worldTexelSize;
    const snappedFocusZ = Math.round(focus.z / worldTexelSize) * worldTexelSize;

    // Sun intensity: smoothly descends from daytime elevation down into civil twilight (-0.05)
    const sunIntensity = THREE.MathUtils.smoothstep(sunElev, -0.05, 0.18) * 1.35;

    // Night illumination: smoothly fades in as sun sinks into twilight.
    // Base floor ensures nighttime never goes pitch black!
    const nightWeight = 1.0 - THREE.MathUtils.smoothstep(sunElev, -0.06, 0.14);
    const moonElevFactor = THREE.MathUtils.smoothstep(moonElev, 0.00, 0.15);
    const moonIntensity = nightWeight * (0.18 + 0.32 * moonElevFactor);

    // Seamless shadow caster transition:
    // Avoid extreme grazing angles (below 0.05 elev) where shadow acne on floors/walls becomes prominent
    const sunCastsShadow = sunElev > 0.05 && sunIntensity > 0.05;
    if (sunCastsShadow) {
      if (!this.sunLight.castShadow) this.sunLight.castShadow = true;
      if (this.moonLight.castShadow) this.moonLight.castShadow = false;
    } else {
      if (this.sunLight.castShadow) this.sunLight.castShadow = false;
      const moonCastsShadow = moonElev > 0.05 && moonIntensity > 0.05;
      if (this.moonLight.castShadow !== moonCastsShadow) {
        this.moonLight.castShadow = moonCastsShadow;
      }
    }

    const lightDist = 65.0;

    // Position Sun Light toward snapped ground focus point (min height 8.0m ensures rays clear roof and don't graze)
    this.sunLight.color.copy(this.currentSunColor);
    this.sunLight.intensity = sunIntensity;
    const sunY = Math.max(8.0, this.currentSunDir.y * lightDist);
    this.sunLight.position.set(
      snappedFocusX + this.currentSunDir.x * lightDist,
      sunY,
      snappedFocusZ + this.currentSunDir.z * lightDist
    );
    this.sunLight.target.position.set(snappedFocusX, 0, snappedFocusZ);
    this.sunLight.target.updateMatrixWorld();

    // Position Moon Light toward snapped ground focus point
    this.moonLight.color.copy(this.colMoon);
    this.moonLight.intensity = moonIntensity;
    const moonY = Math.max(8.0, this.currentMoonDir.y * lightDist);
    this.moonLight.position.set(
      snappedFocusX + this.currentMoonDir.x * lightDist,
      moonY,
      snappedFocusZ + this.currentMoonDir.z * lightDist
    );
    this.moonLight.target.position.set(snappedFocusX, 0, snappedFocusZ);
    this.moonLight.target.updateMatrixWorld();

    // 9. Ambient Light (Smooth day/sunset/night interpolation with reliable night visibility floor)
    if (this.ambientLight) {
      const dayAmbient = new THREE.Color(0xfff8ee);
      const sunsetAmbient = new THREE.Color(0x7a436e);
      const nightAmbient = new THREE.Color(0x354a6b); // Atmospheric moonlit blue-grey, never dark void

      const curAmbient = new THREE.Color().copy(nightAmbient).lerp(dayAmbient, dayWeight);
      if (sunsetWeight > 0.05) {
        curAmbient.lerp(sunsetAmbient, sunsetWeight * 0.65);
      }
      this.ambientLight.color.copy(curAmbient);
      this.ambientLight.intensity = 0.65 + 0.25 * dayWeight;
    }

    // 10. Hemisphere Light (Atmospheric bounce)
    if (this.hemiLight) {
      const daySky = new THREE.Color(0xcde3f5);
      const dayGround = new THREE.Color(0x745842);
      const nightSky = new THREE.Color(0x223656);
      const nightGround = new THREE.Color(0x121c2c);

      this.hemiLight.color.copy(nightSky).lerp(daySky, dayWeight);
      this.hemiLight.groundColor.copy(nightGround).lerp(dayGround, dayWeight);
      this.hemiLight.intensity = 0.35 + 0.15 * dayWeight;
    }

    // 11. Update Sky Shader uniforms
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uTime.value = this.elapsedTime;
      this.skyMaterial.uniforms.uDayWeight.value = dayWeight;
      this.skyMaterial.uniforms.uSunIntensity.value = sunIntensity;
      this.skyMaterial.uniforms.uMoonIntensity.value = moonIntensity;
      this.skyMaterial.uniforms.uSunDir.value.copy(this.currentSunDir);
      this.skyMaterial.uniforms.uMoonDir.value.copy(this.currentMoonDir);
      this.skyMaterial.uniforms.uZenithColor.value.copy(this.currentZenith);
      this.skyMaterial.uniforms.uMidColor.value.copy(this.currentMid);
      this.skyMaterial.uniforms.uHorizonColor.value.copy(this.currentHorizon);
      this.skyMaterial.uniforms.uSunColor.value.copy(this.currentSunColor);
      this.skyMaterial.uniforms.uMoonColor.value.copy(this.colMoon);

      this.skyMesh.position.copy(cameraPos);
    }

    // 12. Update Ocean Shader uniforms
    if (this.oceanMaterial) {
      this.oceanMaterial.uniforms.uTime.value = this.elapsedTime;
      this.oceanMaterial.uniforms.uCameraPos.value.copy(cameraPos);
      if (typeof window !== 'undefined') {
        this.oceanMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
      }
      this.oceanMaterial.uniforms.uDayWeight.value = dayWeight;
      this.oceanMaterial.uniforms.uSunDir.value.copy(this.currentSunDir);
      this.oceanMaterial.uniforms.uSunColor.value.copy(this.currentSunColor);
      this.oceanMaterial.uniforms.uSunIntensity.value = sunIntensity;
      this.oceanMaterial.uniforms.uMoonDir.value.copy(this.currentMoonDir);
      this.oceanMaterial.uniforms.uMoonColor.value.copy(this.colMoon);
      this.oceanMaterial.uniforms.uMoonIntensity.value = moonIntensity;

      // Keep ocean mesh centered right under camera for infinite horizon coverage
      this.oceanMesh.position.set(cameraPos.x, -0.85, cameraPos.z);
    }
  }

  public dispose(): void {
    if (this.skyMaterial) {
      this.skyMaterial.dispose();
    }
    if (this.oceanMaterial) {
      this.oceanMaterial.dispose();
    }
    if (this.skyMesh) {
      this.skyMesh.geometry.dispose();
    }
    if (this.oceanMesh) {
      this.oceanMesh.geometry.dispose();
    }
  }
}
