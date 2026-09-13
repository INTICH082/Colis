import * as THREE from 'three';

export class GameRenderer {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public dirLight: THREE.DirectionalLight;
  public ambientLight: THREE.AmbientLight;
  public raycaster: THREE.Raycaster;
  public mousePos: THREE.Vector2;

  // Isometric camera offsets & gentle zoom controls
  private cameraOffset = new THREE.Vector3(10, 13, 10);
  public currentCameraTarget = new THREE.Vector3(0, 0, 7);
  private zoomFactor: number = 1.0;
  private targetZoomFactor: number = 1.0;
  private readonly minZoom: number = 0.75;
  private readonly maxZoom: number = 1.35;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcde3f5);
    // Linear fog ensures zero fogging in store interior while blending distant ocean into sky horizon
    this.scene.fog = new THREE.Fog(0xcde3f5, 120, 700);

    // Camera: FOV 38 provides a clean isometric aesthetic without distortion; far 1200 covers horizon
    this.camera = new THREE.PerspectiveCamera(
      38,
      window.innerWidth / window.innerHeight,
      0.1,
      1200
    );
    this.updateCameraTransform(this.currentCameraTarget);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xfffaed, 1.35);
    this.dirLight.position.set(15, 25, 12);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 1.0;
    this.dirLight.shadow.camera.far = 130;
    this.dirLight.shadow.bias = -0.0001;
    this.dirLight.shadow.normalBias = 0.03;

    const shadowDist = 34;
    this.dirLight.shadow.camera.left = -shadowDist;
    this.dirLight.shadow.camera.right = shadowDist;
    this.dirLight.shadow.camera.top = shadowDist;
    this.dirLight.shadow.camera.bottom = -shadowDist;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // Raycaster & Mouse tracking
    this.raycaster = new THREE.Raycaster();
    this.mousePos = new THREE.Vector2();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mousePos.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mousePos.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };

  private onWheel = (e: WheelEvent): void => {
    // Gentle zoom in/out with clamp
    this.targetZoomFactor += e.deltaY * 0.0008;
    this.targetZoomFactor = THREE.MathUtils.clamp(
      this.targetZoomFactor,
      this.minZoom,
      this.maxZoom
    );
  };

  public updateCamera(targetPos: THREE.Vector3, dt: number): void {
    // Smooth zoom interpolation
    this.zoomFactor = THREE.MathUtils.lerp(
      this.zoomFactor,
      this.targetZoomFactor,
      Math.min(1, 10 * dt)
    );

    // Smooth camera target following
    this.currentCameraTarget.lerp(targetPos, Math.min(1, 10 * dt));
    this.updateCameraTransform(this.currentCameraTarget);

    // Keep sun shadow frustum target centered near the player on the ground plane
    this.dirLight.target.position.set(this.currentCameraTarget.x, 0, this.currentCameraTarget.z);
    this.dirLight.target.updateMatrixWorld();
  }

  private updateCameraTransform(target: THREE.Vector3): void {
    this.camera.position.set(
      target.x + this.cameraOffset.x * this.zoomFactor,
      target.y + this.cameraOffset.y * this.zoomFactor,
      target.z + this.cameraOffset.z * this.zoomFactor
    );
    this.camera.lookAt(target.x, target.y + 0.8, target.z);
  }

  /**
   * Raycasts onto an infinite ground plane at y = 0 or specific meshes
   */
  public getGroundIntersection(groundY: number = 0): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.mousePos, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
    const target = new THREE.Vector3();
    const result = this.raycaster.ray.intersectPlane(plane, target);
    return result;
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
