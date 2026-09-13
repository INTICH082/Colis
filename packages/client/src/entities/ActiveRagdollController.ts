import * as THREE from 'three';
import { EnvironmentContext, PhysicalObstacleSolver } from '../physics/PhysicalObstacleSolver';

/**
 * Second-Order Dynamics / Spring-Damper numerical solver.
 * Simulates mass-spring-damper physics with exact semi-implicit integration.
 */
export class SpringDamper {
  public value: number;
  public velocity: number = 0;
  public frequency: number; // Oscillation speed (Hz)
  public damping: number;   // Damping ratio (< 1: bouncy, 1: critical, > 1: sluggish)

  constructor(initialValue: number = 0, frequency: number = 14, damping: number = 0.65) {
    this.value = initialValue;
    this.frequency = frequency;
    this.damping = damping;
  }

  public update(target: number, dt: number): number {
    const clampedDt = Math.min(Math.max(dt, 0.0001), 0.05);
    const omega = 2 * Math.PI * this.frequency;
    const k = omega * omega;
    const c = 2 * this.damping * omega;

    const force = -k * (this.value - target) - c * this.velocity;
    this.velocity += force * clampedDt;
    this.value += this.velocity * clampedDt;

    if (isNaN(this.value)) {
      this.value = target;
      this.velocity = 0;
    }

    return this.value;
  }

  public impulse(amount: number): void {
    this.velocity += amount;
  }

  public reset(val: number): void {
    this.value = val;
    this.velocity = 0;
  }
}

export interface CharacterBones {
  root?: THREE.Object3D;
  torso?: THREE.Object3D;
  head?: THREE.Object3D;
  rLeg?: THREE.Object3D;
  lLeg?: THREE.Object3D;
  rHand?: THREE.Object3D;
  lHand?: THREE.Object3D;
}

export interface RagdollInputState {
  dt: number;
  isMoving: boolean;
  isSprinting: boolean;
  isAirborne: boolean;
  worldMoveX: number;
  worldMoveZ: number;
  playerRotationY: number;
  isHoldingBox: boolean;
  playerWorldPos?: THREE.Vector3;
  obstacleSolver?: PhysicalObstacleSolver;
}

export type RagdollStatus = 'ACTIVE' | 'KNOCKED_DOWN' | 'GETTING_UP';

/**
 * ActiveRagdollController
 *
 * Fully procedural physical animation and deformation system inspired by TABS, Human: Fall Flat, and Gang Beasts.
 * Directly drives character body parts (Torso, Head, R_Leg, L_Leg, R_Hand, L_Hand) with:
 *  - Real-time continuous environment obstacle avoidance & proximity sensing (shelves, walls)
 *  - Procedural arm tucking against the torso (arms hug ribs when near shelves)
 *  - Body squeezing in narrow corridors (shoulders compress, torso angles sideways)
 *  - Non-penetrating hand & limb surface constraints (IK pushes hands onto obstacle surfaces)
 *  - Second-order dynamics spring-damper inverted pendulum balance (Torso)
 *  - True Leg IK ground tilt compensation
 *  - Smooth airborne weight transitions (butter-smooth jump landings)
 *  - Full Ragdoll Knockdown, floor sliding, and comical get-up recovery sequence
 *  - Heavy box holding physics with dynamic mass momentum lag
 */
export class ActiveRagdollController {
  public bones: CharacterBones = {};

  // Lifecycle State
  public status: RagdollStatus = 'ACTIVE';
  public knockdownTimer: number = 0;
  public getUpTimer: number = 0;
  public slideVelocity: THREE.Vector3 = new THREE.Vector3();

  // Smooth Airborne Transition Blend (0 = ground, 1 = airborne flail)
  private airborneBlend: number = 0;

  // Base rest transforms recorded from initial model bind pose
  private restTorsoY: number = 1.25;
  private restHeadY: number = 0.125;
  private restRLegPos: THREE.Vector3 = new THREE.Vector3(-0.1875, -0.508, 0);
  private restLLegPos: THREE.Vector3 = new THREE.Vector3(0.1875, -0.508, 0);
  private restRHandPos: THREE.Vector3 = new THREE.Vector3(-0.3516, 0.07, 0);
  private restLHandPos: THREE.Vector3 = new THREE.Vector3(0.3516, 0.07, 0);

  // Dynamic shoulder compression offsets
  private currentShoulderR: THREE.Vector3 = new THREE.Vector3(-0.3516, 0.07, 0);
  private currentShoulderL: THREE.Vector3 = new THREE.Vector3(0.3516, 0.07, 0);

  // Torso Dynamics Springs
  public torsoYSpring: SpringDamper = new SpringDamper(1.25, 11, 0.62);
  public torsoPitchSpring: SpringDamper = new SpringDamper(0, 10, 0.62);
  public torsoRollSpring: SpringDamper = new SpringDamper(0, 10, 0.62);
  public torsoYawSpring: SpringDamper = new SpringDamper(0, 12, 0.7);

  // Head Dynamics Springs
  public headPitchSpring: SpringDamper = new SpringDamper(0, 14, 0.65);
  public headRollSpring: SpringDamper = new SpringDamper(0, 13, 0.65);
  public headYawSpring: SpringDamper = new SpringDamper(0, 15, 0.72);

  // Arms Ragdoll Springs (X = swing pitch, Y = twist yaw, Z = flap/spread roll)
  public rArmPitchSpring: SpringDamper = new SpringDamper(0, 10, 0.58);
  public rArmRollSpring: SpringDamper = new SpringDamper(-0.15, 10, 0.60);
  public rArmYawSpring: SpringDamper = new SpringDamper(0, 11, 0.64);

  public lArmPitchSpring: SpringDamper = new SpringDamper(0, 10, 0.58);
  public lArmRollSpring: SpringDamper = new SpringDamper(0.15, 10, 0.60);
  public lArmYawSpring: SpringDamper = new SpringDamper(0, 11, 0.64);

  // Held Box Momentum Lag Springs
  public boxOffsetPitch: SpringDamper = new SpringDamper(0, 12, 0.6);
  public boxOffsetYaw: SpringDamper = new SpringDamper(0, 11, 0.6);
  public boxOffsetRoll: SpringDamper = new SpringDamper(0, 12, 0.6);
  public boxOffsetY: SpringDamper = new SpringDamper(0, 14, 0.65);

  // Legs Dynamics Springs
  public rLegPitchSpring: SpringDamper = new SpringDamper(0, 17, 0.78);
  public rLegRollSpring: SpringDamper = new SpringDamper(0, 17, 0.78);
  public lLegPitchSpring: SpringDamper = new SpringDamper(0, 17, 0.78);
  public lLegRollSpring: SpringDamper = new SpringDamper(0, 17, 0.78);

  // Gait Engine State
  private gaitPhase: number = 0;
  private totalTime: number = 0;
  private prevRotY: number = 0;
  private rotVelocityY: number = 0;
  private wasAirborne: boolean = false;
  private localVelFwd: number = 0;
  private localVelRight: number = 0;

  // Reusable vectors for zero-allocation math
  private static readonly REST_ARM_DIR: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
  private static readonly TIP_LOCAL_OFFSET: THREE.Vector3 = new THREE.Vector3(0, -0.65, 0);
  private tempVecA: THREE.Vector3 = new THREE.Vector3();
  private tempVecB: THREE.Vector3 = new THREE.Vector3();
  private tempVecC: THREE.Vector3 = new THREE.Vector3();
  private tempQuatA: THREE.Quaternion = new THREE.Quaternion();
  private tempQuatB: THREE.Quaternion = new THREE.Quaternion();

  constructor(bones: CharacterBones) {
    this.bones = bones;
    this.recordRestPoses();
  }

  private recordRestPoses(): void {
    if (this.bones.torso) {
      this.restTorsoY = this.bones.torso.position.y || 1.25;
      this.torsoYSpring.reset(this.restTorsoY);
    }
    if (this.bones.head) {
      this.restHeadY = this.bones.head.position.y || 0.125;
    }
    if (this.bones.rLeg) {
      this.restRLegPos.copy(this.bones.rLeg.position);
    }
    if (this.bones.lLeg) {
      this.restLLegPos.copy(this.bones.lLeg.position);
    }
    if (this.bones.rHand) {
      this.restRHandPos.copy(this.bones.rHand.position);
      this.currentShoulderR.copy(this.restRHandPos);
    }
    if (this.bones.lHand) {
      this.restLHandPos.copy(this.bones.lHand.position);
      this.currentShoulderL.copy(this.restLHandPos);
    }
  }

  public setBones(bones: CharacterBones): void {
    this.bones = bones;
    this.recordRestPoses();
  }

  /**
   * Triggers a hilarious TABS ragdoll knockdown (e.g. tackled by another sprinting player or hard impact)
   */
  public triggerKnockdown(impulseDir: THREE.Vector3, force: number = 1.0): void {
    this.status = 'KNOCKED_DOWN';
    this.knockdownTimer = 1.4; // Lie and slide on floor
    this.getUpTimer = 0;

    // Slide across floor with physical momentum
    const hDir = new THREE.Vector2(impulseDir.x, impulseDir.z).normalize();
    const slideSpeed = THREE.MathUtils.clamp(force * 5.5, 3.0, 9.0);
    this.slideVelocity.set(hDir.x * slideSpeed, 0, hDir.y * slideSpeed);

    // Chaos impulses
    this.torsoYSpring.impulse(-3.0);
    const randSign1 = Math.random() > 0.5 ? 1 : -1;
    const randSign2 = Math.random() > 0.5 ? 1 : -1;
    this.torsoPitchSpring.impulse(randSign1 * 2.8 * force);
    this.torsoRollSpring.impulse(randSign2 * 2.8 * force);
    this.headPitchSpring.impulse(randSign1 * 3.5);
    this.rArmPitchSpring.impulse(randSign2 * 3.0);
    this.lArmPitchSpring.impulse(-randSign2 * 3.0);
  }

  /**
   * Physical recoil when a limb or body part clips an obstacle
   */
  public triggerLimbHit(limb: 'rHand' | 'lHand' | 'head' | 'torso', force: number = 1.0): void {
    const clampedForce = THREE.MathUtils.clamp(force, 0.4, 2.5);
    switch (limb) {
      case 'rHand':
        this.rArmPitchSpring.impulse(clampedForce * 3.5);
        this.rArmRollSpring.impulse(clampedForce * 1.5);
        this.torsoRollSpring.impulse(-clampedForce * 0.8);
        this.torsoYawSpring.impulse(clampedForce * 0.9);
        break;
      case 'lHand':
        this.lArmPitchSpring.impulse(clampedForce * 3.5);
        this.lArmRollSpring.impulse(-clampedForce * 1.5);
        this.torsoRollSpring.impulse(clampedForce * 0.8);
        this.torsoYawSpring.impulse(-clampedForce * 0.9);
        break;
      case 'head':
        this.headPitchSpring.impulse(-clampedForce * 3.2);
        this.torsoPitchSpring.impulse(-clampedForce * 1.2);
        break;
      case 'torso':
        this.torsoPitchSpring.impulse(-clampedForce * 2.2);
        this.torsoYSpring.impulse(-clampedForce * 0.8);
        break;
    }
  }

  /**
   * Main Physics & Procedural IK Tick
   */
  public update(state: RagdollInputState): void {
    const {
      dt,
      isMoving,
      isSprinting,
      isAirborne,
      worldMoveX,
      worldMoveZ,
      playerRotationY,
      playerWorldPos,
      obstacleSolver,
    } = state;

    this.totalTime += dt;

    // 1. Angular Velocity Calculation (centrifugal lean & turns)
    let rotDiff = playerRotationY - this.prevRotY;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    const currentRotVel = dt > 0.0001 ? rotDiff / dt : 0;
    this.rotVelocityY = THREE.MathUtils.lerp(this.rotVelocityY, currentRotVel, Math.min(1, 15 * dt));
    this.prevRotY = playerRotationY;

    // 2. Smooth Airborne Weight (eliminates abrupt snapping after landing)
    const targetAirBlend = isAirborne ? 1.0 : 0.0;
    const airBlendSpeed = isAirborne ? 14.0 : 5.5;
    this.airborneBlend = THREE.MathUtils.lerp(this.airborneBlend, targetAirBlend, Math.min(1, airBlendSpeed * dt));

    // 3. Local Movement Direction & Speed Projection
    const sinR = Math.sin(playerRotationY);
    const cosR = Math.cos(playerRotationY);
    const worldSpeed = Math.hypot(worldMoveX, worldMoveZ);
    let targetLocalFwd = 0;
    let targetLocalRight = 0;

    if (isMoving && worldSpeed > 0.001) {
      const normX = worldMoveX / worldSpeed;
      const normZ = worldMoveZ / worldSpeed;
      targetLocalFwd = -normX * sinR - normZ * cosR;
      targetLocalRight = normX * cosR - normZ * sinR;
    }

    const smoothSpeed = isMoving ? (isSprinting ? 1.0 : 0.6) : 0;
    this.localVelFwd = THREE.MathUtils.lerp(this.localVelFwd, targetLocalFwd * smoothSpeed, Math.min(1, 14 * dt));
    this.localVelRight = THREE.MathUtils.lerp(this.localVelRight, targetLocalRight * smoothSpeed, Math.min(1, 14 * dt));

    // 4. Landing Squash
    if (this.wasAirborne && !isAirborne) {
      this.torsoYSpring.impulse(-1.5);
      this.headPitchSpring.impulse(0.5);
    }
    this.wasAirborne = isAirborne;

    // 5. State Machine: Knockdown / Getting Up / Active
    if (this.status === 'KNOCKED_DOWN') {
      this.knockdownTimer -= dt;
      this.slideVelocity.multiplyScalar(Math.pow(0.15, dt));
      if (this.knockdownTimer <= 0) {
        this.status = 'GETTING_UP';
        this.getUpTimer = 1.1;
      }
      this.updateKnockdown(dt);
      return;
    } else if (this.status === 'GETTING_UP') {
      this.getUpTimer -= dt;
      if (this.getUpTimer <= 0) {
        this.status = 'ACTIVE';
      }
      this.updateGettingUp(dt);
      return;
    }

    // 6. Continuous Physical Environment Clearance & Squeeze Query
    let env: EnvironmentContext | null = null;
    if (obstacleSolver && playerWorldPos) {
      env = obstacleSolver.getCharacterEnvironmentContext(playerWorldPos, playerRotationY);
    }

    // 7. Update Gait Phase
    const strideFreq = isAirborne ? 4.5 : (isSprinting ? 9.6 : 6.8);
    if (isMoving || isAirborne) {
      this.gaitPhase += strideFreq * dt * (isMoving ? 1.0 : 0.7);
    }

    // 8. Update Active Components
    this.updateTorso(state, env);
    this.updateLegs(state, env);
    this.updateArms(state, env, obstacleSolver);
    this.updateHead(state, env);
    this.updateBoxSprings(state);
  }

  /**
   * Knockdown State: Limp ragdoll on the floor
   */
  private updateKnockdown(dt: number): void {
    if (!this.bones.torso) return;

    const curY = this.torsoYSpring.update(0.24, dt);
    this.bones.torso.position.y = curY;

    const curPitch = this.torsoPitchSpring.update(1.45, dt);
    const curRoll = this.torsoRollSpring.update(0.85, dt);
    const curYaw = this.torsoYawSpring.update(0.3, dt);
    this.bones.torso.rotation.set(curPitch, curYaw, curRoll);

    if (this.bones.rLeg && this.bones.lLeg) {
      const curRPitch = this.rLegPitchSpring.update(0.7, dt);
      const curLPitch = this.lLegPitchSpring.update(-0.5, dt);
      const curRRoll = this.rLegRollSpring.update(-0.6, dt);
      const curLRoll = this.lLegRollSpring.update(0.6, dt);
      this.bones.rLeg.rotation.set(curRPitch, 0, curRRoll);
      this.bones.lLeg.rotation.set(curLPitch, 0, curLRoll);
    }

    if (this.bones.rHand && this.bones.lHand) {
      const curRPitch = this.rArmPitchSpring.update(0.4, dt);
      const curLPitch = this.lArmPitchSpring.update(-0.6, dt);
      const curRRoll = this.rArmRollSpring.update(-0.9, dt);
      const curLRoll = this.lArmRollSpring.update(0.9, dt);
      this.bones.rHand.rotation.set(curRPitch, 0, curRRoll);
      this.bones.lHand.rotation.set(curLPitch, 0, curLRoll);
    }

    if (this.bones.head) {
      const curHeadPitch = this.headPitchSpring.update(0.7, dt);
      const curHeadRoll = this.headRollSpring.update(0.6, dt);
      this.bones.head.rotation.set(curHeadPitch, 0, curHeadRoll);
    }
  }

  /**
   * Getting Up State: Hilariously pushing up from hands and knees
   */
  private updateGettingUp(dt: number): void {
    if (!this.bones.torso) return;

    const progress = 1.0 - Math.max(0, this.getUpTimer) / 1.1;

    const targetY = THREE.MathUtils.lerp(0.55, this.restTorsoY, progress);
    const curY = this.torsoYSpring.update(targetY, dt);
    this.bones.torso.position.y = curY;

    const targetPitch = THREE.MathUtils.lerp(0.8, 0, progress);
    const targetRoll = Math.sin(this.totalTime * 8) * (1 - progress) * 0.25;
    const curPitch = this.torsoPitchSpring.update(targetPitch, dt);
    const curRoll = this.torsoRollSpring.update(targetRoll, dt);
    this.bones.torso.rotation.set(curPitch, 0, curRoll);

    if (this.bones.rHand && this.bones.lHand) {
      const pushPitch = THREE.MathUtils.lerp(-1.1, 0, progress);
      const pushRollR = THREE.MathUtils.lerp(-0.45, -0.15, progress);
      const pushRollL = THREE.MathUtils.lerp(0.45, 0.15, progress);
      this.bones.rHand.rotation.set(this.rArmPitchSpring.update(pushPitch, dt), 0, this.rArmRollSpring.update(pushRollR, dt));
      this.bones.lHand.rotation.set(this.lArmPitchSpring.update(pushPitch, dt), 0, this.lArmRollSpring.update(pushRollL, dt));
    }

    if (this.bones.rLeg && this.bones.lLeg) {
      const legScramble = Math.sin(this.totalTime * 12) * (1 - progress) * 0.35;
      this.bones.rLeg.rotation.set(this.rLegPitchSpring.update(legScramble, dt), 0, -0.1);
      this.bones.lLeg.rotation.set(this.lLegPitchSpring.update(-legScramble, dt), 0, 0.1);
    }

    if (this.bones.head) {
      const dizzyYaw = Math.sin(this.totalTime * 10) * (1 - progress) * 0.4;
      const headPitch = THREE.MathUtils.lerp(0.4, 0, progress);
      this.bones.head.rotation.set(this.headPitchSpring.update(headPitch, dt), dizzyYaw, 0);
    }
  }

  /**
   * Torso: Inverted Pendulum, Spring Suspension & Obstacle Reaction
   */
  private updateTorso(
    state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean },
    env: EnvironmentContext | null
  ): void {
    if (!this.bones.torso) return;
    const { dt, isMoving, isSprinting } = state;

    // A. Vertical Suspension
    let targetY = this.restTorsoY;
    if (this.airborneBlend > 0.05) {
      targetY += 0.09 * this.airborneBlend;
    } else if (isMoving) {
      const bobAmp = isSprinting ? 0.055 : 0.032;
      targetY += Math.sin(this.gaitPhase * 2) * bobAmp;
    } else {
      targetY += Math.sin(this.totalTime * 2.2) * 0.009;
    }

    // Squeeze compression: slightly crouch when squeezing through tight spaces
    if (env && env.squeezeFactor > 0.1) {
      targetY -= 0.04 * env.squeezeFactor;
    }

    const currentY = this.torsoYSpring.update(targetY, dt);
    this.bones.torso.position.y = currentY;

    // B. Pitch (Lean into motion + obstacle repulsion)
    let groundPitch = isMoving ? this.localVelFwd * (isSprinting ? 0.38 : 0.22) : 0;
    if (env) {
      groundPitch += env.bodyDeflectPitch; // Leans back if shelf is in front!
    }
    const airPitch = -0.18;
    const targetPitch = THREE.MathUtils.lerp(groundPitch, airPitch, this.airborneBlend);
    const currentPitch = this.torsoPitchSpring.update(targetPitch, dt);

    // C. Roll (Centrifugal bank + weight shift + side obstacle deflection)
    let groundRoll = THREE.MathUtils.clamp(-this.rotVelocityY * 0.045, -0.32, 0.32);
    groundRoll += this.localVelRight * (isSprinting ? 0.24 : 0.15);
    if (isMoving) {
      groundRoll += Math.sin(this.gaitPhase) * (isSprinting ? 0.07 : 0.04);
    } else {
      groundRoll += Math.sin(this.totalTime * 1.5) * 0.025;
    }
    if (env) {
      groundRoll += env.bodyDeflectRoll; // Tilts away from side shelves!
    }
    const targetRoll = THREE.MathUtils.lerp(groundRoll, 0, this.airborneBlend);
    const currentRoll = this.torsoRollSpring.update(targetRoll, dt);

    // D. Yaw (Pelvis counter-twist + narrow gap squeeze angle)
    let targetYaw = 0;
    if (isMoving && this.airborneBlend < 0.5) {
      targetYaw = Math.cos(this.gaitPhase) * (isSprinting ? 0.14 : 0.08);
    }
    if (env) {
      targetYaw += env.bodySqueezeYaw; // Turns shoulders sideways to slip through tight gaps!
    }
    const currentYaw = this.torsoYawSpring.update(targetYaw, dt);

    this.bones.torso.rotation.set(currentPitch, currentYaw, currentRoll);
  }

  /**
   * Procedural Gait Engine & True Leg IK with Ground Compensation
   */
  private updateLegs(
    state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean },
    env: EnvironmentContext | null
  ): void {
    if (!this.bones.rLeg || !this.bones.lLeg) return;
    const { dt, isMoving, isSprinting } = state;

    const torsoPitch = this.torsoPitchSpring.value;
    const torsoRoll = this.torsoRollSpring.value;

    let groundRPitch = -torsoPitch;
    let groundLPitch = -torsoPitch;
    let groundRRoll = -torsoRoll - 0.05;
    let groundLRoll = -torsoRoll + 0.05;
    let groundRY = this.restRLegPos.y;
    let groundLY = this.restLLegPos.y;

    if (isMoving) {
      const strideAmp = isSprinting ? 0.78 : 0.50;
      const legWave = Math.sin(this.gaitPhase);
      const fwdFactor = Math.abs(this.localVelFwd) > 0.05 ? Math.sign(this.localVelFwd) : 1;

      groundRPitch += -legWave * strideAmp * fwdFactor;
      groundLPitch += legWave * strideAmp * fwdFactor;

      if (Math.abs(this.localVelRight) > 0.05) {
        const strafeAmp = (isSprinting ? 0.35 : 0.22) * Math.sign(this.localVelRight);
        groundRRoll += legWave * strafeAmp;
        groundLRoll += legWave * strafeAmp;
      }

      // Parabolic step lift (Swing phase)
      const rSwing = Math.max(0, legWave * fwdFactor);
      const lSwing = Math.max(0, -legWave * fwdFactor);
      const stepLift = isSprinting ? 0.068 : 0.042;
      groundRY += rSwing * stepLift;
      groundLY += lSwing * stepLift;
    } else {
      const idleSway = Math.sin(this.totalTime * 1.5);
      groundRPitch += idleSway * 0.03;
      groundLPitch -= idleSway * 0.03;
      groundRRoll -= 0.02;
      groundLRoll += 0.02;
    }

    // Narrow gap step adjustment: bring feet closer together
    if (env && env.squeezeFactor > 0.1) {
      groundRRoll += 0.06 * env.squeezeFactor;
      groundLRoll -= 0.06 * env.squeezeFactor;
    }

    // Airborne targets
    const airWave = Math.sin(this.gaitPhase);
    const airRPitch = 0.35 + airWave * 0.28;
    const airLPitch = 0.35 - airWave * 0.28;
    const airRRoll = -0.2;
    const airLRoll = 0.2;
    const airRY = this.restRLegPos.y + 0.07;
    const airLY = this.restLLegPos.y + 0.07;

    const rPitchTarget = THREE.MathUtils.lerp(groundRPitch, airRPitch, this.airborneBlend);
    const lPitchTarget = THREE.MathUtils.lerp(groundLPitch, airLPitch, this.airborneBlend);
    const rRollTarget = THREE.MathUtils.lerp(groundRRoll, airRRoll, this.airborneBlend);
    const lRollTarget = THREE.MathUtils.lerp(groundLRoll, airLRoll, this.airborneBlend);
    const rYTarget = THREE.MathUtils.lerp(groundRY, airRY, this.airborneBlend);
    const lYTarget = THREE.MathUtils.lerp(groundLY, airLY, this.airborneBlend);

    const curRPitch = this.rLegPitchSpring.update(rPitchTarget, dt);
    const curRRoll = this.rLegRollSpring.update(rRollTarget, dt);
    const curLPitch = this.lLegPitchSpring.update(lPitchTarget, dt);
    const curLRoll = this.lLegRollSpring.update(lRollTarget, dt);

    this.bones.rLeg.rotation.set(curRPitch, 0, curRRoll);
    this.bones.rLeg.position.y = THREE.MathUtils.lerp(this.bones.rLeg.position.y, rYTarget, Math.min(1, 20 * dt));

    this.bones.lLeg.rotation.set(curLPitch, 0, curLRoll);
    this.bones.lLeg.position.y = THREE.MathUtils.lerp(this.bones.lLeg.position.y, lYTarget, Math.min(1, 20 * dt));
  }

  /**
   * Procedural Physical Arms:
   * Dynamic shoulder tucking against torso, arm roll hug, obstacle contouring, and hand surface IK constraints.
   */
  private updateArms(
    state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean; isHoldingBox: boolean },
    env: EnvironmentContext | null,
    obstacleSolver?: PhysicalObstacleSolver
  ): void {
    if (!this.bones.rHand || !this.bones.lHand) return;
    const { dt, isMoving, isSprinting, isHoldingBox } = state;

    if (isHoldingBox) {
      const rPitchTarget = -1.35 + this.boxOffsetPitch.value;
      const rRollTarget = -0.18 + this.boxOffsetRoll.value;
      const rYawTarget = 0.35 + this.boxOffsetYaw.value;

      const lPitchTarget = -1.35 + this.boxOffsetPitch.value;
      const lRollTarget = 0.18 - this.boxOffsetRoll.value;
      const lYawTarget = -0.35 + this.boxOffsetYaw.value;

      this.bones.rHand.rotation.set(
        this.rArmPitchSpring.update(rPitchTarget, dt),
        this.rArmYawSpring.update(rYawTarget, dt),
        this.rArmRollSpring.update(rRollTarget, dt)
      );
      this.bones.lHand.rotation.set(
        this.lArmPitchSpring.update(lPitchTarget, dt),
        this.lArmYawSpring.update(lYawTarget, dt),
        this.lArmRollSpring.update(lRollTarget, dt)
      );
      return;
    }

    const tuckR = env ? env.tuckRight : 0;
    const tuckL = env ? env.tuckLeft : 0;
    const fwdBlock = env ? env.fwdBlock : 0;
    const squeeze = env ? env.squeezeFactor : 0;

    // 1. Procedural Shoulder Compression (Shoulders pull inward towards ribs)
    // Right shoulder moves from -0.3516 to -0.17
    const targetShoulderX_R = THREE.MathUtils.lerp(this.restRHandPos.x, -0.17, Math.max(tuckR, squeeze));
    const targetShoulderZ_R = 0.05 * tuckR; // slightly moves back if dragging along shelf
    this.currentShoulderR.x = THREE.MathUtils.lerp(this.currentShoulderR.x, targetShoulderX_R, Math.min(1, 14 * dt));
    this.currentShoulderR.z = THREE.MathUtils.lerp(this.currentShoulderR.z, targetShoulderZ_R, Math.min(1, 14 * dt));
    this.bones.rHand.position.x = this.currentShoulderR.x;
    this.bones.rHand.position.z = this.currentShoulderR.z;

    // Left shoulder moves from +0.3516 to +0.17
    const targetShoulderX_L = THREE.MathUtils.lerp(this.restLHandPos.x, 0.17, Math.max(tuckL, squeeze));
    const targetShoulderZ_L = 0.05 * tuckL;
    this.currentShoulderL.x = THREE.MathUtils.lerp(this.currentShoulderL.x, targetShoulderX_L, Math.min(1, 14 * dt));
    this.currentShoulderL.z = THREE.MathUtils.lerp(this.currentShoulderL.z, targetShoulderZ_L, Math.min(1, 14 * dt));
    this.bones.lHand.position.x = this.currentShoulderL.x;
    this.bones.lHand.position.z = this.currentShoulderL.z;

    // 2. Base Ground Targets (Pendulum swing)
    const torsoPitch = this.torsoPitchSpring.value;
    let groundRPitch = -torsoPitch * 0.75;
    let groundLPitch = -torsoPitch * 0.75;
    let groundRRoll = -0.15;
    let groundLRoll = 0.15;
    let groundRYaw = 0;
    let groundLYaw = 0;

    if (isMoving) {
      // Natural swing amplitude is squashed when tucked or squeezing
      const swingMultiplierR = Math.max(0.05, 1 - tuckR * 0.95 - squeeze * 0.8);
      const swingMultiplierL = Math.max(0.05, 1 - tuckL * 0.95 - squeeze * 0.8);

      const armSwingAmp = isSprinting ? 0.95 : 0.55;
      const armWave = Math.sin(this.gaitPhase);
      groundRPitch += armWave * armSwingAmp * swingMultiplierR;
      groundLPitch -= armWave * armSwingAmp * swingMultiplierL;

      const centrifugalSpread = Math.abs(this.rotVelocityY) * 0.085;
      groundRRoll -= centrifugalSpread * swingMultiplierR;
      groundLRoll += centrifugalSpread * swingMultiplierL;

      groundRYaw = THREE.MathUtils.clamp(this.rotVelocityY * 0.04, -0.3, 0.3);
      groundLYaw = THREE.MathUtils.clamp(this.rotVelocityY * 0.04, -0.3, 0.3);

      // Trailing arm along shelf: if moving forward and tucked, arm naturally trails back
      if (tuckR > 0.25 && this.localVelFwd > 0.1) {
        groundRPitch += 0.55 * tuckR; // Arm bends back as it brushes along shelf
      }
      if (tuckL > 0.25 && this.localVelFwd > 0.1) {
        groundLPitch += 0.55 * tuckL;
      }
    } else {
      const idleArm = Math.sin(this.totalTime * 1.8) * 0.04;
      groundRPitch += idleArm;
      groundLPitch -= idleArm;
    }

    // 3. Procedural Arm Inward Tuck (Hugs ribs/waist)
    // Right arm rolls inward: -0.15 -> +0.35 rad
    groundRRoll = THREE.MathUtils.lerp(groundRRoll, 0.35, Math.max(tuckR, squeeze));
    // Left arm rolls inward: +0.15 -> -0.35 rad
    groundLRoll = THREE.MathUtils.lerp(groundLRoll, -0.35, Math.max(tuckL, squeeze));

    // 4. Frontal Obstacle Reaction (Raise hands defensively / clamp forward swing)
    if (fwdBlock > 0.15) {
      // Clamps forward pitch and brings hands up toward chest
      groundRPitch = THREE.MathUtils.lerp(groundRPitch, -0.72, fwdBlock);
      groundLPitch = THREE.MathUtils.lerp(groundLPitch, -0.72, fwdBlock);
      groundRYaw += 0.22 * fwdBlock;
      groundLYaw -= 0.22 * fwdBlock;
      groundRRoll = THREE.MathUtils.lerp(groundRRoll, -0.25, fwdBlock);
      groundLRoll = THREE.MathUtils.lerp(groundLRoll, 0.25, fwdBlock);
    }

    // 5. Airborne Panic Flail Targets
    const panicTime = this.totalTime * 14;
    const airPitch = -2.35 + Math.sin(panicTime) * 0.35;
    const airRRoll = -0.75 - Math.cos(panicTime * 1.1) * 0.3;
    const airLRoll = 0.75 + Math.cos(panicTime * 1.1 + 0.5) * 0.3;
    const airRYaw = Math.sin(panicTime * 0.8) * 0.35;
    const airLYaw = -Math.sin(panicTime * 0.8) * 0.35;

    // 6. Smooth Airborne Blending
    const rPitchTarget = THREE.MathUtils.lerp(groundRPitch, airPitch, this.airborneBlend);
    const lPitchTarget = THREE.MathUtils.lerp(groundLPitch, airPitch, this.airborneBlend);
    const rRollTarget = THREE.MathUtils.lerp(groundRRoll, airRRoll, this.airborneBlend);
    const lRollTarget = THREE.MathUtils.lerp(groundLRoll, airLRoll, this.airborneBlend);
    const rYawTarget = THREE.MathUtils.lerp(groundRYaw, airRYaw, this.airborneBlend);
    const lYawTarget = THREE.MathUtils.lerp(groundLYaw, airLYaw, this.airborneBlend);

    const curRPitch = this.rArmPitchSpring.update(rPitchTarget, dt);
    const curRRoll = this.rArmRollSpring.update(rRollTarget, dt);
    const curRYaw = this.rArmYawSpring.update(rYawTarget, dt);

    const curLPitch = this.lArmPitchSpring.update(lPitchTarget, dt);
    const curLRoll = this.lArmRollSpring.update(lRollTarget, dt);
    const curLYaw = this.lArmYawSpring.update(lYawTarget, dt);

    this.bones.rHand.rotation.set(curRPitch, curRYaw, curRRoll);
    this.bones.lHand.rotation.set(curLPitch, curLYaw, curLRoll);

    // 7. World-Space Hand Surface Non-Penetration IK Constraint
    // If hand penetrates or brushes obstacle, push hand to obstacle surface!
    if (obstacleSolver && this.bones.torso) {
      this.bones.torso.updateMatrixWorld(true);

      const torsoQuatWorld = this.bones.torso.getWorldQuaternion(this.tempQuatA);
      const invTorsoQuat = this.tempQuatB.copy(torsoQuatWorld).invert();

      // Constrain Right Hand
      const rShoulderWorld = this.bones.rHand.getWorldPosition(this.tempVecA);
      const rTipWorld = this.tempVecB.copy(ActiveRagdollController.TIP_LOCAL_OFFSET);
      this.bones.rHand.localToWorld(rTipWorld);

      const constrainedTip_R = obstacleSolver.constrainHandToEnvironment(rShoulderWorld, rTipWorld, 0.12);
      if (constrainedTip_R !== rTipWorld) {
        // Arm direction required to touch surface point
        const targetDirWorld = this.tempVecC.subVectors(constrainedTip_R, rShoulderWorld).normalize();
        const targetDirTorso = targetDirWorld.applyQuaternion(invTorsoQuat);
        this.bones.rHand.quaternion.setFromUnitVectors(ActiveRagdollController.REST_ARM_DIR, targetDirTorso);
      }

      // Constrain Left Hand
      const lShoulderWorld = this.bones.lHand.getWorldPosition(this.tempVecA);
      const lTipWorld = this.tempVecB.copy(ActiveRagdollController.TIP_LOCAL_OFFSET);
      this.bones.lHand.localToWorld(lTipWorld);

      const constrainedTip_L = obstacleSolver.constrainHandToEnvironment(lShoulderWorld, lTipWorld, 0.12);
      if (constrainedTip_L !== lTipWorld) {
        const targetDirWorld = this.tempVecC.subVectors(constrainedTip_L, lShoulderWorld).normalize();
        const targetDirTorso = targetDirWorld.applyQuaternion(invTorsoQuat);
        this.bones.lHand.quaternion.setFromUnitVectors(ActiveRagdollController.REST_ARM_DIR, targetDirTorso);
      }
    }
  }

  /**
   * Head Dynamics & Obstacle Awareness
   */
  private updateHead(
    state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean },
    env: EnvironmentContext | null
  ): void {
    if (!this.bones.head) return;
    const { dt, isMoving, isSprinting } = state;
    const torsoPitch = this.torsoPitchSpring.value;

    let targetPitch = -torsoPitch * 0.5;
    let targetRoll = 0;
    let targetYaw = 0;

    if (this.airborneBlend > 0.1) {
      targetPitch += 0.3 * this.airborneBlend;
      targetRoll = Math.sin(this.totalTime * 8) * 0.1 * this.airborneBlend;
    } else if (isMoving) {
      targetPitch += isSprinting ? 0.12 : 0.04;
      targetPitch += Math.sin(this.gaitPhase * 2) * (isSprinting ? 0.05 : 0.025);
      targetYaw = THREE.MathUtils.clamp(-this.rotVelocityY * 0.03, -0.25, 0.25);
      targetRoll = THREE.MathUtils.clamp(this.rotVelocityY * 0.02, -0.15, 0.15);
    } else {
      targetPitch += Math.sin(this.totalTime * 1.2) * 0.03;
      targetRoll = Math.sin(this.totalTime * 0.8) * 0.04;
    }

    // Tucks head slightly when squeezing
    if (env && env.squeezeFactor > 0.15) {
      targetPitch += 0.18 * env.squeezeFactor;
    }

    const curPitch = this.headPitchSpring.update(targetPitch, dt);
    const curRoll = this.headRollSpring.update(targetRoll, dt);
    const curYaw = this.headYawSpring.update(targetYaw, dt);

    this.bones.head.rotation.set(curPitch, curYaw, curRoll);
  }

  /**
   * Held Box Springs
   */
  private updateBoxSprings(state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean }): void {
    const { dt, isMoving, isSprinting, isAirborne } = state;

    const targetBoxYaw = THREE.MathUtils.clamp(-this.rotVelocityY * 0.05, -0.45, 0.45);
    this.boxOffsetYaw.update(targetBoxYaw, dt);

    const targetBoxRoll = THREE.MathUtils.clamp(this.rotVelocityY * 0.03, -0.3, 0.3);
    this.boxOffsetRoll.update(targetBoxRoll, dt);

    let targetBoxPitch = 0;
    if (isMoving) {
      targetBoxPitch = Math.sin(this.gaitPhase * 2) * (isSprinting ? 0.12 : 0.06);
    }
    this.boxOffsetPitch.update(targetBoxPitch, dt);

    let targetBoxY = 0;
    if (isAirborne) {
      targetBoxY = 0.08;
    } else if (isMoving) {
      targetBoxY = Math.sin(this.gaitPhase * 2) * (isSprinting ? 0.04 : 0.02);
    }
    this.boxOffsetY.update(targetBoxY, dt);
  }
}
