import * as THREE from 'three';

/**
 * Second-Order Dynamics / Spring-Damper exact analytical numerical solver.
 * Uses closed-form solution of damped harmonic oscillator (Ryan Juckett formulation).
 * 100% unconditionally stable for any delta time and oscillation frequency (never blows up or NaNs).
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
    if (dt <= 0) return this.value;
    const clampedDt = Math.min(dt, 0.1);
    const omega = 2 * Math.PI * this.frequency;
    const zeta = this.damping;

    if (zeta < 1.0) {
      // Underdamped regime
      const omegaD = omega * Math.sqrt(1.0 - zeta * zeta);
      const decay = Math.exp(-zeta * omega * clampedDt);
      const sinTerm = Math.sin(omegaD * clampedDt);
      const cosTerm = Math.cos(omegaD * clampedDt);

      const deltaX = this.value - target;
      const c2 = sinTerm / omegaD;
      const c1 = cosTerm + zeta * omega * c2;

      this.value = target + decay * (deltaX * c1 + this.velocity * c2);
      this.velocity = decay * (this.velocity * (cosTerm - zeta * omega * c2) - deltaX * (omega * omega * c2));
    } else if (zeta === 1.0) {
      // Critically damped regime
      const decay = Math.exp(-omega * clampedDt);
      const deltaX = this.value - target;
      this.value = target + decay * (deltaX + (this.velocity + omega * deltaX) * clampedDt);
      this.velocity = decay * (this.velocity * (1.0 - omega * clampedDt) - deltaX * (omega * omega * clampedDt));
    } else {
      // Overdamped regime
      const omegaD = omega * Math.sqrt(zeta * zeta - 1.0);
      const decay = Math.exp(-zeta * omega * clampedDt);
      const sinhTerm = Math.sinh(omegaD * clampedDt);
      const coshTerm = Math.cosh(omegaD * clampedDt);

      const deltaX = this.value - target;
      const c2 = sinhTerm / omegaD;
      const c1 = coshTerm + zeta * omega * c2;

      this.value = target + decay * (deltaX * c1 + this.velocity * c2);
      this.velocity = decay * (this.velocity * (coshTerm - zeta * omega * c2) - deltaX * (omega * omega * c2));
    }

    if (isNaN(this.value) || !isFinite(this.value)) {
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
  targetAimY?: number;
}

export type RagdollStatus = 'ACTIVE' | 'KNOCKED_DOWN' | 'GETTING_UP';

/**
 * ActiveRagdollController
 *
 * Fully procedural physical animation and deformation system inspired by TABS, Human: Fall Flat, and Gang Beasts.
 * Directly drives character body parts (Torso, Head, R_Leg, L_Leg, R_Hand, L_Hand) with:
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
  public recoveryTimer: number = 0;
  public slideVelocity: THREE.Vector3 = new THREE.Vector3();

  // Continuous Locomotion Blending Parameters (Smooth Idle <-> Walk <-> Sprint)
  public moveWeight: number = 0;
  public sprintWeight: number = 0;
  public boxHoldBlend: number = 0;
  private prevHoldingBox: boolean = false;

  // Smooth Airborne Transition Blend (0 = ground, 1 = airborne)
  private airborneBlend: number = 0;

  // Landing Shock Absorption & Knee Cushioning Spring
  public landingSquashSpring: SpringDamper = new SpringDamper(0, 14, 0.68);

  // Braking / Deceleration detection
  private prevLocalVelFwd: number = 0;
  private brakingAmount: number = 0;

  // Base rest transforms recorded from initial model bind pose
  private restTorsoY: number = 1.25;
  private restHeadY: number = 0.125;
  private restRLegPos: THREE.Vector3 = new THREE.Vector3(-0.1875, -0.508, 0);
  private restLLegPos: THREE.Vector3 = new THREE.Vector3(0.1875, -0.508, 0);
  private restRHandPos: THREE.Vector3 = new THREE.Vector3(-0.3516, 0.07, 0);
  private restLHandPos: THREE.Vector3 = new THREE.Vector3(0.3516, 0.07, 0);

  // Torso Dynamics Springs
  public torsoYSpring: SpringDamper = new SpringDamper(1.25, 11, 0.62);
  public torsoPitchSpring: SpringDamper = new SpringDamper(0, 10, 0.62);
  public torsoRollSpring: SpringDamper = new SpringDamper(0, 10, 0.62);
  public torsoYawSpring: SpringDamper = new SpringDamper(0, 12, 0.7);

  // Head Dynamics Springs
  public headPitchSpring: SpringDamper = new SpringDamper(0, 14, 0.65);
  public headRollSpring: SpringDamper = new SpringDamper(0, 13, 0.65);
  public headYawSpring: SpringDamper = new SpringDamper(0, 15, 0.72);

  // Arms Springs (Silky smooth, critically damped to completely eliminate jitter)
  public rArmPitchSpring: SpringDamper = new SpringDamper(0, 9, 0.86);
  public rArmRollSpring: SpringDamper = new SpringDamper(-0.15, 9, 0.86);
  public rArmYawSpring: SpringDamper = new SpringDamper(0, 9, 0.88);

  public lArmPitchSpring: SpringDamper = new SpringDamper(0, 9, 0.86);
  public lArmRollSpring: SpringDamper = new SpringDamper(0.15, 9, 0.86);
  public lArmYawSpring: SpringDamper = new SpringDamper(0, 9, 0.88);

  // Held Box Momentum Lag Springs (Smooth & stable)
  public boxOffsetPitch: SpringDamper = new SpringDamper(0, 10, 0.82);
  public boxOffsetYaw: SpringDamper = new SpringDamper(0, 10, 0.82);
  public boxOffsetRoll: SpringDamper = new SpringDamper(0, 10, 0.82);
  public boxOffsetY: SpringDamper = new SpringDamper(0, 12, 0.85);

  // Legs Dynamics Springs (Crisp & snappy for visible high stepping)
  public rLegPitchSpring: SpringDamper = new SpringDamper(0, 22, 0.74);
  public rLegRollSpring: SpringDamper = new SpringDamper(-0.05, 20, 0.74);
  public rLegYawSpring: SpringDamper = new SpringDamper(0, 22, 0.75);
  public lLegPitchSpring: SpringDamper = new SpringDamper(0, 22, 0.74);
  public lLegRollSpring: SpringDamper = new SpringDamper(0.05, 20, 0.74);
  public lLegYawSpring: SpringDamper = new SpringDamper(0, 22, 0.75);

  // Procedural Turn-In-Place Stepping Engine (Rhythmic, natural, physical alternating foot shuffle)
  public isTurnStepping: boolean = false;
  public turnGaitPhase: number = 0;
  public turnStepDir: number = 1; // +1 = left, -1 = right
  public currentBodyRotationY: number = 0;

  // Gait Engine State
  private gaitPhase: number = 0;
  private totalTime: number = 0;
  private prevRotY: number = 0;
  private hasInitializedRot: boolean = false;
  private rotVelocityY: number = 0;
  private wasAirborne: boolean = false;
  private localVelFwd: number = 0;
  private localVelRight: number = 0;

  constructor(bones: CharacterBones) {
    this.bones = bones;
    this.recordRestPoses();
  }

  private recordRestPoses(): void {
    if (this.bones.torso) {
      this.restTorsoY = this.bones.torso.position.y || 1.25;
      this.bones.torso.rotation.order = 'XYZ';
      this.torsoYSpring.reset(this.restTorsoY);
      this.torsoPitchSpring.reset(0);
      this.torsoRollSpring.reset(0);
      this.torsoYawSpring.reset(0);
    }
    if (this.bones.head) {
      this.restHeadY = this.bones.head.position.y || 0.125;
      this.bones.head.rotation.order = 'XYZ';
      this.headPitchSpring.reset(0);
      this.headRollSpring.reset(0);
      this.headYawSpring.reset(0);
    }
    if (this.bones.rLeg) {
      this.restRLegPos.copy(this.bones.rLeg.position);
      this.bones.rLeg.rotation.order = 'XYZ';
      this.rLegPitchSpring.reset(0);
      this.rLegRollSpring.reset(-0.05);
      this.rLegYawSpring.reset(0);
    }
    if (this.bones.lLeg) {
      this.restLLegPos.copy(this.bones.lLeg.position);
      this.bones.lLeg.rotation.order = 'XYZ';
      this.lLegPitchSpring.reset(0);
      this.lLegRollSpring.reset(0.05);
      this.lLegYawSpring.reset(0);
    }
    if (this.bones.rHand) {
      this.restRHandPos.copy(this.bones.rHand.position);
      this.bones.rHand.rotation.order = 'XYZ';
      this.bones.rHand.position.copy(this.restRHandPos);
      this.rArmPitchSpring.reset(0);
      this.rArmRollSpring.reset(-0.15);
      this.rArmYawSpring.reset(0);
    }
    if (this.bones.lHand) {
      this.restLHandPos.copy(this.bones.lHand.position);
      this.bones.lHand.rotation.order = 'XYZ';
      this.bones.lHand.position.copy(this.restLHandPos);
      this.lArmPitchSpring.reset(0);
      this.lArmRollSpring.reset(0.15);
      this.lArmYawSpring.reset(0);
    }
    this.landingSquashSpring.reset(0);
  }

  public setBones(bones: CharacterBones): void {
    this.bones = bones;
    this.recordRestPoses();
  }

  /**
   * Triggers a hilarious TABS ragdoll knockdown (e.g. tackled by another sprinting player or hard impact)
   */
  public triggerKnockdown(impulseDir: THREE.Vector3, force: number = 1.0, duration: number = 3.0): void {
    this.status = 'KNOCKED_DOWN';
    this.knockdownTimer = duration; // Lie and slide on floor (stun period)
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
      isHoldingBox,
    } = state;

    this.totalTime += dt;

    // 1. Angular Velocity Calculation (centrifugal lean & turns) with continuous deadzone to eliminate mouse jitter
    if (!this.hasInitializedRot) {
      this.prevRotY = playerRotationY;
      this.currentBodyRotationY = playerRotationY;
      this.hasInitializedRot = true;
    }
    let rotDiff = playerRotationY - this.prevRotY;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    const rawRotVel = dt > 0.0001 ? rotDiff / dt : 0;
    const currentRotVel = THREE.MathUtils.clamp(rawRotVel, -15, 15);
    // Continuous deadzone: eliminates abrupt step at threshold
    const rotAbs = Math.abs(currentRotVel);
    const filteredRotVel = rotAbs > 0.15 ? Math.sign(currentRotVel) * (rotAbs - 0.15) : 0;
    this.rotVelocityY = THREE.MathUtils.lerp(this.rotVelocityY, filteredRotVel, Math.min(1, 14 * dt));
    this.prevRotY = playerRotationY;

    this.currentBodyRotationY = playerRotationY;

    // Procedural Turn-In-Place Stepping Engine (Rhythmic, natural, physical alternating foot shuffle)
    if (isMoving || isAirborne) {
      this.isTurnStepping = false;
      this.turnGaitPhase = 0;
    } else {
      let aimDiff = 0;
      if (state.targetAimY !== undefined) {
        aimDiff = state.targetAimY - playerRotationY;
        while (aimDiff < -Math.PI) aimDiff += Math.PI * 2;
        while (aimDiff > Math.PI) aimDiff -= Math.PI * 2;
      }

      if (!this.isTurnStepping) {
        // Trigger stepping if angle difference > 0.12 rad (~7 deg) or turning fast
        if (Math.abs(aimDiff) > 0.12 || Math.abs(this.rotVelocityY) > 0.35) {
          this.isTurnStepping = true;
          this.turnStepDir = Math.sign(aimDiff !== 0 ? aimDiff : this.rotVelocityY) || 1;
          this.turnGaitPhase = 0;
        }
      }

      if (this.isTurnStepping) {
        const prevPhase = this.turnGaitPhase;
        // Step frequency ~10.5 rad/s (approx 3.3 steps per second)
        this.turnGaitPhase += 10.5 * dt;

        const prevStepIdx = Math.floor(prevPhase / Math.PI);
        const curStepIdx = Math.floor(this.turnGaitPhase / Math.PI);

        // Half-cycle boundary: a foot has completed its swing and struck the floor
        if (curStepIdx > prevStepIdx) {
          // Foot landing knee-cushion impulse
          this.landingSquashSpring.impulse(0.8);
          this.torsoYSpring.impulse(-0.35);

          // Check if another step is needed
          if (Math.abs(aimDiff) > 0.10 || Math.abs(this.rotVelocityY) > 0.25) {
            this.turnStepDir = Math.sign(aimDiff !== 0 ? aimDiff : this.rotVelocityY) || 1;
          } else {
            // Turn complete: clean landing on both feet
            this.isTurnStepping = false;
            this.turnGaitPhase = 0;
          }
        }
      }
    }

    // 2. Continuous Locomotion Blending Parameters (Smooth Idle <-> Walk <-> Sprint)
    const targetMoveWeight = isMoving ? 1.0 : 0.0;
    const moveRate = isMoving ? 14.0 : 7.0; // Responsive start, physical gradual deceleration
    this.moveWeight = THREE.MathUtils.lerp(this.moveWeight, targetMoveWeight, Math.min(1, moveRate * dt));

    const targetSprintWeight = (isMoving && isSprinting) ? 1.0 : 0.0;
    this.sprintWeight = THREE.MathUtils.lerp(this.sprintWeight, targetSprintWeight, Math.min(1, 9.0 * dt));

    // 3. Smooth Box Holding Blend & Weight Impulses
    const targetBoxHold = isHoldingBox ? 1.0 : 0.0;
    this.boxHoldBlend = THREE.MathUtils.lerp(this.boxHoldBlend, targetBoxHold, Math.min(1, 11.0 * dt));

    if (!this.prevHoldingBox && isHoldingBox) {
      // Picked up heavy box: torso dips under weight, hands take the load
      this.torsoYSpring.impulse(-0.8);
      this.torsoPitchSpring.impulse(0.25);
    } else if (this.prevHoldingBox && !isHoldingBox) {
      // Released box: torso springs up
      this.torsoYSpring.impulse(0.5);
      this.torsoPitchSpring.impulse(-0.18);
    }
    this.prevHoldingBox = isHoldingBox;

    // 4. Smooth Airborne Weight (eliminates abrupt snapping after landing)
    const targetAirBlend = isAirborne ? 1.0 : 0.0;
    const airBlendSpeed = isAirborne ? 12.0 : 5.0;
    this.airborneBlend = THREE.MathUtils.lerp(this.airborneBlend, targetAirBlend, Math.min(1, airBlendSpeed * dt));

    // 5. Local Movement Direction & Speed Projection
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

    const targetSpeedNorm = isMoving ? (isSprinting ? 1.0 : 0.6) : 0;
    this.localVelFwd = THREE.MathUtils.lerp(this.localVelFwd, targetLocalFwd * targetSpeedNorm, Math.min(1, 14 * dt));
    this.localVelRight = THREE.MathUtils.lerp(this.localVelRight, targetLocalRight * targetSpeedNorm, Math.min(1, 14 * dt));

    // Smooth braking / deceleration detection
    const velDiff = this.localVelFwd - this.prevLocalVelFwd;
    this.prevLocalVelFwd = this.localVelFwd;
    const decelRate = dt > 0.001 ? -velDiff / dt : 0;
    const rawBraking = (this.localVelFwd > 0.1 && decelRate > 1.2)
      ? THREE.MathUtils.clamp((decelRate - 1.2) * 0.08, 0, 0.5)
      : 0;
    this.brakingAmount = THREE.MathUtils.lerp(this.brakingAmount, rawBraking, Math.min(1, 8 * dt));

    // 6. Landing Shock Absorption & Knee Cushioning (pure continuous spring impulse, zero pop)
    if (this.wasAirborne && !isAirborne) {
      this.landingSquashSpring.impulse(3.5);
      this.torsoYSpring.impulse(-1.6);
      this.headPitchSpring.impulse(0.5);
      const armImpulse = 0.8 * (1.0 - 0.8 * this.boxHoldBlend);
      this.rArmPitchSpring.impulse(armImpulse);
      this.lArmPitchSpring.impulse(armImpulse);
    }
    this.wasAirborne = isAirborne;
    this.landingSquashSpring.update(0, dt);

    // 7. State Machine: Knockdown / Getting Up / Active
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
        this.recoveryTimer = 0.35;
      }
      this.updateGettingUp(dt);
      return;
    }

    if (this.recoveryTimer > 0) {
      this.recoveryTimer -= dt;
    }

    // 8. Update Gait Phase continuously based on effective speed or turn-in-place
    // 8. Update Locomotion Gait Phase based on movement speed
    const baseStrideFreq = 6.6 + 3.0 * this.sprintWeight;
    const effectiveStrideFreq = isAirborne ? 4.2 : baseStrideFreq * (0.25 + 0.75 * this.moveWeight);

    if (this.moveWeight > 0.01 || isAirborne) {
      this.gaitPhase += effectiveStrideFreq * dt;
    }

    // 9. Update Active Components (Clean Procedural Physics)
    this.updateTorso(state);
    this.updateLegs(state);
    this.updateArms(state);
    this.updateHead(state);
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
      const curRYaw = this.rLegYawSpring.update(0, dt);
      const curLYaw = this.lLegYawSpring.update(0, dt);
      this.bones.rLeg.rotation.set(curRPitch, curRYaw, curRRoll);
      this.bones.lLeg.rotation.set(curLPitch, curLYaw, curLRoll);
      this.bones.rLeg.position.y = THREE.MathUtils.lerp(this.bones.rLeg.position.y, this.restRLegPos.y, Math.min(1, 15 * dt));
      this.bones.lLeg.position.y = THREE.MathUtils.lerp(this.bones.lLeg.position.y, this.restLLegPos.y, Math.min(1, 15 * dt));
    }

    if (this.bones.rHand && this.bones.lHand) {
      const curRPitch = this.rArmPitchSpring.update(0.4, dt);
      const curLPitch = this.lArmPitchSpring.update(-0.6, dt);
      const curRRoll = this.rArmRollSpring.update(-0.9, dt);
      const curLRoll = this.lArmRollSpring.update(0.9, dt);
      const curRYaw = this.rArmYawSpring.update(0, dt);
      const curLYaw = this.lArmYawSpring.update(0, dt);
      this.bones.rHand.rotation.set(curRPitch, curRYaw, curRRoll);
      this.bones.lHand.rotation.set(curLPitch, curLYaw, curLRoll);
    }

    if (this.bones.head) {
      const curHeadPitch = this.headPitchSpring.update(0.7, dt);
      const curHeadRoll = this.headRollSpring.update(0.6, dt);
      const curHeadYaw = this.headYawSpring.update(0, dt);
      this.bones.head.rotation.set(curHeadPitch, curHeadYaw, curHeadRoll);
    }
  }

  /**
   * Getting Up State: Hilariously pushing up from hands and knees with smooth handover
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
    const curYaw = this.torsoYawSpring.update(0, dt);
    this.bones.torso.rotation.set(curPitch, curYaw, curRoll);

    if (this.bones.rHand && this.bones.lHand) {
      const pushPitch = THREE.MathUtils.lerp(-1.1, 0, progress);
      const pushRollR = THREE.MathUtils.lerp(-0.45, -0.15, progress);
      const pushRollL = THREE.MathUtils.lerp(0.45, 0.15, progress);
      const curRPitch = this.rArmPitchSpring.update(pushPitch, dt);
      const curLPitch = this.lArmPitchSpring.update(pushPitch, dt);
      const curRRoll = this.rArmRollSpring.update(pushRollR, dt);
      const curLRoll = this.lArmRollSpring.update(pushRollL, dt);
      const curRYaw = this.rArmYawSpring.update(0, dt);
      const curLYaw = this.lArmYawSpring.update(0, dt);
      this.bones.rHand.rotation.set(curRPitch, curRYaw, curRRoll);
      this.bones.lHand.rotation.set(curLPitch, curLYaw, curLRoll);
    }

    if (this.bones.rLeg && this.bones.lLeg) {
      const legScramble = Math.sin(this.totalTime * 12) * (1 - progress) * 0.35;
      const targetRollR = THREE.MathUtils.lerp(-0.35, -0.05, progress);
      const targetRollL = THREE.MathUtils.lerp(0.35, 0.05, progress);
      const curRPitch = this.rLegPitchSpring.update(legScramble, dt);
      const curLPitch = this.lLegPitchSpring.update(-legScramble, dt);
      const curRRoll = this.rLegRollSpring.update(targetRollR, dt);
      const curLRoll = this.lLegRollSpring.update(targetRollL, dt);
      const curRYaw = this.rLegYawSpring.update(0, dt);
      const curLYaw = this.lLegYawSpring.update(0, dt);
      this.bones.rLeg.rotation.set(curRPitch, curRYaw, curRRoll);
      this.bones.lLeg.rotation.set(curLPitch, curLYaw, curLRoll);
      this.bones.rLeg.position.y = THREE.MathUtils.lerp(this.bones.rLeg.position.y, this.restRLegPos.y, Math.min(1, 15 * dt));
      this.bones.lLeg.position.y = THREE.MathUtils.lerp(this.bones.lLeg.position.y, this.restLLegPos.y, Math.min(1, 15 * dt));
    }

    if (this.bones.head) {
      const dizzyYaw = Math.sin(this.totalTime * 10) * (1 - progress) * 0.4;
      const headPitch = THREE.MathUtils.lerp(0.4, 0, progress);
      const curHeadPitch = this.headPitchSpring.update(headPitch, dt);
      const curHeadYaw = this.headYawSpring.update(dizzyYaw, dt);
      const curHeadRoll = this.headRollSpring.update(0, dt);
      this.bones.head.rotation.set(curHeadPitch, curHeadYaw, curHeadRoll);
    }
  }

  /**
   * Torso: Inverted Pendulum, Spring Suspension & Procedural Physics
   */
  private updateTorso(state: RagdollInputState): void {
    if (!this.bones.torso) return;
    const { dt } = state;

    // A. Vertical Suspension
    let targetY = this.restTorsoY;

    // Locomotion vertical bobbing (scales smoothly with moveWeight)
    const bobAmp = 0.028 + 0.026 * this.sprintWeight;
    targetY += Math.sin(this.gaitPhase * 2) * bobAmp * this.moveWeight;

    // Turn-in-place vertical step bob
    if (this.isTurnStepping) {
      const localPhase = this.turnGaitPhase % Math.PI;
      const liftArc = Math.sin(localPhase);
      targetY += liftArc * 0.025 - 0.008;
    }

    // Idle breathing when stationary
    const idleWeight = 1.0 - this.moveWeight;
    targetY += Math.sin(this.totalTime * 2.0) * 0.008 * idleWeight;

    // Box load compression: knees and spine slightly flex under heavy package weight
    targetY -= 0.035 * this.boxHoldBlend;

    // Landing squash: deep cushioning on impact
    const squash = this.landingSquashSpring.value;
    targetY -= squash * 0.12;

    // Airborne elevation
    targetY += 0.08 * this.airborneBlend;

    const currentY = this.torsoYSpring.update(targetY, dt);
    this.bones.torso.position.y = currentY;

    // B. Pitch (Lean into motion + braking recoil + box counterbalance)
    // Forward lean:
    let groundPitch = this.localVelFwd * (0.20 + 0.16 * this.sprintWeight) * this.moveWeight;
    // Braking recoil: leans backward to absorb momentum when stopping
    groundPitch -= this.brakingAmount * 0.22;
    // Heavy box counterbalance: leans back slightly to support weight in front
    groundPitch -= 0.09 * this.boxHoldBlend;
    // Landing impact flex: torso folds slightly forward
    groundPitch += squash * 0.15;

    const airPitch = -0.16;
    const targetPitch = THREE.MathUtils.lerp(groundPitch, airPitch, this.airborneBlend);
    const currentPitch = this.torsoPitchSpring.update(targetPitch, dt);

    // C. Roll (Centrifugal bank + weight shift)
    // Banking into turns (centrifugal):
    let groundRoll = THREE.MathUtils.clamp(-this.rotVelocityY * (0.042 + 0.018 * this.sprintWeight), -0.32, 0.32);
    // Strafe lean:
    groundRoll += this.localVelRight * (0.16 + 0.08 * this.sprintWeight) * this.moveWeight;
    // Bipedal weight shift (pelvis leans towards stance foot):
    groundRoll += Math.sin(this.gaitPhase) * (0.035 + 0.035 * this.sprintWeight) * this.moveWeight;
    // Pelvis roll weight shift during turn-in-place:
    if (this.isTurnStepping) {
      const localPhase = this.turnGaitPhase % Math.PI;
      const stepIdx = Math.floor(this.turnGaitPhase / Math.PI);
      const liftArc = Math.sin(localPhase);
      const isRightSwing = (this.turnStepDir < 0) ? (stepIdx % 2 === 0) : (stepIdx % 2 === 1);
      // Lean towards the stance foot supporting the body
      groundRoll += (isRightSwing ? 0.06 : -0.06) * liftArc;
    }
    // Idle gentle sway:
    groundRoll += Math.sin(this.totalTime * 1.5) * 0.02 * idleWeight;
    // Box dynamic roll inertia:
    groundRoll += this.boxOffsetRoll.value * 0.4 * this.boxHoldBlend;

    const targetRoll = THREE.MathUtils.lerp(groundRoll, 0, this.airborneBlend);
    const currentRoll = this.torsoRollSpring.update(targetRoll, dt);

    // D. Yaw (Pelvis counter-twist)
    let targetYaw = 0;
    // Pelvis counter-twist during walking/sprinting:
    targetYaw += Math.cos(this.gaitPhase) * (0.08 + 0.06 * this.sprintWeight) * this.moveWeight;
    // Upper body turn anticipation during turn-in-place:
    if (this.isTurnStepping) {
      const localPhase = this.turnGaitPhase % Math.PI;
      const liftArc = Math.sin(localPhase);
      targetYaw += liftArc * 0.10 * this.turnStepDir;
    }
    // Box yaw momentum:
    targetYaw += this.boxOffsetYaw.value * 0.35 * this.boxHoldBlend;

    const targetYawAir = 0;
    const finalTargetYaw = THREE.MathUtils.lerp(targetYaw, targetYawAir, this.airborneBlend);
    const currentYaw = this.torsoYawSpring.update(finalTargetYaw, dt);

    this.bones.torso.rotation.set(currentPitch, currentYaw, currentRoll);
  }

  /**
   * Procedural Gait Engine & True Leg IK with Ground Compensation
   */
  private updateLegs(state: RagdollInputState): void {
    if (!this.bones.rLeg || !this.bones.lLeg) return;
    const { dt } = state;

    const torsoPitch = this.torsoPitchSpring.value;
    const torsoRoll = this.torsoRollSpring.value;

    // Neutral ground rest poses counterbalancing torso tilt:
    let groundRPitch = -torsoPitch * 0.9;
    let groundLPitch = -torsoPitch * 0.9;
    let groundRRoll = -torsoRoll - 0.05;
    let groundLRoll = -torsoRoll + 0.05;
    let groundRYaw = 0;
    let groundLYaw = 0;
    let groundRY = this.restRLegPos.y;
    let groundLY = this.restLLegPos.y;

    // 1. Procedural Stride (Continuous velocity-driven kinematics)
    const strideAmp = 0.46 + 0.28 * this.sprintWeight;
    const legWave = Math.sin(this.gaitPhase);

    // Continuous forward/backward swing (reversing direction smoothly passes through zero):
    groundRPitch += -legWave * strideAmp * this.localVelFwd;
    groundLPitch += legWave * strideAmp * this.localVelFwd;

    // Continuous strafe swing:
    const strafeAmp = 0.20 + 0.12 * this.sprintWeight;
    groundRRoll += legWave * strafeAmp * this.localVelRight;
    groundLRoll += legWave * strafeAmp * this.localVelRight;

    // Dynamic foot lift (Swing phase vs Stance phase):
    // Stance foot stays planted; swing foot lifts up in an arc
    const stepLift = 0.042 + 0.028 * this.sprintWeight;
    const dirSign = this.localVelFwd >= 0 ? 1 : -1;
    const rSwing = Math.max(0, legWave * dirSign) * this.moveWeight;
    const lSwing = Math.max(0, -legWave * dirSign) * this.moveWeight;
    groundRY += rSwing * stepLift;
    groundLY += lSwing * stepLift;

    // 1.5. Turn-In-Place Procedural Stepping (Clear, physical alternating foot shuffle)
    if (this.isTurnStepping) {
      const localPhase = this.turnGaitPhase % Math.PI;
      const stepIdx = Math.floor(this.turnGaitPhase / Math.PI);
      const liftArc = Math.sin(localPhase);

      // Foot vertical lift: 8.5 cm (clearly elevates foot without dislocating hip joint into torso)
      const footLift = liftArc * 0.085;
      // Forward knee pitch flex: ~22 degrees
      const swingPitch = liftArc * 0.38;
      // Outward foot yaw into turn direction: ~23 degrees
      const swingYaw = liftArc * 0.40 * this.turnStepDir;
      // Outward lateral clearance roll: ~6 degrees
      const swingRoll = liftArc * 0.10;

      // When turning right (turnStepDir < 0): step 0 = Right, step 1 = Left
      // When turning left (turnStepDir > 0): step 0 = Left, step 1 = Right
      const isRightSwing = (this.turnStepDir < 0) ? (stepIdx % 2 === 0) : (stepIdx % 2 === 1);

      if (isRightSwing) {
        // Right foot is SWING foot (lifting, reaching into turn)
        groundRY += footLift;
        groundRYaw += swingYaw;
        groundRPitch -= swingPitch;
        groundRRoll -= swingRoll;

        // Left foot is STANCE foot (firmly planted on floor)
        groundLY = this.restLLegPos.y;
        groundLYaw = 0;
        groundLPitch = 0;
        groundLRoll = 0.05;
      } else {
        // Left foot is SWING foot (lifting, reaching into turn)
        groundLY += footLift;
        groundLYaw += swingYaw;
        groundLPitch -= swingPitch;
        groundLRoll += swingRoll;

        // Right foot is STANCE foot (firmly planted on floor)
        groundRY = this.restRLegPos.y;
        groundRYaw = 0;
        groundRPitch = 0;
        groundRRoll = -0.05;
      }
    }

    // 2. Idle stance weight shift
    const idleWeight = (1.0 - this.moveWeight) * (this.isTurnStepping ? 0 : 1.0);
    const idleSway = Math.sin(this.totalTime * 1.5) * idleWeight;
    groundRPitch += idleSway * 0.025;
    groundLPitch -= idleSway * 0.025;
    groundRRoll -= 0.02 * idleWeight;
    groundLRoll += 0.02 * idleWeight;

    // 3. Landing Shock Absorption (Knees flex & legs compress)
    const squash = this.landingSquashSpring.value;
    groundRY += squash * 0.07;
    groundLY += squash * 0.07;
    groundRPitch += squash * 0.22;
    groundLPitch += squash * 0.22;
    groundRRoll -= squash * 0.10;
    groundLRoll += squash * 0.10;

    // 4. Airborne targets (Dynamic flight & fall posture)
    const airWave = Math.sin(this.gaitPhase * 0.8);
    const airRPitch = 0.32 + airWave * 0.22;
    const airLPitch = 0.32 - airWave * 0.22;
    const airRRoll = -0.18;
    const airLRoll = 0.18;
    const airRY = this.restRLegPos.y + 0.06;
    const airLY = this.restLLegPos.y + 0.06;

    const rPitchTarget = THREE.MathUtils.lerp(groundRPitch, airRPitch, this.airborneBlend);
    const lPitchTarget = THREE.MathUtils.lerp(groundLPitch, airLPitch, this.airborneBlend);
    const rRollTarget = THREE.MathUtils.lerp(groundRRoll, airRRoll, this.airborneBlend);
    const lRollTarget = THREE.MathUtils.lerp(groundLRoll, airLRoll, this.airborneBlend);
    const rYawTarget = THREE.MathUtils.lerp(groundRYaw, 0, this.airborneBlend);
    const lYawTarget = THREE.MathUtils.lerp(groundLYaw, 0, this.airborneBlend);
    const rYTarget = THREE.MathUtils.lerp(groundRY, airRY, this.airborneBlend);
    const lYTarget = THREE.MathUtils.lerp(groundLY, airLY, this.airborneBlend);

    const curRPitch = this.rLegPitchSpring.update(rPitchTarget, dt);
    const curRRoll = this.rLegRollSpring.update(rRollTarget, dt);
    const curRYaw = this.rLegYawSpring.update(rYawTarget, dt);

    const curLPitch = this.lLegPitchSpring.update(lPitchTarget, dt);
    const curLRoll = this.lLegRollSpring.update(lRollTarget, dt);
    const curLYaw = this.lLegYawSpring.update(lYawTarget, dt);

    this.bones.rLeg.rotation.set(curRPitch, curRYaw, curRRoll);
    this.bones.rLeg.position.y = THREE.MathUtils.lerp(this.bones.rLeg.position.y, rYTarget, Math.min(1, 55 * dt));

    this.bones.lLeg.rotation.set(curLPitch, curLYaw, curLRoll);
    this.bones.lLeg.position.y = THREE.MathUtils.lerp(this.bones.lLeg.position.y, lYTarget, Math.min(1, 55 * dt));
  }

  /**
   * Procedural Physical Arms:
   * Rock-solid, completely smooth kinematic springs with zero jitter and zero obstacle interference.
   */
  private updateArms(state: RagdollInputState): void {
    if (!this.bones.rHand || !this.bones.lHand) return;
    const { dt } = state;

    // Rock-solid shoulder positions (no twitching from obstacle compression)
    this.bones.rHand.position.copy(this.restRHandPos);
    this.bones.lHand.position.copy(this.restLHandPos);

    // 1. Free Hands Targets (Pendulum swing + momentum + centrifugal spread)
    const torsoPitch = this.torsoPitchSpring.value;
    let freeRPitch = -torsoPitch * 0.70;
    let freeLPitch = -torsoPitch * 0.70;
    let freeRRoll = -0.15;
    let freeLRoll = 0.15;
    let freeRYaw = 0;
    let freeLYaw = 0;

    // Arm swing: smoothly scales with moveWeight and velocity
    const armSwingAmp = 0.42 + 0.38 * this.sprintWeight;
    const armWave = Math.sin(this.gaitPhase);
    freeRPitch += armWave * armSwingAmp * this.localVelFwd;
    freeLPitch -= armWave * armSwingAmp * this.localVelFwd;

    // Natural arm counterbalance during turn-in-place
    if (this.isTurnStepping) {
      const localPhase = this.turnGaitPhase % Math.PI;
      const stepIdx = Math.floor(this.turnGaitPhase / Math.PI);
      const liftArc = Math.sin(localPhase);
      const isRightSwing = (this.turnStepDir < 0) ? (stepIdx % 2 === 0) : (stepIdx % 2 === 1);
      const armWaveStep = liftArc * 0.18;
      if (isRightSwing) {
        freeRPitch += armWaveStep;
        freeLPitch -= armWaveStep;
      } else {
        freeRPitch -= armWaveStep;
        freeLPitch += armWaveStep;
      }
    }

    // Centrifugal spread when turning (rotVelocityY is smoothly continuous)
    const centrifugalSpread = THREE.MathUtils.clamp(Math.abs(this.rotVelocityY) * 0.045, 0, 0.25);
    freeRRoll -= centrifugalSpread;
    freeLRoll += centrifugalSpread;

    freeRYaw = THREE.MathUtils.clamp(this.rotVelocityY * 0.03, -0.22, 0.22);
    freeLYaw = THREE.MathUtils.clamp(this.rotVelocityY * 0.03, -0.22, 0.22);

    // Idle arm sway:
    const idleWeight = 1.0 - this.moveWeight;
    const idleArm = Math.sin(this.totalTime * 1.8) * 0.035 * idleWeight;
    freeRPitch += idleArm;
    freeLPitch -= idleArm;

    // 2. Box Holding Targets (Hands forward holding cardboard box with physics sway)
    const boxRPitch = -1.32 + this.boxOffsetPitch.value;
    const boxRRoll = -0.16 + this.boxOffsetRoll.value;
    const boxRYaw = 0.32 + this.boxOffsetYaw.value;

    const boxLPitch = -1.32 + this.boxOffsetPitch.value;
    const boxLRoll = 0.16 - this.boxOffsetRoll.value;
    const boxLYaw = -0.32 + this.boxOffsetYaw.value;

    // 3. Smooth Blend between Free Hands and Box Holding
    let groundRPitch = THREE.MathUtils.lerp(freeRPitch, boxRPitch, this.boxHoldBlend);
    let groundLPitch = THREE.MathUtils.lerp(freeLPitch, boxLPitch, this.boxHoldBlend);
    let groundRRoll = THREE.MathUtils.lerp(freeRRoll, boxRRoll, this.boxHoldBlend);
    let groundLRoll = THREE.MathUtils.lerp(freeLRoll, boxLRoll, this.boxHoldBlend);
    let groundRYaw = THREE.MathUtils.lerp(freeRYaw, boxRYaw, this.boxHoldBlend);
    let groundLYaw = THREE.MathUtils.lerp(freeLYaw, boxLYaw, this.boxHoldBlend);

    // 4. Landing Shock Absorption (Arms spread / drop to catch balance)
    const squash = this.landingSquashSpring.value;
    groundRPitch += squash * 0.30 * (1.0 - 0.7 * this.boxHoldBlend);
    groundLPitch += squash * 0.30 * (1.0 - 0.7 * this.boxHoldBlend);
    groundRRoll -= squash * 0.20 * (1.0 - 0.7 * this.boxHoldBlend);
    groundLRoll += squash * 0.20 * (1.0 - 0.7 * this.boxHoldBlend);

    // 5. Airborne Targets (Panic flail or carrying box in air)
    const panicTime = this.totalTime * 10;
    const airRPitch = this.boxHoldBlend > 0.5
      ? boxRPitch
      : (-1.75 + Math.sin(panicTime) * 0.25);
    const airLPitch = this.boxHoldBlend > 0.5
      ? boxLPitch
      : (-1.75 - Math.sin(panicTime) * 0.25);
    const airRRoll = this.boxHoldBlend > 0.5 ? boxRRoll : (-0.60 - Math.cos(panicTime * 1.1) * 0.20);
    const airLRoll = this.boxHoldBlend > 0.5 ? boxLRoll : (0.60 + Math.cos(panicTime * 1.1 + 0.5) * 0.20);
    const airRYaw = this.boxHoldBlend > 0.5 ? boxRYaw : (Math.sin(panicTime * 0.8) * 0.20);
    const airLYaw = this.boxHoldBlend > 0.5 ? boxLYaw : (-Math.sin(panicTime * 0.8) * 0.20);

    // 6. Smooth Airborne Blending
    const rPitchTarget = THREE.MathUtils.lerp(groundRPitch, airRPitch, this.airborneBlend);
    const lPitchTarget = THREE.MathUtils.lerp(groundLPitch, airLPitch, this.airborneBlend);
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

    // Directly set limb rotations in Euler YXZ - rock-solid stability!
    this.bones.rHand.rotation.set(curRPitch, curRYaw, curRRoll);
    this.bones.lHand.rotation.set(curLPitch, curLYaw, curLRoll);
  }

  /**
   * Head Dynamics
   */
  private updateHead(state: RagdollInputState): void {
    if (!this.bones.head) return;
    const { dt } = state;
    const torsoPitch = this.torsoPitchSpring.value;

    let targetPitch = -torsoPitch * 0.45;
    let targetRoll = 0;
    let targetYaw = 0;

    // Locomotion bob & gaze:
    targetPitch += (0.04 + 0.06 * this.sprintWeight) * this.moveWeight;
    targetPitch += Math.sin(this.gaitPhase * 2) * (0.02 + 0.03 * this.sprintWeight) * this.moveWeight;

    // Turning gaze anticipation:
    targetYaw += THREE.MathUtils.clamp(-this.rotVelocityY * 0.045, -0.28, 0.28);
    targetRoll += THREE.MathUtils.clamp(this.rotVelocityY * 0.025, -0.16, 0.16);

    // Idle head breathing & look-around:
    const idleWeight = 1.0 - this.moveWeight;
    targetPitch += Math.sin(this.totalTime * 1.2) * 0.025 * idleWeight;
    targetRoll += Math.sin(this.totalTime * 0.8) * 0.03 * idleWeight;

    // Looking down slightly at held box:
    targetPitch += 0.08 * this.boxHoldBlend;

    // Landing inertia nod:
    const squash = this.landingSquashSpring.value;
    targetPitch += squash * 0.25;

    // Airborne head tilt:
    targetPitch += 0.25 * this.airborneBlend;
    targetRoll += Math.sin(this.totalTime * 8) * 0.08 * this.airborneBlend;

    const curPitch = this.headPitchSpring.update(targetPitch, dt);
    const curRoll = this.headRollSpring.update(targetRoll, dt);
    const curYaw = this.headYawSpring.update(targetYaw, dt);

    this.bones.head.rotation.set(curPitch, curYaw, curRoll);
  }

  /**
   * Held Box Springs with Dynamic Inertia
   */
  private updateBoxSprings(state: RagdollInputState): void {
    const { dt } = state;

    const targetBoxYaw = THREE.MathUtils.clamp(-this.rotVelocityY * 0.05, -0.45, 0.45);
    this.boxOffsetYaw.update(targetBoxYaw, dt);

    const targetBoxRoll = THREE.MathUtils.clamp(this.rotVelocityY * 0.03, -0.3, 0.3);
    this.boxOffsetRoll.update(targetBoxRoll, dt);

    // Box pitch inertia: tilts forward when moving, tilts back when braking
    let targetBoxPitch = Math.sin(this.gaitPhase * 2) * (0.05 + 0.06 * this.sprintWeight) * this.moveWeight;
    targetBoxPitch -= this.brakingAmount * 0.15;
    this.boxOffsetPitch.update(targetBoxPitch, dt);

    let targetBoxY = (this.torsoYSpring.value - this.restTorsoY) * 0.85;
    if (this.airborneBlend > 0.1) {
      targetBoxY += 0.07 * this.airborneBlend;
    } else {
      targetBoxY += Math.sin(this.gaitPhase * 2) * (0.02 + 0.025 * this.sprintWeight) * this.moveWeight;
      targetBoxY -= this.landingSquashSpring.value * 0.08;
    }
    this.boxOffsetY.update(targetBoxY, dt);
  }
}
