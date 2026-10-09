/**
 * 3D Physics Engine for WebVR Mölkky using Cannon.js
 * Manages rigid bodies, collisions, restitution, pin fall detection, and upright reset
 * Hardened with NaN safeguards and crash protection
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
    this.world.solver.iterations = 12;
    this.world.solver.tolerance = 0.001;
    this.world.allowSleep = true;

    // Physical materials
    const woodMaterial = new CANNON.Material('wood');
    const groundMaterial = new CANNON.Material('ground');

    // Wood on grass contact
    const woodGroundContact = new CANNON.ContactMaterial(woodMaterial, groundMaterial, {
      friction: 0.55,
      restitution: 0.20,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });

    // Wood on wood contact
    const woodWoodContact = new CANNON.ContactMaterial(woodMaterial, woodMaterial, {
      friction: 0.35,
      restitution: 0.35,
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
    this.groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.groundBody.position.set(0, 0, 0);
    this.world.addBody(this.groundBody);
  }

  createCylinderShape(radius, height, segments = 12) {
    return new CANNON.Cylinder(radius, radius, height, segments);
  }

  setupBaton(mesh, startPos = { x: 0.35, y: 0.95, z: -0.25 }) {
    this.batonMesh = mesh;
    const batonShape = this.createCylinderShape(this.BATON_RADIUS, this.BATON_HEIGHT, 14);

    this.batonBody = new CANNON.Body({
      mass: this.BATON_MASS,
      material: this.woodMaterial,
      linearDamping: 0.06,
      angularDamping: 0.08
    });

    const qRot = new CANNON.Quaternion();
    qRot.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
    this.batonBody.addShape(batonShape, new CANNON.Vec3(0, 0, 0), qRot);

    this.batonBody.position.set(startPos.x, startPos.y, startPos.z);
    this.batonBody.type = CANNON.Body.KINEMATIC;
    this.world.addBody(this.batonBody);

    // Audio collision listener with speed filter
    this.batonBody.addEventListener('collide', (event) => {
      try {
        const contact = event.contact;
        let impactSpeed = 1.0;
        if (contact && typeof contact.getImpactVelocityAlongNormal === 'function') {
          impactSpeed = Math.abs(contact.getImpactVelocityAlongNormal());
        }
        // Only trigger on real hits (> 0.75 m/s) to avoid micro-rolling spam
        if (impactSpeed > 0.75 && window.soundEngine) {
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
      } catch (e) {}
    });
  }

  getMolkkyLayout(targetCenterZ = -3.5) {
    const d = this.PIN_RADIUS * 2.15;
    const rowOffset = d * 0.866;

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

  setupPins(pinMeshesByNumber, targetCenterZ = -3.5) {
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

      const qRot = new CANNON.Quaternion();
      qRot.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
      body.addShape(pinShape, new CANNON.Vec3(0, 0, 0), qRot);

      const initY = this.PIN_HEIGHT / 2 + 0.002;
      body.position.set(item.x, initY, item.z);
      this.world.addBody(body);

      body.addEventListener('collide', (e) => {
        try {
          let speed = 1.0;
          if (e.contact && typeof e.contact.getImpactVelocityAlongNormal === 'function') {
            speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
          }
          if (speed > 0.75 && window.soundEngine) {
            const pos = { x: body.position.x, y: body.position.y, z: body.position.z };
            if (e.body === this.groundBody) {
              window.soundEngine.playGrassImpact(pos, speed * 0.8);
            } else {
              window.soundEngine.playWoodImpact(pos, speed);
            }
          }
        } catch (err) {}
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

  launchBaton(worldPos, linVel, angVel) {
    if (!this.batonBody) return;

    // Safety checks against NaN
    const px = isFinite(worldPos.x) ? worldPos.x : 0;
    const py = isFinite(worldPos.y) ? worldPos.y : 1.1;
    const pz = isFinite(worldPos.z) ? worldPos.z : -0.3;

    const vx = isFinite(linVel.x) ? linVel.x : 0;
    const vy = isFinite(linVel.y) ? linVel.y : 1.5;
    const vz = isFinite(linVel.z) ? linVel.z : -4.5;

    const wx = isFinite(angVel.x) ? angVel.x : 0;
    const wy = isFinite(angVel.y) ? angVel.y : -4;
    const wz = isFinite(angVel.z) ? angVel.z : 0;

    this.batonBody.type = CANNON.Body.DYNAMIC;
    this.batonBody.wakeUp();
    this.batonBody.position.set(px, py, pz);
    this.batonBody.velocity.set(vx, vy, vz);
    this.batonBody.angularVelocity.set(wx, wy, wz);

    this.pins.forEach(p => p.body.wakeUp());

    this.roundInProgress = true;
    this.isSettling = true;
    this.settleTimer = 0;
  }

  holdBaton(worldPos, worldQuat) {
    if (!this.batonBody) return;
    const px = isFinite(worldPos.x) ? worldPos.x : 0.35;
    const py = isFinite(worldPos.y) ? worldPos.y : 0.95;
    const pz = isFinite(worldPos.z) ? worldPos.z : -0.25;

    this.batonBody.type = CANNON.Body.KINEMATIC;
    this.batonBody.position.set(px, py, pz);
    if (worldQuat && isFinite(worldQuat.x)) {
      this.batonBody.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w);
    }
    this.batonBody.velocity.set(0, 0, 0);
    this.batonBody.angularVelocity.set(0, 0, 0);
  }

  resetBatonToStand(standPos = { x: 0.35, y: 0.95, z: -0.25 }) {
    if (!this.batonBody) return;
    this.batonBody.type = CANNON.Body.KINEMATIC;
    this.batonBody.position.set(standPos.x, standPos.y, standPos.z);
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2);
    this.batonBody.quaternion.copy(q);
    this.batonBody.velocity.set(0, 0, 0);
    this.batonBody.angularVelocity.set(0, 0, 0);
    this.syncMeshes();

    // Ensure baton entity is visible
    if (window.vrControllerManager) {
      const baton = window.vrControllerManager.getBaton();
      if (baton) baton.setAttribute('visible', 'true');
    }
  }

  checkFallenPins() {
    const fallenPins = [];

    this.pins.forEach(pin => {
      const body = pin.body;
      const up = new CANNON.Vec3(0, 1, 0);
      const worldUp = body.quaternion.vmult(up);

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

  standFallenPinsUpright() {
    this.pins.forEach(pin => {
      if (pin.fallen) {
        // Safe position check
        const posX = isFinite(pin.body.position.x) ? pin.body.position.x : pin.initialPos.x;
        const posZ = isFinite(pin.body.position.z) ? pin.body.position.z : pin.initialPos.z;
        const standingY = this.PIN_HEIGHT / 2 + 0.003;

        pin.body.wakeUp();
        pin.body.position.set(posX, standingY, posZ);

        pin.body.quaternion.set(0, 0, 0, 1);
        pin.body.velocity.set(0, 0, 0);
        pin.body.angularVelocity.set(0, 0, 0);

        pin.body.sleep();
        pin.fallen = false;
      } else {
        pin.body.velocity.set(0, 0, 0);
        pin.body.angularVelocity.set(0, 0, 0);
        pin.body.sleep();
      }
    });

    this.syncMeshes();
  }

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

  syncMeshes() {
    try {
      if (this.batonMesh && this.batonBody && isFinite(this.batonBody.position.x)) {
        this.batonMesh.position.copy(this.batonBody.position);
        this.batonMesh.quaternion.copy(this.batonBody.quaternion);
      }

      for (let i = 0; i < this.pins.length; i++) {
        const pin = this.pins[i];
        if (pin.mesh && pin.body && isFinite(pin.body.position.x)) {
          pin.mesh.position.copy(pin.body.position);
          pin.mesh.quaternion.copy(pin.body.quaternion);
        }
      }
    } catch (e) {}
  }

  step(deltaTime) {
    if (!this.world) return;

    try {
      const dt = Math.min(Math.max(deltaTime, 0.001), 0.05);
      this.world.step(1 / 60, dt, 3);
      this.syncMeshes();

      if (this.isSettling) {
        this.settleTimer += dt;
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
    } catch (err) {
      console.warn('Physics loop error caught:', err);
    }
  }
}

window.molkkyPhysics = new MolkkyPhysics();
