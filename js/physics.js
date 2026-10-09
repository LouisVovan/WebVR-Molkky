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


}
