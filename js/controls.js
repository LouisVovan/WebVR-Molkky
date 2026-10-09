/**
 * WebXR Controller & Throw Interaction Manager
 * Handles Meta Quest 3 6DOF tracking, thumbstick locomotion & snap turn,
 * direct gamepad polling, grab & throw physics, haptics, and trajectory visualizer
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

    // Locomotion & turn debounce
    this.lastSnapTime = 0;

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

  setBaton(el) {
    this.batonEl = el;
  }

  getBaton() {
    if (!this.batonEl) {
      this.batonEl = document.getElementById('molkky-baton');
    }
    return this.batonEl;
  }

  setupElements() {
    this.leftHandEl = document.getElementById('left-controller');
    this.rightHandEl = document.getElementById('right-controller');
    this.getBaton();
  }

  setupEventListeners() {
    const bindHand = (el, handName) => {
      if (!el) return;
      ['triggerdown', 'gripdown', 'selectstart', 'squeezestart'].forEach(evt => {
        el.addEventListener(evt, () => this.checkAndGrab(handName));
      });
      ['triggerup', 'gripup', 'selectend', 'squeezeend'].forEach(evt => {
        el.addEventListener(evt, () => this.onRelease(handName));
      });
    };

    bindHand(this.leftHandEl, 'left');
    bindHand(this.rightHandEl, 'right');

    // Also support direct click/laser on baton
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target && (target.id === 'molkky-baton' || (target.closest && target.closest('#molkky-baton')))) {
        const cursor = e.detail && e.detail.cursorEl;
        if (cursor === this.leftHandEl) {
          this.checkAndGrab('left');
        } else {
          this.checkAndGrab('right');
        }
      }
    });
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

  /**
   * Check distance and grab the Mölkky baton
   */
  checkAndGrab(hand) {
    if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;
    if (this.heldByHand) return;

    const handEl = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    const baton = this.getBaton();
    if (!handEl || !baton) return;

    const handPos = new THREE.Vector3();
    const batonPos = new THREE.Vector3();
    handEl.object3D.getWorldPosition(handPos);
    baton.object3D.getWorldPosition(batonPos);

    const distToBaton = handPos.distanceTo(batonPos);
    const standPos = new THREE.Vector3(0.35, 0.95, -0.25);
    const distToStand = handPos.distanceTo(standPos);

    // Allow grab if hand is near baton (< 1.5m) OR near the throwing stand (< 1.8m)
    if (distToBaton < 1.5 || distToStand < 1.8) {
      this.heldByHand = hand;
      this.velocityHistory = [];
      this.lastHandPos.copy(handPos);
      this.lastHandQuat.copy(handEl.object3D.quaternion);
      this.lastTimestamp = performance.now();

      window.molkkyGame.state = 'AIMING';
      this.triggerHaptic(hand, 0.5, 75);

      if (window.soundEngine) {
        window.soundEngine.playGrab(handPos);
      }
    }
  }

  /**
   * Release and launch the baton into flight
   */
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
      -throwVel.length() * 1.5,
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
   * Main per-frame update loop called from A-Frame tick
   */
  update(time, deltaTime) {
    // 1. Direct WebXR Gamepad handling for Meta Quest 3 (locomotion, snap turn, grabbing)
    this.updateWebXRGamepads(deltaTime);

    // 2. Track held baton
    if (!this.heldByHand) {
      this.hideTrajectory();
      return;
    }

    const handEl = this.heldByHand === 'left' ? this.leftHandEl : this.rightHandEl;
    const baton = this.getBaton();
    if (!handEl || !baton) return;

    const currentPos = new THREE.Vector3();
    const currentQuat = new THREE.Quaternion();
    handEl.object3D.getWorldPosition(currentPos);
    handEl.object3D.getWorldQuaternion(currentQuat);

    // Offset slightly forward in hand
    const holdOffset = new THREE.Vector3(0, 0, -0.06).applyQuaternion(currentQuat);
    const holdPos = currentPos.clone().add(holdOffset);

    // Update Cannon kinematic body to follow hand
    if (window.molkkyPhysics) {
      window.molkkyPhysics.holdBaton(holdPos, currentQuat);
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
      this.renderTrajectoryArc(holdPos, predictedVel);
    } else {
      this.hideTrajectory();
    }
  }

  /**
   * Direct WebXR Gamepad Polling:
   * Handles Meta Quest 3 thumbstick locomotion (left stick),
   * snap turn (right stick), and grab/throw buttons
   */
  updateWebXRGamepads(deltaTime) {
    const scene = document.querySelector('a-scene');
    if (!scene || !scene.xrSession) return;

    const session = scene.xrSession;
    const rig = document.getElementById('rig');
    const camera = document.getElementById('camera');
    if (!rig || !camera) return;

    const moveSpeed = 2.4 * (deltaTime / 1000);

    for (const source of session.inputSources) {
      if (!source.gamepad) continue;
      const gp = source.gamepad;
      const hand = source.handedness; // 'left' or 'right'

      // Meta Quest axes: axes[2] is X, axes[3] is Y
      const axisX = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] || 0);
      const axisY = gp.axes.length >= 4 ? gp.axes[3] : (gp.axes[1] || 0);

      // Buttons: Trigger (0), Grip (1), Button A/X (4), Button B/Y (5)
      const triggerPressed = gp.buttons[0] && gp.buttons[0].pressed;
      const gripPressed = gp.buttons[1] && gp.buttons[1].pressed;
      const isSqueezing = triggerPressed || gripPressed;

      // 1. LEFT THUMBSTICK: Smooth Locomotion
      if (hand === 'left') {
        const deadzone = 0.15;
        if (Math.abs(axisX) > deadzone || Math.abs(axisY) > deadzone) {
          const camQuat = camera.object3D.quaternion;
          const euler = new THREE.Euler().setFromQuaternion(camQuat, 'YXZ');
          const yaw = euler.y;

          const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
          const strafe = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

          const moveDir = new THREE.Vector3();
          moveDir.addScaledVector(forward, -axisY);
          moveDir.addScaledVector(strafe, axisX);
          moveDir.normalize();

          rig.object3D.position.addScaledVector(moveDir, moveSpeed);

          // Boundaries
          rig.object3D.position.x = Math.max(Math.min(rig.object3D.position.x, 8), -8);
          rig.object3D.position.z = Math.max(Math.min(rig.object3D.position.z, 2), -5);
        }
      }

      // 2. RIGHT THUMBSTICK: Snap Turn (30 degrees)
      if (hand === 'right') {
        const snapThreshold = 0.65;
        const now = performance.now();
        if (Math.abs(axisX) > snapThreshold && (!this.lastSnapTime || now - this.lastSnapTime > 350)) {
          const snapAngle = (axisX > 0 ? -1 : 1) * (Math.PI / 6);
          rig.object3D.rotation.y += snapAngle;
          this.lastSnapTime = now;
        }
      }

      // 3. GRAB & THROW VIA GAMEPAD BUTTON STATE
      if (isSqueezing) {
        if (!this.heldByHand) {
          this.checkAndGrab(hand);
        }
      } else {
        if (this.heldByHand === hand) {
          this.onRelease(hand);
        }
      }
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
