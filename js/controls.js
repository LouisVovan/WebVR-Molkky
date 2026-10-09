/**
 * WebXR Controller & Throw Interaction Manager
 * Handles 6DOF controller grabbing, velocity tracking, throwing physics,
 * haptics, trajectory visualizer for Easy mode, and desktop mouse fallback
 */

class VRControllerManager {
  constructor() {
    this.leftHandEl = null;
    this.rightHandEl = null;
    this.batonEl = null;
    this.heldByHand = null; // null, 'left', or 'right'

    // Velocity history for realistic release momentum
    this.velocityHistory = [];
    this.maxHistory = 8;
    this.lastHandPos = new THREE.Vector3();
    this.lastHandQuat = new THREE.Quaternion();
    this.lastTimestamp = 0;

    // Three.js Line object for curved trajectory visualization in Easy mode
    this.trajectoryLine = null;

    this.init();
  }

  init() {
    window.addEventListener('DOMContentLoaded', () => {
      this.setupElements();
      this.setupEventListeners();
      this.setupDesktopFallback();
    });
  }

  setupElements() {
    this.leftHandEl = document.getElementById('left-controller');
    this.rightHandEl = document.getElementById('right-controller');
    this.batonEl = document.getElementById('molkky-baton');
  }

  setupEventListeners() {
    const bindHand = (el, handName) => {
      if (!el) return;
      ['triggerdown', 'gripdown', 'selectstart', 'squeezestart'].forEach(evt => {
        el.addEventListener(evt, () => this.onGrab(handName));
      });
      ['triggerup', 'gripup', 'selectend', 'squeezeend'].forEach(evt => {
        el.addEventListener(evt, () => this.onRelease(handName));
      });
    };

    bindHand(this.leftHandEl, 'left');
    bindHand(this.rightHandEl, 'right');

    // Direct click/laser on baton
    if (this.batonEl) {
      this.batonEl.addEventListener('click', (e) => {
        const cursor = e.detail && e.detail.cursorEl;
        if (cursor === this.leftHandEl) {
          this.onGrab('left');
        } else {
          this.onGrab('right');
        }
      });
    }
  }

  triggerHaptic(hand, intensity = 0.5, duration = 60) {
    const el = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    if (!el) return;
    try {
      const controller = el.components['oculus-touch-controls'] || el.components['tracked-controls'];
      if (controller && controller.controller && controller.controller.gamepad) {
        const gamepad = controller.controller.gamepad;
        if (gamepad.hapticActuators && gamepad.hapticActuators[0]) {
          gamepad.hapticActuators[0].pulse(intensity, duration);
        }
      }
    } catch (e) {
      // Ignore unsupported haptic environments
    }
  }

  onGrab(hand) {
    if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;
    if (this.heldByHand) return;

    const handEl = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    if (!handEl || !this.batonEl) return;

    // Check distance between hand and baton
    const handPos = new THREE.Vector3();
    const batonPos = new THREE.Vector3();
    handEl.object3D.getWorldPosition(handPos);
    this.batonEl.object3D.getWorldPosition(batonPos);

    // Allow grab within 1.4m radius
    const dist = handPos.distanceTo(batonPos);
    if (dist < 1.4) {
      this.heldByHand = hand;
      this.velocityHistory = [];
      this.lastHandPos.copy(handPos);
      this.lastHandQuat.copy(handEl.object3D.quaternion);
      this.lastTimestamp = performance.now();

      window.molkkyGame.state = 'AIMING';
      this.triggerHaptic(hand, 0.4, 70);

      if (window.soundEngine) {
        window.soundEngine.playGrab(handPos);
      }
    }
  }

  onRelease(hand) {
    if (this.heldByHand !== hand) return;
    this.heldByHand = null;

    if (!window.molkkyGame || (window.molkkyGame.state !== 'AIMING' && window.molkkyGame.state !== 'READY')) {
      return;
    }

    // Hide trajectory assistance
    this.hideTrajectory();

    // Compute release velocity from history
    const throwVel = this.calculateReleaseVelocity();

    // Natural angular tumble
    const angVel = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      -throwVel.length() * 1.6,
      (Math.random() - 0.5) * 3
    );

    const handEl = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    const releasePos = new THREE.Vector3();
    if (handEl) {
      handEl.object3D.getWorldPosition(releasePos);
    } else {
      releasePos.set(0, 1.1, -0.3);
    }

    const speed = throwVel.length();
    if (speed < 0.6) {
      // Soft forward toss fallback
      throwVel.set(0, 0.8, -2.2);
    }

    // Hand haptic pulse on throw
    this.triggerHaptic(hand, 0.85, 120);

    // Launch Cannon physics
    if (window.molkkyPhysics) {
      window.molkkyPhysics.launchBaton(releasePos, throwVel, angVel);
    }

    // Audio
    if (window.soundEngine) {
      window.soundEngine.playThrow(releasePos, throwVel.length());
    }

    window.molkkyGame.onThrowLaunched();
  }

  calculateReleaseVelocity() {
    if (this.velocityHistory.length === 0) {
      return new THREE.Vector3(0, 1.4, -4.8);
    }

    // Weighted average of recent velocities
    const avgVel = new THREE.Vector3();
    let totalWeight = 0;

    for (let i = 0; i < this.velocityHistory.length; i++) {
      const weight = (i + 1);
      avgVel.addScaledVector(this.velocityHistory[i], weight);
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      avgVel.divideScalar(totalWeight);
    }

    // Natural VR throw multiplier
    const throwMultiplier = 1.35;
    avgVel.multiplyScalar(throwMultiplier);

    // Clamp maximum unrealistic speed
    if (avgVel.length() > 16) {
      avgVel.normalize().multiplyScalar(16);
    }

    return avgVel;
  }

  /**
   * Update called every animation frame (tick)
   */
  update(time, deltaTime) {
    if (!this.heldByHand) {
      this.hideTrajectory();
      return;
    }

    const handEl = this.heldByHand === 'left' ? this.leftHandEl : this.rightHandEl;
    if (!handEl || !this.batonEl) return;

    const currentPos = new THREE.Vector3();
    const currentQuat = new THREE.Quaternion();
    handEl.object3D.getWorldPosition(currentPos);
    handEl.object3D.getWorldQuaternion(currentQuat);

    // Update Cannon kinematic body to follow hand
    if (window.molkkyPhysics) {
      window.molkkyPhysics.holdBaton(currentPos, currentQuat);
    }

    // Track velocity
    const now = performance.now();
    const dt = Math.max((now - this.lastTimestamp) / 1000, 0.001);

    const instantVel = new THREE.Vector3()
      .subVectors(currentPos, this.lastHandPos)
      .divideScalar(dt);

    this.velocityHistory.push(instantVel);
    if (this.velocityHistory.length > this.maxHistory) {
      this.velocityHistory.shift();
    }

    this.lastHandPos.copy(currentPos);
    this.lastHandQuat.copy(currentQuat);
    this.lastTimestamp = now;

    // Visual trajectory assistance in Easy mode
    if (window.molkkyGame && window.molkkyGame.difficulty === 'facile') {
      const predictedVel = this.calculateReleaseVelocity();
      this.renderTrajectoryArc(currentPos, predictedVel);
    } else {
      this.hideTrajectory();
    }
  }

  renderTrajectoryArc(startPos, velocity) {
    const scene = document.querySelector('a-scene');
    if (!scene || !scene.object3D) return;

    if (!this.trajectoryLine) {
      const geom = new THREE.BufferGeometry();
      const posArray = new Float32Array(30 * 3);
      geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xfacc15,
        linewidth: 3,
        transparent: true,
        opacity: 0.85
      });
      this.trajectoryLine = new THREE.Line(geom, mat);
      this.trajectoryLine.frustumCulled = false;
      scene.object3D.add(this.trajectoryLine);
    }

    const positions = this.trajectoryLine.geometry.attributes.position.array;
    const gravity = new THREE.Vector3(0, -9.81, 0);
    const dt = 0.035;
    const simPos = startPos.clone();
    const simVel = velocity.clone();

    for (let i = 0; i < 30; i++) {
      positions[i * 3]     = simPos.x;
      positions[i * 3 + 1] = simPos.y;
      positions[i * 3 + 2] = simPos.z;

      simPos.addScaledVector(simVel, dt);
      simVel.addScaledVector(gravity, dt);

      if (simPos.y < 0.01) {
        // Clamp remaining points to ground
        for (let j = i + 1; j < 30; j++) {
          positions[j * 3]     = simPos.x;
          positions[j * 3 + 1] = 0.01;
          positions[j * 3 + 2] = simPos.z;
        }
        break;
      }
    }

    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
    this.trajectoryLine.visible = true;
  }

  hideTrajectory() {
    if (this.trajectoryLine) {
      this.trajectoryLine.visible = false;
    }
  }

  /**
   * Desktop mouse drag fallback for testing without VR headset
   */
  setupDesktopFallback() {
    let isAiming = false;
    let startY = 0;
    let startX = 0;

    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('#hud-container') || e.target.closest('.modal-overlay')) return;
      if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;

      isAiming = true;
      startX = e.clientX;
      startY = e.clientY;
      window.molkkyGame.state = 'AIMING';
    });

    window.addEventListener('mouseup', (e) => {
      if (!isAiming) return;
      isAiming = false;

      if (!window.molkkyGame || window.molkkyGame.state !== 'AIMING') return;

      const deltaY = startY - e.clientY;
      const deltaX = e.clientX - startX;

      const power = Math.max(Math.min(deltaY * 0.045, 12), 3.5);
      const angleOffset = Math.max(Math.min(deltaX * 0.003, 1.2), -1.2);

      const targetZ = window.molkkyGame.difficultyConfigs[window.molkkyGame.difficulty].distance;
      const distZ = Math.abs(targetZ);

      const linVel = new THREE.Vector3(
        angleOffset * 2.2,
        Math.max(power * 0.45, 1.6),
        -Math.max(distZ * 1.45 + (power - 5) * 0.4, 3.8)
      );

      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        -5,
        (Math.random() - 0.5) * 2
      );

      const launchPos = new THREE.Vector3(0, 1.1, -0.3);

      if (window.molkkyPhysics) {
        window.molkkyPhysics.launchBaton(launchPos, linVel, angVel);
      }

      if (window.soundEngine) {
        window.soundEngine.playThrow(launchPos, linVel.length());
      }

      window.molkkyGame.onThrowLaunched();
    });
  }

  /**
   * Simulated throw button (used on desktop companion HUD)
   */
  executeSimulatedThrow(powerModifier = 1.0, horizontalAim = 0.0) {
    if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;

    const targetZ = window.molkkyGame.difficultyConfigs[window.molkkyGame.difficulty].distance;
    const distZ = Math.abs(targetZ);

    const forwardSpeed = -(distZ * 1.55 * powerModifier);
    const upwardSpeed = 1.75 * Math.sqrt(powerModifier);
    const sideSpeed = horizontalAim * 0.8 + (Math.random() - 0.5) * 0.15;

    const linVel = new THREE.Vector3(sideSpeed, upwardSpeed, forwardSpeed);
    const angVel = new THREE.Vector3(-4, -2, 1);
    const launchPos = new THREE.Vector3(0, 1.05, -0.3);

    if (window.molkkyPhysics) {
      window.molkkyPhysics.launchBaton(launchPos, linVel, angVel);
    }

    if (window.soundEngine) {
      window.soundEngine.playThrow(launchPos, linVel.length());
    }

    window.molkkyGame.onThrowLaunched();
  }
}

window.vrControllerManager = new VRControllerManager();
