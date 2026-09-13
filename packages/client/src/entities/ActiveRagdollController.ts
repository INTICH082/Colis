import * as THREE from 'three';

/**
 * Robust Second-Order Dynamics / Spring-Damper numerical solver.
 * Simulates mass-spring-damper physics with semi-implicit integration.
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
}

/**
 * ActiveRagdollController
 *
 * Procedural physical animation controller inspired by TABS, Human: Fall Flat, and PEAK.
 * Directly drives character skeleton bones using:
 *  - Second-order dynamics spring-damper inverted pendulum balance (Torso)
 *  - Procedural gait generator & Leg IK (Walk, Sprint, Backpedal, Strafe)
 *  - Floppy active-ragdoll arms with drag, centrifugal flailing, and panic jump flapping
 *  - Heavy-object box holding physics with momentum lag
 *  - Secondary spring neck & head wobble
 */
export class ActiveRagdollController {
  private bones: CharacterBones = {};

  // Base rest transforms recorded from initial model bind pose
  private restTorsoY: number = 1.25;
  private restHeadY: number = 0.125;
  private restRLegPos: THREE.Vector3 = new THREE.Vector3(-0.1875, -0.508, 0);
  private restLLegPos: THREE.Vector3 = new THREE.Vector3(0.1875, -0.508, 0);
  private restRHandPos: THREE.Vector3 = new THREE.Vector3(-0.3516, 0.07, 0);
  private restLHandPos: THREE.Vector3 = new THREE.Vector3(0.3516, 0.07, 0);

  // Torso Dynamics Springs
  private torsoYSpring: SpringDamper = new SpringDamper(1.25, 12, 0.6);
  private torsoPitchSpring: SpringDamper = new SpringDamper(0, 10, 0.65);
  private torsoRollSpring: SpringDamper = new SpringDamper(0, 11, 0.65);
  private torsoYawSpring: SpringDamper = new SpringDamper(0, 12, 0.7);

  // Head Dynamics Springs
  private headPitchSpring: SpringDamper = new SpringDamper(0, 14, 0.65);
  private headRollSpring: SpringDamper = new SpringDamper(0, 14, 0.65);
  private headYawSpring: SpringDamper = new SpringDamper(0, 15, 0.75);

  // Arms Ragdoll Springs (X = swing pitch, Y = twist yaw, Z = flap/spread roll)
  private rArmPitchSpring: SpringDamper = new SpringDamper(0, 9, 0.55);
  private rArmRollSpring: SpringDamper = new SpringDamper(-0.18, 9, 0.55);
  private rArmYawSpring: SpringDamper = new SpringDamper(0, 10, 0.6);

  private lArmPitchSpring: SpringDamper = new SpringDamper(0, 9, 0.55);
  private lArmRollSpring: SpringDamper = new SpringDamper(0.18, 9, 0.55);
  private lArmYawSpring: SpringDamper = new SpringDamper(0, 10, 0.6);

  // Held Box Momentum Lag Springs
  public boxOffsetPitch: SpringDamper = new SpringDamper(0, 12, 0.6);
  public boxOffsetYaw: SpringDamper = new SpringDamper(0, 11, 0.6);
  public boxOffsetRoll: SpringDamper = new SpringDamper(0, 12, 0.6);
  public boxOffsetY: SpringDamper = new SpringDamper(0, 14, 0.65);

  // Legs Dynamics Springs
  private rLegPitchSpring: SpringDamper = new SpringDamper(0, 18, 0.8);
  private rLegRollSpring: SpringDamper = new SpringDamper(0, 18, 0.8);
  private lLegPitchSpring: SpringDamper = new SpringDamper(0, 18, 0.8);
  private lLegRollSpring: SpringDamper = new SpringDamper(0, 18, 0.8);

  // Gait Engine State
  private gaitPhase: number = 0;
  private totalTime: number = 0;
  private prevRotY: number = 0;
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
    }
    if (this.bones.lHand) {
      this.restLHandPos.copy(this.bones.lHand.position);
    }
  }

  public setBones(bones: CharacterBones): void {
    this.bones = bones;
    this.recordRestPoses();
  }

  /**
   * Main Physics Tick
   */
  public update(state: RagdollInputState): void {
    const { dt, isMoving, isSprinting, isAirborne, worldMoveX, worldMoveZ, playerRotationY, isHoldingBox } = state;
    this.totalTime += dt;

    // 1. Angular Velocity Calculation (Centrifugal effects & turns)
    let rotDiff = playerRotationY - this.prevRotY;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    const currentRotVel = dt > 0.0001 ? rotDiff / dt : 0;
    this.rotVelocityY = THREE.MathUtils.lerp(this.rotVelocityY, currentRotVel, Math.min(1, 15 * dt));
    this.prevRotY = playerRotationY;

    // 2. Local Movement Direction & Speed Projection
    // In Three.js, character facing is along world direction (-sin(rotY), -cos(rotY))
    // Character right is (cos(rotY), -sin(rotY))
    const sinR = Math.sin(playerRotationY);
    const cosR = Math.cos(playerRotationY);

    const worldSpeed = Math.hypot(worldMoveX, worldMoveZ);
    let targetLocalFwd = 0;
    let targetLocalRight = 0;

    if (isMoving && worldSpeed > 0.001) {
      const normX = worldMoveX / worldSpeed;
      const normZ = worldMoveZ / worldSpeed;
      // Dot product with forward
      targetLocalFwd = -normX * sinR - normZ * cosR;
      // Dot product with right
      targetLocalRight = normX * cosR - normZ * sinR;
    }

    const smoothSpeed = isMoving ? (isSprinting ? 1.0 : 0.6) : 0;
    this.localVelFwd = THREE.MathUtils.lerp(this.localVelFwd, targetLocalFwd * smoothSpeed, Math.min(1, 12 * dt));
    this.localVelRight = THREE.MathUtils.lerp(this.localVelRight, targetLocalRight * smoothSpeed, Math.min(1, 12 * dt));

    // 3. Impact Detection (Landing from air)
    if (this.wasAirborne && !isAirborne) {
      // Impact compression: torso squats down hard and rebounds!
      this.torsoYSpring.impulse(-1.4);
      this.headPitchSpring.impulse(0.6);
      this.rArmPitchSpring.impulse(-0.9);
      this.lArmPitchSpring.impulse(-0.9);
    }
    this.wasAirborne = isAirborne;

    // 4. Update Gait Phase & Procedural Foot Cycles
    const strideFreq = isAirborne ? 4.5 : (isSprinting ? 10.0 : 7.2);
    if (isMoving || isAirborne) {
      this.gaitPhase += strideFreq * dt * (isMoving ? 1.0 : 0.7);
    }

    // 5. Update Torso Balance & Suspension
    this.updateTorso(state);

    // 6. Update Legs IK & Procedural Stepping
    this.updateLegs(state);

    // 7. Update Ragdoll Arms (Pendulum / Flail / Box Hold)
    this.updateArms(state);

    // 8. Update Head Dynamics
    this.updateHead(state);

    // 9. Update Held Box Spring Lag
    this.updateBoxSprings(state);
  }

  /**
   * Torso: Inverted Pendulum, Acceleration Lean, Centrifugal Banking, and Hip Bounce
   */
  private updateTorso(state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean }): void {
    if (!this.bones.torso) return;

    const { dt, isMoving, isSprinting, isAirborne } = state;

    // A. Vertical Suspension / Hip Bob
    let targetY = this.restTorsoY;
    if (isAirborne) {
      targetY += 0.08;
    } else if (isMoving) {
      const bobAmp = isSprinting ? 0.045 : 0.025;
      targetY += Math.sin(this.gaitPhase * 2) * bobAmp;
    } else {
      // Breathing
      targetY += Math.sin(this.totalTime * 2.2) * 0.008;
    }
    const currentY = this.torsoYSpring.update(targetY, dt);
    this.bones.torso.position.y = currentY;

    // B. Pitch (Lean forward / backward)
    // In Three.js hierarchy with 180-deg Root: positive pitch tilts torso forward!
    let targetPitch = 0;
    if (isAirborne) {
      targetPitch = -0.15; // lean back slightly in air
    } else if (isMoving) {
      // Lean into forward motion, tilt back when backpedaling
      targetPitch = this.localVelFwd * (isSprinting ? 0.32 : 0.18);
    }
    const currentPitch = this.torsoPitchSpring.update(targetPitch, dt);

    // C. Roll (Centrifugal bank in turns + strafe lean + foot weight roll)
    let targetRoll = 0;
    // Centrifugal lean: banking into quick turns
    targetRoll += THREE.MathUtils.clamp(-this.rotVelocityY * 0.04, -0.28, 0.28);
    // Strafe lean: leaning sideways when moving left/right
    targetRoll += this.localVelRight * (isSprinting ? 0.22 : 0.14);
    // Natural hip sway from stepping
    if (isMoving && !isAirborne) {
      targetRoll += Math.sin(this.gaitPhase) * (isSprinting ? 0.06 : 0.035);
    } else if (!isMoving && !isAirborne) {
      targetRoll += Math.sin(this.totalTime * 1.5) * 0.02;
    }
    const currentRoll = this.torsoRollSpring.update(targetRoll, dt);

    // D. Yaw (Torso twist towards movement)
    let targetYaw = 0;
    if (isMoving && !isAirborne) {
      targetYaw = Math.cos(this.gaitPhase) * (isSprinting ? 0.12 : 0.06);
    }
    const currentYaw = this.torsoYawSpring.update(targetYaw, dt);

    this.bones.torso.rotation.set(currentPitch, currentYaw, currentRoll);
  }

  /**
   * Procedural Gait Engine & Leg IK
   */
  private updateLegs(state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean }): void {
    if (!this.bones.rLeg || !this.bones.lLeg) return;

    const { dt, isMoving, isSprinting, isAirborne } = state;

    let rPitchTarget = 0;
    let rRollTarget = -0.05; // natural slight stance spread
    let lPitchTarget = 0;
    let lRollTarget = 0.05;

    let rYTarget = this.restRLegPos.y;
    let lYTarget = this.restLLegPos.y;

    if (isAirborne) {
      // === AIRBORNE JUMP / FALL ===
      // Feet dangle backwards (+ pitch); comical air bicycle kicks
      const airWave = Math.sin(this.gaitPhase);
      rPitchTarget = 0.35 + airWave * 0.25;
      lPitchTarget = 0.35 - airWave * 0.25;
      // Legs spread outward in panic
      rRollTarget = -0.18;
      lRollTarget = 0.18;
      rYTarget += 0.06;
      lYTarget += 0.06;
    } else if (isMoving) {
      // === PROCEDURAL WALKING / SPRINTING ===
      const strideAmp = isSprinting ? 0.72 : 0.48;
      const legWave = Math.sin(this.gaitPhase);

      // In Three.js: negative pitch swings leg FORWARD (-Z), positive pitch swings leg BACKWARD (+Z).
      // When localVelFwd > 0 (moving forward):
      // When legWave > 0: right leg swings FORWARD (negative pitch), left leg swings BACKWARD (positive pitch).
      const fwdFactor = Math.abs(this.localVelFwd) > 0.05 ? Math.sign(this.localVelFwd) : 1;
      rPitchTarget = -legWave * strideAmp * fwdFactor;
      lPitchTarget = legWave * strideAmp * fwdFactor;

      // Sideways strafe stepping:
      if (Math.abs(this.localVelRight) > 0.05) {
        const strafeAmp = (isSprinting ? 0.32 : 0.20) * Math.sign(this.localVelRight);
        rRollTarget += legWave * strafeAmp;
        lRollTarget += legWave * strafeAmp;
      }

      // Parabolic step lift during forward swing phase
      // Right leg swings forward when (-legWave * fwdFactor) < 0 => legWave * fwdFactor > 0
      const rSwing = Math.max(0, legWave * fwdFactor);
      const lSwing = Math.max(0, -legWave * fwdFactor);
      const stepLift = isSprinting ? 0.055 : 0.035;
      rYTarget += rSwing * stepLift;
      lYTarget += lSwing * stepLift;
    } else {
      // === IDLE / STANDING ===
      const idleSway = Math.sin(this.totalTime * 1.5);
      rPitchTarget = idleSway * 0.03;
      lPitchTarget = -idleSway * 0.03;
      rRollTarget = -0.06;
      lRollTarget = 0.06;
    }

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
   * Floppy Active-Ragdoll Arms (Pendulums, Centrifugal Wind-up, Panic Jumping Flail, and Box Clasp)
   */
  private updateArms(state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean; isHoldingBox: boolean }): void {
    if (!this.bones.rHand || !this.bones.lHand) return;

    const { dt, isMoving, isSprinting, isAirborne, isHoldingBox } = state;

    let rPitchTarget = 0;
    let rRollTarget = -0.15; // natural outward hang
    let rYawTarget = 0;

    let lPitchTarget = 0;
    let lRollTarget = 0.15;
    let lYawTarget = 0;

    if (isHoldingBox) {
      // === HOLDING BOX POSTURE (With Dynamic Weight Momentum) ===
      // In Three.js: arms reach forward horizontally (-1.35 rad pitch)
      rPitchTarget = -1.35 + this.boxOffsetPitch.value;
      rRollTarget = -0.18 + this.boxOffsetRoll.value;
      rYawTarget = 0.35 + this.boxOffsetYaw.value;

      lPitchTarget = -1.35 + this.boxOffsetPitch.value;
      lRollTarget = 0.18 - this.boxOffsetRoll.value;
      lYawTarget = -0.35 + this.boxOffsetYaw.value;

      if (isMoving) {
        const carryBob = Math.sin(this.gaitPhase * 2) * (isSprinting ? 0.08 : 0.04);
        rPitchTarget += carryBob;
        lPitchTarget += carryBob;
      }
    } else if (isAirborne) {
      // === TABS / GANG BEASTS PANIC AIR FLAP! ===
      // Arms fly up high above head and wave wildly in frantic circular patterns
      const panicTime = this.totalTime * 12;
      const flapPitch = -2.3 + Math.sin(panicTime) * 0.35;
      const rFlapRoll = -0.7 - Math.cos(panicTime * 1.1) * 0.3;
      const lFlapRoll = 0.7 + Math.cos(panicTime * 1.1 + 0.5) * 0.3;

      rPitchTarget = flapPitch;
      rRollTarget = rFlapRoll;
      rYawTarget = Math.sin(panicTime * 0.8) * 0.3;

      lPitchTarget = flapPitch;
      lRollTarget = lFlapRoll;
      lYawTarget = -Math.sin(panicTime * 0.8) * 0.3;
    } else if (isMoving) {
      // === ACTIVE RAGDOLL PENDULUM LOCOMOTION ===
      // Arms swing in OPPOSITION to legs:
      // When right leg is forward (negative pitch), right arm swings backward (positive pitch)!
      const armSwingAmp = isSprinting ? 0.95 : 0.55;
      const armWave = Math.sin(this.gaitPhase);

      rPitchTarget = armWave * armSwingAmp;
      lPitchTarget = -armWave * armSwingAmp;

      // Centrifugal outward swing when spinning
      const centrifugalSpread = Math.abs(this.rotVelocityY) * 0.08;
      rRollTarget = -0.22 - centrifugalSpread;
      lRollTarget = 0.22 + centrifugalSpread;

      // Inertial lag on sharp turns
      rYawTarget = THREE.MathUtils.clamp(this.rotVelocityY * 0.04, -0.3, 0.3);
      lYawTarget = THREE.MathUtils.clamp(this.rotVelocityY * 0.04, -0.3, 0.3);
    } else {
      // === IDLE FLOATING / SIGHING ARMS ===
      const idleArm = Math.sin(this.totalTime * 1.8) * 0.04;
      rPitchTarget = idleArm;
      lPitchTarget = -idleArm;
      rRollTarget = -0.18;
      lRollTarget = 0.18;

      // Centrifugal helicopter effect if spinning around while stationary!
      if (Math.abs(this.rotVelocityY) > 0.5) {
        const spinSpread = Math.min(1.0, Math.abs(this.rotVelocityY) * 0.12);
        rRollTarget -= spinSpread;
        lRollTarget += spinSpread;
        rPitchTarget -= this.rotVelocityY * 0.05;
        lPitchTarget += this.rotVelocityY * 0.05;
      }
    }

    const curRPitch = this.rArmPitchSpring.update(rPitchTarget, dt);
    const curRRoll = this.rArmRollSpring.update(rRollTarget, dt);
    const curRYaw = this.rArmYawSpring.update(rYawTarget, dt);

    const curLPitch = this.lArmPitchSpring.update(lPitchTarget, dt);
    const curLRoll = this.lArmRollSpring.update(lRollTarget, dt);
    const curLYaw = this.lArmYawSpring.update(lYawTarget, dt);

    this.bones.rHand.rotation.set(curRPitch, curRYaw, curRRoll);
    this.bones.lHand.rotation.set(curLPitch, curLYaw, curLRoll);
  }

  /**
   * Head: Secondary Spring Dynamics and Look-Delay
   */
  private updateHead(state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean }): void {
    if (!this.bones.head) return;

    const { dt, isMoving, isSprinting, isAirborne } = state;

    let targetPitch = 0;
    let targetRoll = 0;
    let targetYaw = 0;

    if (isAirborne) {
      targetPitch = 0.25;
      targetRoll = Math.sin(this.totalTime * 8) * 0.1;
    } else if (isMoving) {
      targetPitch = isSprinting ? 0.15 : 0.05;
      targetPitch += Math.sin(this.gaitPhase * 2) * (isSprinting ? 0.05 : 0.025);
      targetYaw = THREE.MathUtils.clamp(-this.rotVelocityY * 0.03, -0.25, 0.25);
      targetRoll = THREE.MathUtils.clamp(this.rotVelocityY * 0.02, -0.15, 0.15);
    } else {
      targetPitch = Math.sin(this.totalTime * 1.2) * 0.03;
      targetRoll = Math.sin(this.totalTime * 0.8) * 0.04;
    }

    const curPitch = this.headPitchSpring.update(targetPitch, dt);
    const curRoll = this.headRollSpring.update(targetRoll, dt);
    const curYaw = this.headYawSpring.update(targetYaw, dt);

    this.bones.head.rotation.set(curPitch, curYaw, curRoll);
  }

  /**
   * Held Box Physics: Simulates heavy package momentum and lag
   */
  private updateBoxSprings(state: { dt: number; isMoving: boolean; isSprinting: boolean; isAirborne: boolean }): void {
    const { dt, isMoving, isSprinting, isAirborne } = state;

    // Yaw lag: when turning fast, the heavy box lags behind
    const targetBoxYaw = THREE.MathUtils.clamp(-this.rotVelocityY * 0.05, -0.45, 0.45);
    this.boxOffsetYaw.update(targetBoxYaw, dt);

    // Roll lag: box tilts outward during turns
    const targetBoxRoll = THREE.MathUtils.clamp(this.rotVelocityY * 0.03, -0.3, 0.3);
    this.boxOffsetRoll.update(targetBoxRoll, dt);

    // Pitch lag: box tilts up/down with acceleration and footsteps
    let targetBoxPitch = 0;
    if (isMoving) {
      targetBoxPitch = Math.sin(this.gaitPhase * 2) * (isSprinting ? 0.12 : 0.06);
    }
    this.boxOffsetPitch.update(targetBoxPitch, dt);

    // Vertical bounce
    let targetBoxY = 0;
    if (isAirborne) {
      targetBoxY = 0.08;
    } else if (isMoving) {
      targetBoxY = Math.sin(this.gaitPhase * 2) * (isSprinting ? 0.04 : 0.02);
    }
    this.boxOffsetY.update(targetBoxY, dt);
  }
}
