/**
 * ============================================================================
 * MODULE 2 : MOTEUR PHYSIQUE 3D ET COLLISIONS (CANNON.JS)
 * Fichier : js/physics.js - Classe MolkkyPhysics
 * ============================================================================
 * 
 * DESCRIPTION DU FONCTIONNEMENT ET ARCHITECTURE :
 * 1. Choix du moteur physique Cannon.js (Lightweight & WebGL-friendly) :
 *    - Contrairement à PhysX ou Ammo.js (lourds ports WebAssembly de plusieurs Mo),
 *      Cannon.js est écrit en pur JavaScript, ultra-léger et parfait pour maintenir
 *      du 72Hz / 90Hz stable sur le processeur mobile Snapdragon du Meta Quest 3.
 * 2. Modèle des Corps Rigides (Rigid Bodies) :
 *    - Les quilles et le bâton sont modélisés par des cylindres physiques (CANNON.Cylinder).
 *    - Le sol est un plan infini statique de masse nulle (CANNON.Plane).
 * 3. Propriétés des matériaux et coefficients de contact (ContactMaterial) :
 *    - Bois sur Gazon : Faible friction (0.04) et rebond modéré (restitution: 0.35)
 *      pour permettre au bâton de rouler naturellement sur la pelouse après l'impact.
 *    - Bois sur Bois : Rebond plus sec (restitution: 0.45) et friction (0.20) reproduisant
 *      le claquement et l'éparpillement réaliste des quilles lors d'un carreau.
 * 4. Algorithme de disposition géométrique triangulaire du Mölkky :
 *    - Décalage en ruche d'abeille avec rowOffset = d * sin(60°) = d * 0.866.
 * 5. Détection mathématique de la chute d'une quille (Quaternions & Produit Vectoriel) :
 *    - Transformation du vecteur vertical (0, 1, 0) par le quaternion d'orientation du corps.
 *    - Si la composante Y résultante est inférieure à 0.72 (inclinaison > 44°), la quille est
 *      déclarée tombée, conformément aux règles de la Fédération Internationale de Mölkky.
 * ============================================================================
 */

class MolkkyPhysics {
  constructor() {
    this.world = null;
    this.groundBody = null;
    this.batonBody = null;
    this.batonMesh = null;
    this.pins = []; // Collection d'objets { id, number, body, mesh, initialPos, fallen: false }
    this.isSettling = false;
    this.settleTimer = 0;
    this.settleCallback = null;
    this.roundInProgress = false;

    // Dimensions physiques réelles (Normes officielles finlandaises en mètres)
    this.PIN_RADIUS = 0.028;    // Rayon 2.8 cm (diamètre 5.6 cm)
    this.PIN_HEIGHT = 0.150;    // Hauteur 15 cm
    this.PIN_MASS = 0.28;       // Masse ~280 grammes (bois de bouleau)
    this.BATON_RADIUS = 0.027;  // Rayon 2.7 cm (diamètre 5.4 cm)
    this.BATON_HEIGHT = 0.225;  // Longueur 22.5 cm
    this.BATON_MASS = 0.38;     // Masse ~380 grammes (légèrement plus dense)

    this.initWorld();
  }

  /**
   * Initialise le monde physique Cannon.js, la gravité terrestre et les matériaux
   */
  initWorld() {
    if (typeof CANNON === 'undefined') {
      console.error('Cannon.js is not loaded!');
      return;
    }

    this.world = new CANNON.World();
    // Gravité standard terrestre (-9.81 m/s² sur l'axe Y)
    this.world.gravity.set(0, -9.81, 0);
    // Algorithme de détection de collision large (Broadphase)
    this.world.broadphase = new CANNON.NaiveBroadphase();
    // Précision du solveur de contraintes (12 itérations pour un compromis idéal stabilité/CPU)
    this.world.solver.iterations = 12;
    this.world.solver.tolerance = 0.001;
    // Mise en veille automatique des corps immobiles pour économiser le processeur
    this.world.allowSleep = true;

    // Déclaration des matériaux physiques
    const woodMaterial = new CANNON.Material('wood');
    const groundMaterial = new CANNON.Material('ground');

    // 1. Contact Bois <-> Gazon : glisse fluide et roulement doux sur la pelouse
    const woodGroundContact = new CANNON.ContactMaterial(woodMaterial, groundMaterial, {
      friction: 0.04,
      restitution: 0.35,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });

    // 2. Contact Bois <-> Bois : entrechoc dynamique et éparpillement des quilles
    const woodWoodContact = new CANNON.ContactMaterial(woodMaterial, woodMaterial, {
      friction: 0.20,
      restitution: 0.45,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });

    this.world.addContactMaterial(woodGroundContact);
    this.world.addContactMaterial(woodWoodContact);

    this.woodMaterial = woodMaterial;
    this.groundMaterial = groundMaterial;

    // Création du plancher infini statique (masse = 0 signifie corps inamovible)
    const groundShape = new CANNON.Plane();
    this.groundBody = new CANNON.Body({
      mass: 0,
      material: groundMaterial,
      shape: groundShape
    });
    // Rotation de -90° sur X pour orienter la normale du plan vers le haut (+Y)
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
      linearDamping: 0.005,
      angularDamping: 0.001
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

  /**
   * Disposition officielle en ruche d'abeille (compacte) des 12 quilles
   * Détails de disposition et géométrie :
   * - Les quilles sont ordonnées selon les règles internationales du Mölkky :
   *   Rangée 1 (devant) : 1, 2
   *   Rangée 2 : 3, 10, 4
   *   Rangée 3 (cœur)   : 5, 11, 12, 6  (les gros scores sont protégés au centre)
   *   Rangée 4 (fond)   : 7, 9, 8
   * - Géométrie hexagonale : L'écartement entre rangées vaut d * cos(30°) = d * 0.866.
   * - targetCenterZ : Recule ou avance le paquet selon la difficulté (-2.5m, -3.5m, -4.8m).
   */
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

  /**
   * Instancie les 12 corps rigides Cannon.js et les connecte à leurs meshes Three.js
   */
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

}
