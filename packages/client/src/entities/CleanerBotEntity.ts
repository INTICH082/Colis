import * as THREE from 'three';

export class CleanerBotEntity {
  public group: THREE.Group;
  private targetPos: THREE.Vector3 = new THREE.Vector3();
  private targetRotY: number = 0;
  private ledRing: THREE.Mesh;
  private time: number = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // Cylindrical chassis (Roomba style)
    const bodyGeo = new THREE.CylinderGeometry(0.35, 0.38, 0.18, 24);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.5,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.09;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    // Glowing LED Status Ring
    const ringGeo = new THREE.TorusGeometry(0.32, 0.025, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    this.ledRing = new THREE.Mesh(ringGeo, ringMat);
    this.ledRing.rotation.x = Math.PI / 2;
    this.ledRing.position.y = 0.185;
    this.group.add(this.ledRing);

    // Bumper / Scanner Dome
    const domeGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2 });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(0, 0.18, -0.18);
    this.group.add(dome);

    this.group.visible = false;
    scene.add(this.group);
  }

  public sync(botData: { position: { x: number; y: number; z: number }; rotationY: number; state: string } | undefined): void {
    if (!botData) {
      this.group.visible = false;
      return;
    }

    if (!this.group.visible) {
      this.group.visible = true;
      this.group.position.set(botData.position.x, botData.position.y, botData.position.z);
      this.group.rotation.y = botData.rotationY;
    }

    this.targetPos.set(botData.position.x, botData.position.y, botData.position.z);
    this.targetRotY = botData.rotationY;
  }

  public update(dt: number): void {
    if (!this.group.visible) return;

    this.time += dt * 4;
    this.group.position.lerp(this.targetPos, Math.min(1, 14 * dt));

    let diff = this.targetRotY - this.group.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, 14 * dt);

    // Pulsing LED effect
    const pulse = 0.7 + Math.sin(this.time) * 0.3;
    (this.ledRing.material as THREE.MeshBasicMaterial).color.setRGB(0.2 * pulse, 0.74 * pulse, 0.97 * pulse);
  }
}
