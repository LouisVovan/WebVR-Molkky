/**
 * 3D Physics Engine for WebVR Mölkky using Cannon.js
 * Manages rigid bodies, collisions, restitution, pin fall detection, and upright reset
 */

class MolkkyPhysics {
  constructor() {
    this.world = null;
    this.groundBody = null;
    this.batonBody = null;
    this.batonMesh = null;
    this.pins = []; // Array of { id, number, body, mesh, initialPos, fallen: false }
    this.isSettling = false;
    this.settleTimer = 0;
    this.settleCallback = null;
    this.roundInProgress = false;

    // Physical dimensions (standard Mölkky in meters)
    this.PIN_RADIUS = 0.028;    // ~5.6 cm diameter
    this.PIN_HEIGHT = 0.150;    // 15 cm height
    this.PIN_MASS = 0.28;       // ~280g wooden pin
    this.BATON_RADIUS = 0.027;  // ~5.4 cm diameter
    this.BATON_HEIGHT = 0.225;  // 22.5 cm length
    this.BATON_MASS = 0.38;     // ~380g wooden throwing stick

    this.initWorld();
  }

  initWorld() {
    if (typeof CANNON === 'undefined') {
      console.error('Cannon.js is not loaded!');
      return;
    }

    this.world = new CANNON.World();
    this.world.gravity.set(0, -9.81, 0);
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.solver.iterations = 15;
    this.world.solver.tolerance = 0.001;
    this.world.allowSleep = true;

    // Physical materials
    const woodMaterial = new CANNON.Material('wood');
    const groundMaterial = new CANNON.Material('ground');

    // Wood on grass contact (good grip, dampening)
    const woodGroundContact = new CANNON.ContactMaterial(woodMaterial, groundMaterial, {
      friction: 0.55,
      restitution: 0.22,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });

    // Wood on wood contact (clacking, medium rebound)
    const woodWoodContact = new CANNON.ContactMaterial(woodMaterial, woodMaterial, {
      friction: 0.35,
      restitution: 0.38,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });

    this.world.addContactMaterial(woodGroundContact);
    this.world.addContactMaterial(woodWoodContact);

    this.woodMaterial = woodMaterial;
    this.groundMaterial = groundMaterial;

    // Static ground plane at y = 0
    const groundShape = new CANNON.Plane();
    this.groundBody = new CANNON.Body({
      mass: 0,
      material: groundMaterial,
      shape: groundShape
    });
    // Rotate plane so normal points +Y
    this.groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.groundBody.position.set(0, 0, 0);
    this.world.addBody(this.groundBody);
  }

  /**
   * Helper to create a cylindrical Cannon shape
   */
  createCylinderShape(radius, height, segments = 12) {
    return new CANNON.Cylinder(radius, radius, height, segments);
  }

  /**
   * Register the throwing baton (Mölkky)
   */
  setupBaton(mesh, startPos = { x: 0.35, y: 0.95, z: -0.25 }) {
    this.batonMesh = mesh;
    const batonShape = this.createCylinderShape(this.BATON_RADIUS, this.BATON_HEIGHT, 14);

    this.batonBody = new CANNON.Body({
      mass: this.BATON_MASS,
      material: this.woodMaterial,
      linearDamping: 0.05,
      angularDamping: 0.08
    });

    // Rotate cylinder so height aligns with Y-axis in local frame
    const qRot = new CANNON.Quaternion();
    qRot.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
    this.batonBody.addShape(batonShape, new CANNON.Vec3(0, 0, 0), qRot);

    this.batonBody.position.set(startPos.x, startPos.y, startPos.z);
    this.batonBody.type = CANNON.Body.KINEMATIC;
    this.world.addBody(this.batonBody);

    // Audio collision listener
    this.batonBody.addEventListener('collide', (event) => {
      const contact = event.contact;
      let impactSpeed = 1.0;
      if (contact && typeof contact.getImpactVelocityAlongNormal === 'function') {
        impactSpeed = Math.abs(contact.getImpactVelocityAlongNormal());
      }
      if (impactSpeed > 0.35 && window.soundEngine) {
        const pos = {
          x: this.batonBody.position.x,
          y: this.batonBody.position.y,
          z: this.batonBody.position.z
        };
        if (event.body === this.groundBody || event.target === this.groundBody) {
          window.soundEngine.playGrassImpact(pos, impactSpeed);
        } else {
          window.soundEngine.playWoodImpact(pos, impactSpeed);
        }
      }
    });
  }

  /**
   * Get official Mölkky coordinates for a given base distance Z
   */
  getMolkkyLayout(targetCenterZ = -3.5) {
    const d = this.PIN_RADIUS * 2.15; // Tight hexagonal spacing
    const rowOffset = d * 0.866;      // sqrt(3)/2 triangular packing

    // Official international Mölkky configuration
    // Row 1 (front): 1, 2
    // Row 2: 3, 10, 4
    // Row 3: 5, 11, 12, 6
    // Row 4 (back): 7, 9, 8
    return [
      { num: 1,  x: -d * 0.5, z: targetCenterZ },
      { num: 2,  x:  d * 0.5, z: targetCenterZ },

      { num: 3,  x: -d,       z: targetCenterZ - rowOffset },
      { num: 10, x:  0,       z: targetCenterZ - rowOffset },
      { num: 4,  x:  d,       z: targetCenterZ - rowOffset },

      { num: 5,  x: -d * 1.5, z: targetCenterZ - rowOffset * 2 },
      { num: 11, x: -d * 0.5, z: targetCenterZ - rowOffset * 2 },
      { num: 12, x:  d * 0.5, z: targetCenterZ - rowOffset * 2 },
      { num: 6,  x:  d * 1.5, z: targetCenterZ - rowOffset * 2 },

      { num: 7,  x: -d,       z: targetCenterZ - rowOffset * 3 },
      { num: 9,  x:  0,       z: targetCenterZ - rowOffset * 3 },
      { num: 8,  x:  d,       z: targetCenterZ - rowOffset * 3 }
    ];
  }

  /**
   * Setup the 12 numbered pins at target base Z offset
   * Accepts map/dictionary of pin number -> Three.js mesh
   */
  setupPins(pinMeshesByNumber, targetCenterZ = -3.5) {
    // Clear old pins if any
    this.pins.forEach(p => this.world.removeBody(p.body));
    this.pins = [];

    const layout = this.getMolkkyLayout(targetCenterZ);

    layout.forEach((item, index) => {
      const mesh = pinMeshesByNumber[item.num];
      const pinShape = this.createCylinderShape(this.PIN_RADIUS, this.PIN_HEIGHT, 12);

      const body = new CANNON.Body({
        mass: this.PIN_MASS,
        material: this.woodMaterial,
        linearDamping: 0.12,
        angularDamping: 0.15,
        sleepSpeedLimit: 0.05,
        sleepTimeLimit: 0.5
      });

      // Align height with Y-axis
      const qRot = new CANNON.Quaternion();
      qRot.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
      body.addShape(pinShape, new CANNON.Vec3(0, 0, 0), qRot);

      // Standing upright position on ground
      const initY = this.PIN_HEIGHT / 2 + 0.002;
      body.position.set(item.x, initY, item.z);
      this.world.addBody(body);

      // Audio on pin-pin collisions
      body.addEventListener('collide', (e) => {
        let speed = 1.0;
        if (e.contact && typeof e.contact.getImpactVelocityAlongNormal === 'function') {
          speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
        }
        if (speed > 0.3 && window.soundEngine) {
          const pos = { x: body.position.x, y: body.position.y, z: body.position.z };
          if (e.body === this.groundBody) {
            window.soundEngine.playGrassImpact(pos, speed * 0.8);
          } else {
            window.soundEngine.playWoodImpact(pos, speed);
          }
        }
      });

      this.pins.push({
        id: index,
        number: item.num,
        body: body,
        mesh: mesh,
        initialPos: { x: item.x, y: initY, z: item.z },
        fallen: false
      });
    });

    this.syncMeshes();
  }

  /**
   * Reset all pins to their exact initial layout positions
   */
  resetAllPinsToInitial(targetCenterZ = -3.5) {
    const layout = this.getMolkkyLayout(targetCenterZ);

    layout.forEach(item => {
      const pin = this.pins.find(p => p.number === item.num);
      if (pin) {
        pin.initialPos = { x: item.x, y: this.PIN_HEIGHT / 2 + 0.002, z: item.z };
        pin.fallen = false;

        pin.body.wakeUp();
        pin.body.position.set(item.x, this.PIN_HEIGHT / 2 + 0.002, item.z);
        pin.body.quaternion.set(0, 0, 0, 1);
        pin.body.velocity.set(0, 0, 0);
        pin.body.angularVelocity.set(0, 0, 0);
        pin.body.sleep();
      }
    });

    this.syncMeshes();
  }

  /**
   * Launch the baton into dynamic flight with given linear and angular velocity
   */
  launchBaton(worldPos, linVel, angVel) {
    if (!this.batonBody) return;

    this.batonBody.type = CANNON.Body.DYNAMIC;
    this.batonBody.wakeUp();
    this.batonBody.position.set(worldPos.x, worldPos.y, worldPos.z);
    this.batonBody.velocity.set(linVel.x, linVel.y, linVel.z);
    this.batonBody.angularVelocity.set(angVel.x, angVel.y, angVel.z);

    // Wake all pins so they can react to collision
    this.pins.forEach(p => p.body.wakeUp());

    this.roundInProgress = true;
    this.isSettling = true;
    this.settleTimer = 0;
  }

  /**
   * Hold baton attached to controller or hand
   */
  holdBaton(worldPos, worldQuat) {
    if (!this.batonBody) return;
    this.batonBody.type = CANNON.Body.KINEMATIC;
    this.batonBody.position.set(worldPos.x, worldPos.y, worldPos.z);
    this.batonBody.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w);
    this.batonBody.velocity.set(0, 0, 0);
    this.batonBody.angularVelocity.set(0, 0, 0);
  }

  /**
   * Place baton resting on throw stand
   */
  resetBatonToStand(standPos = { x: 0.35, y: 0.95, z: -0.25 }) {
    if (!this.batonBody) return;
    this.batonBody.type = CANNON.Body.KINEMATIC;
    this.batonBody.position.set(standPos.x, standPos.y, standPos.z);
    // Slight horizontal rest angle
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2);
    this.batonBody.quaternion.copy(q);
    this.batonBody.velocity.set(0, 0, 0);
    this.batonBody.angularVelocity.set(0, 0, 0);
    this.syncMeshes();
  }

  /**
   * Check which pins have fallen according to official Mölkky rules:
   * A pin is considered fallen if it is knocked down (tilt angle > 42° with vertical)
   * or resting on the ground.
   */
  checkFallenPins() {
    const fallenPins = [];

    this.pins.forEach(pin => {
      const body = pin.body;

      // Local UP vector is (0, 1, 0)
      const up = new CANNON.Vec3(0, 1, 0);
      const worldUp = body.quaternion.vmult(up);

      // If vertical component < 0.72 (tilt angle > ~44°) or center of gravity dropped significantly
      const isTilted = worldUp.y < 0.72;
      const isDown = body.position.y < (this.PIN_HEIGHT * 0.45);

      if (isTilted || isDown) {
        pin.fallen = true;
        fallenPins.push(pin);
      } else {
        pin.fallen = false;
      }
    });

    return fallenPins;
  }

  /**
   * Crucial Mölkky Rule:
   * "Après le calcul du score, chaque quille tombée est remise debout à l'endroit où elle est tombée.
   * Les quilles se dispersent donc progressivement au cours de la partie."
   */
  standFallenPinsUpright() {
    this.pins.forEach(pin => {
      if (pin.fallen) {
        // Keeps its landing (X, Z) coordinate!
        const posX = pin.body.position.x;
        const posZ = pin.body.position.z;
        const standingY = this.PIN_HEIGHT / 2 + 0.003;

        pin.body.wakeUp();
        pin.body.position.set(posX, standingY, posZ);

        // Reset to upright identity quaternion
        pin.body.quaternion.set(0, 0, 0, 1);
        pin.body.velocity.set(0, 0, 0);
        pin.body.angularVelocity.set(0, 0, 0);

        pin.body.sleep();
        pin.fallen = false;
      } else {
        // Pin stays at current position, put to sleep to prevent micro-drift
        pin.body.velocity.set(0, 0, 0);
        pin.body.angularVelocity.set(0, 0, 0);
        pin.body.sleep();
      }
    });

    this.syncMeshes();
  }

  /**
   * Check if all bodies have settled / stopped moving
   */
  checkIfSettled() {
    const minSpeed = 0.05;
    const minRot = 0.08;

    if (this.batonBody && this.batonBody.type === CANNON.Body.DYNAMIC) {
      if (this.batonBody.velocity.length() > minSpeed || this.batonBody.angularVelocity.length() > minRot) {
        return false;
      }
    }

    for (let i = 0; i < this.pins.length; i++) {
      const b = this.pins[i].body;
      if (!b.isSleeping()) {
        if (b.velocity.length() > minSpeed || b.angularVelocity.length() > minRot) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Synchronize Cannon.js bodies with Three.js / A-Frame meshes
   */
  syncMeshes() {
    if (this.batonMesh && this.batonBody) {
      this.batonMesh.position.copy(this.batonBody.position);
      this.batonMesh.quaternion.copy(this.batonBody.quaternion);
    }

    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i];
      if (pin.mesh && pin.body) {
        pin.mesh.position.copy(pin.body.position);
        pin.mesh.quaternion.copy(pin.body.quaternion);
      }
    }
  }

  /**
   * Main step loop called every frame (e.g. A-Frame tick)
   */
  step(deltaTime) {
    if (!this.world) return;

    // Fixed timestep of 1/60s for deterministic, stable simulation
    const dt = Math.min(deltaTime, 0.1);
    this.world.step(1 / 60, dt, 3);
    this.syncMeshes();

    // Check settling phase
    if (this.isSettling) {
      this.settleTimer += dt;

      // Allow at least 1.2s flight/roll before triggering settle check
      const settled = (this.settleTimer > 1.2 && this.checkIfSettled()) || (this.settleTimer > 4.5);

      if (settled) {
        this.isSettling = false;
        this.roundInProgress = false;
        if (this.settleCallback) {
          const fallen = this.checkFallenPins();
          this.settleCallback(fallen);
        }
      }
    }
  }
}

window.molkkyPhysics = new MolkkyPhysics();
