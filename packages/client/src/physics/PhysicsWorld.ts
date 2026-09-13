import RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER_CONFIG, SHELF_CONFIG, STORE_LAYOUT, ShelfState, Vector3D } from '@colis/shared';

export class PhysicsWorld {
  public world!: RAPIER.World;
  public characterController!: RAPIER.KinematicCharacterController;
  public playerBody!: RAPIER.RigidBody;
  public playerCollider!: RAPIER.Collider;

  private isReady: boolean = false;

  public async init(): Promise<void> {
    await RAPIER.init();

    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // 1. Static Floor Collider (Thick foundation to permanently prevent any tunneling)
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
      STORE_LAYOUT.FLOOR_WIDTH / 2 + 10,
      5.0, // 10m total depth
      STORE_LAYOUT.FLOOR_DEPTH / 2 + 10
    ).setTranslation(0, -5.0, 0); // Top surface is exactly at y = 0.0
    this.world.createCollider(groundColliderDesc);

    // 2. Static Walls Colliders
    this.buildWallColliders();

    // 3. Player Kinematic RigidBody & Character Controller
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 7);
    this.playerBody = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(
      PLAYER_CONFIG.HEIGHT / 2 - PLAYER_CONFIG.RADIUS,
      PLAYER_CONFIG.RADIUS
    ).setTranslation(0, PLAYER_CONFIG.HEIGHT / 2, 0);
    this.playerCollider = this.world.createCollider(colliderDesc, this.playerBody);

    // Character Controller with sliding & auto-step
    const offset = 0.02;
    this.characterController = this.world.createCharacterController(offset);
    this.characterController.enableAutostep(0.25, 0.15, true);
    this.characterController.enableSnapToGround(0.3);
    this.characterController.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.characterController.setMinSlopeSlideAngle((35 * Math.PI) / 180);

    this.isReady = true;
  }

  private buildWallColliders(): void {
    const w = STORE_LAYOUT.FLOOR_WIDTH;
    const d = STORE_LAYOUT.FLOOR_DEPTH;
    const h = STORE_LAYOUT.WALL_HEIGHT;

    // Back wall
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, 0.3).setTranslation(0, h / 2, -d / 2 - 0.15)
    );
    // Left wall (-X)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.3, h / 2, d / 2).setTranslation(-w / 2 - 0.15, h / 2, 0)
    );
    // Right wall (+X)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.3, h / 2, d / 2).setTranslation(w / 2 + 0.15, h / 2, 0)
    );

    // Front wall Left (-X side of entrance, covers X in [-12, -4])
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid((w - 8) / 4, h / 2, 0.25)
        .setTranslation(-w / 4 - 2, h / 2, d / 2 + 0.2)
    );
    // Front wall Right (+X side of entrance, covers X in [4, 12])
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid((w - 8) / 4, h / 2, 0.25)
        .setTranslation(w / 4 + 2, h / 2, d / 2 + 0.2)
    );

    // Front dock terrace boundary (keeps player safe on dock)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(7.5, 1.0, 0.25).setTranslation(0, 0.5, 14.3)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 1.0, 2.2).setTranslation(-7.0, 0.5, 12.2)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, 1.0, 2.2).setTranslation(7.0, 0.5, 12.2)
    );
  }

  private shelfBodies: RAPIER.RigidBody[] = [];

  public registerShelves(shelves: Record<string, ShelfState>): void {
    for (const body of this.shelfBodies) {
      this.world.removeRigidBody(body);
    }
    this.shelfBodies = [];

    for (const shelf of Object.values(shelves)) {
      const shelfHalfW = SHELF_CONFIG.WIDTH / 2;
      const shelfHalfH = SHELF_CONFIG.HEIGHT / 2;
      const shelfHalfD = SHELF_CONFIG.DEPTH / 2;

      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(shelf.position.x, shelfHalfH, shelf.position.z)
        .setRotation({
          x: 0,
          y: Math.sin(shelf.rotationY / 2),
          z: 0,
          w: Math.cos(shelf.rotationY / 2),
        });

      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(shelfHalfW, shelfHalfH, shelfHalfD);
      this.world.createCollider(colliderDesc, body);
      this.shelfBodies.push(body);
    }
  }

  /**
   * Moves player with Rapier's KinematicCharacterController
   */
  public computePlayerMovement(desiredMovement: Vector3D): Vector3D {
    if (!this.isReady) return desiredMovement;

    // When jumping upwards, disable ground snapping so jump impulse is clean
    if (desiredMovement.y > 0.05) {
      this.characterController.disableSnapToGround();
    } else {
      this.characterController.enableSnapToGround(0.15);
    }

    this.characterController.computeColliderMovement(this.playerCollider, desiredMovement);
    const correctedMovement = this.characterController.computedMovement();

    const currentPos = this.playerBody.translation();
    const newPos = {
      x: currentPos.x + correctedMovement.x,
      y: Math.max(0, currentPos.y + correctedMovement.y), // Hard floor clamp at y = 0
      z: currentPos.z + correctedMovement.z,
    };

    this.playerBody.setNextKinematicTranslation(newPos);
    this.world.step();

    return newPos;
  }

  public isGrounded(): boolean {
    if (!this.isReady) return true;
    return this.characterController.computedGrounded() || this.playerBody.translation().y <= 0.05;
  }

  public teleportPlayer(pos: Vector3D): void {
    if (!this.isReady) return;
    const clampedY = Math.max(0, pos.y);
    this.playerBody.setTranslation({ x: pos.x, y: clampedY, z: pos.z }, true);
  }
}
