/**
 * ============================================================================
 * INTERACTIONS WEBXR ET CONTRÔLEURS VR (META QUEST 3)
 * Fichier : js/controls.js - Classe VRControllerManager
 * ============================================================================
 * 
 * DESCRIPTION DU FONCTIONNEMENT :
 * 1. Accès direct à l'API WebXR Gamepad (Standard Meta Quest 3) :
 *    - Polling des manettes via `navigator.xr` et `xrSession.inputSources`.
 *    - Lecture en temps réel des axes de stick analogique et des valeurs analogiques des gâchettes.
 * 2. Ergonomie de lancer naturel (Throw Physics & Gesture Analysis) :
 *    - Problème classique en VR : au moment où les doigts relâchent la gâchette, la main décélère
 *      naturellement, ce qui fait tomber les objets virtuels aux pieds du joueur.
 *    - Solution mathématique développée : Un tampon glissant (FIFO) enregistre les vitesses
 *      vectorielles sur les 220 dernières millisecondes. La vitesse d'expulsion est calculée
 *      par une moyenne pondérée (65% vitesse de pointe + 35% moyenne de fin de geste) avec
 *      une légère portance (+Y) pour un arc parabolique réaliste.
 * 3. Séparation claire des contrôles pour éviter toute confusion en jeu :
 *    - Les 4 Gâchettes (Index et Grip des 2 mains) sont STRICTEMENT réservées au bâton (attraper/lancer).
 *    - Les Boutons de face A (droite) et X (gauche) sont STRICTEMENT réservés aux clics sur les boutons 3D.
 * 4. Locomotion fluide orientée regard (Gaze-Directed Locomotion) :
 *    - Joystick gauche : Le vecteur de déplacement est projeté selon le vecteur "forward" horizontal
 *      de la caméra. Pousser le stick vers le haut avance toujours dans la direction regardée par le joueur.
 *    - Joystick droit : Rotation fluide (yaw) de la scène pour pivoter sans se tordre le cou.
 * 5. Pipeline de Raycasting Hybride résilient (Boutons 3D) :
 *    - Combine l'intersection native A-Frame raycaster et un test géométrique Three.js cône/faisceau
 *      pour garantir un clic réactif même en pointant approximativement.
 * ============================================================================
 */

class VRControllerManager {
  constructor() {
    // Éléments du DOM et de la scène A-Frame
    this.leftHandEl = null;
    this.rightHandEl = null;
    this.leftRayEl = null;
    this.rightRayEl = null;
    this.batonEl = null;
    this.batonMesh = null;

    // État de prise en main du bâton
    this.heldByHand = null;         // 'left', 'right', ou null
    this.grabbedWithButton = null;   // 'trigger' (index) ou 'grip' (poignée)
    this.grabTimestamp = 0;
    this.lastTimestamp = 0;
    this.lastHandPos = new THREE.Vector3();
    this.velocityHistory = [];      // Historique des vecteurs vitesse pour la physique du lancer

    // État des interactions laser & UI 3D
    this.hoveredEls = { left: null, right: null };
    this.rayIntersectedEls = { left: [], right: [] };
    this.prevFaceButton = { left: false, right: false };
    this.isSqueezing = { left: false, right: false };
    this.lastActionTimestamp = 0;
    this.trajectoryLine = null;

    // Préférence d'inversion du déplacement (sauvegardée dans le localStorage)
    this.invertLocomotion = false;
    try {
      this.invertLocomotion = localStorage.getItem('molkky_invert_locomotion') === '1';
    } catch (e) {}

    this.init();
  }

  /* =========================================================================
   * 1. INITIALISATION DES ÉLÉMENTS ET DES ÉCOUTEURS D'ÉVÉNEMENTS
   * ========================================================================= */

  init() {
    const bindDom = () => {
      this.leftHandEl = document.getElementById('left-controller');
      this.rightHandEl = document.getElementById('right-controller');
      this.leftRayEl = document.getElementById('left-ray');
      this.rightRayEl = document.getElementById('right-ray');
      this.getBaton();

      this.setupEventListeners();
      this.setupDesktopFallback();
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', bindDom);
    } else {
      bindDom();
    }
  }

  setBaton(el) {
    this.batonEl = el;
    if (el && el.object3D) {
      this.batonMesh = el.object3D;
    }
  }

  getBaton() {
    if (!this.batonEl) {
      this.batonEl = document.getElementById('molkky-baton');
      if (this.batonEl && this.batonEl.object3D) {
        this.batonMesh = this.batonEl.object3D;
      }
    }
    return this.batonEl;
  }

  setupEventListeners() {
    // 1. Suivi des intersections des faisceaux lasers avec les boutons .clickable
    const bindRay = (rayEl, hand) => {
      if (!rayEl) return;
      rayEl.addEventListener('raycaster-intersection', (evt) => {
        if (evt.detail?.els?.length > 0) this.rayIntersectedEls[hand] = evt.detail.els;
      });
      rayEl.addEventListener('raycaster-intersection-cleared', () => {
        this.rayIntersectedEls[hand] = [];
      });
    };
    bindRay(this.leftRayEl, 'left');
    bindRay(this.rightRayEl, 'right');

    // 2. Écouteurs d'événements sur les manettes VR
    const bindController = (el, hand) => {
      if (!el) return;

      // Boutons de face (A/B droite, X/Y gauche) -> Dédiés au clic sur les boutons 3D
      ['abuttondown', 'bbuttondown', 'xbuttondown', 'ybuttondown'].forEach(evt => {
        el.addEventListener(evt, () => this.onFaceButtonPressed(hand));
      });
      el.addEventListener('buttondown', (evt) => {
        const id = evt.detail?.id;
        if (id === 3 || id === 4 || id === 5 || id === 'a' || id === 'x') {
          this.onFaceButtonPressed(hand);
        }
      });

      // Gâchettes (Index & Grip) -> Attraper le bâton
      ['triggerdown', 'selectstart', 'gripdown', 'squeezestart'].forEach(evt => {
        el.addEventListener(evt, () => this.checkAndGrab(hand, evt.includes('grip') ? 'grip' : 'trigger'));
      });

      // Relâchement des gâchettes -> Lancer le bâton (garde minimale de 200 ms)
      ['triggerup', 'selectend', 'gripup', 'squeezeend'].forEach(evt => {
        el.addEventListener(evt, () => {
          if (this.heldByHand === hand && (performance.now() - this.grabTimestamp) >= 200) {
            this.onRelease(hand);
          }
        });
      });
    };

    bindController(this.leftHandEl, 'left');
    bindController(this.rightHandEl, 'right');

    // Écouteurs globaux de secours pour les boutons A et X
    ['abuttondown', 'bbuttondown'].forEach(evt => {
      window.addEventListener(evt, () => this.onFaceButtonPressed('right'));
      document.addEventListener(evt, () => this.onFaceButtonPressed('right'));
    });
    ['xbuttondown', 'ybuttondown'].forEach(evt => {
      window.addEventListener(evt, () => this.onFaceButtonPressed('left'));
      document.addEventListener(evt, () => this.onFaceButtonPressed('left'));
    });
  }

  /* =========================================================================
   * 2. PRISE EN MAIN ET LANCER DU BÂTON (VR GRAB & THROW)
   * ========================================================================= */

  checkAndGrab(hand, buttonType = 'trigger') {
    if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;
    if (this.heldByHand) return;
    this.grabWithHand(hand, buttonType);
  }

  /**
   * Attache physiquement le bâton dans la main du joueur
   */
  grabWithHand(hand, buttonType = 'trigger') {
    if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;
    if (this.heldByHand) return;

    const handEl = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    const baton = this.getBaton();
    if (!handEl || !baton) return;

    this.heldByHand = hand;
    this.grabbedWithButton = buttonType;
    this.velocityHistory = [];
    this.grabTimestamp = performance.now();

    baton.setAttribute('visible', 'true');

    // Attache le mesh du bâton directement au contrôleur (zéro latence)
    if (this.batonMesh && handEl.object3D) {
      handEl.object3D.add(this.batonMesh);
      this.batonMesh.position.set(0, -0.02, -0.06); // Décalage dans la paume
      this.batonMesh.rotation.set(Math.PI / 4, 0, 0); // Légère inclinaison à 45°
      this.batonMesh.visible = true;
    }

    const handPos = new THREE.Vector3();
    handEl.object3D.getWorldPosition(handPos);
    this.lastHandPos.copy(handPos);
    this.lastTimestamp = performance.now();

    window.molkkyGame.state = 'AIMING';
    this.triggerHaptic(hand, 0.7, 90);
    if (window.soundEngine) window.soundEngine.playGrab(handPos);
  }

  /**
   * Déclenche le lancer physique lorsque le joueur relâche la gâchette
   */
  onRelease(hand) {
    if (this.heldByHand !== hand) return;
    this.heldByHand = null;
    this.grabbedWithButton = null;

    if (!window.molkkyGame || (window.molkkyGame.state !== 'AIMING' && window.molkkyGame.state !== 'READY')) {
      return;
    }

    this.hideTrajectory();
    const handEl = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    const scene = document.querySelector('a-scene');

    // Récupère la position et la rotation exacte dans le monde au moment du lâcher
    const releasePos = new THREE.Vector3();
    const releaseQuat = new THREE.Quaternion();

    if (this.batonMesh && this.batonMesh.parent) {
      this.batonMesh.getWorldPosition(releasePos);
      this.batonMesh.getWorldQuaternion(releaseQuat);

      // Ré-attache le bâton à la racine de la scène pour la simulation Cannon.js
      if (scene && scene.object3D) {
        scene.object3D.add(this.batonMesh);
        this.batonMesh.position.copy(releasePos);
        this.batonMesh.quaternion.copy(releaseQuat);
      }
    } else if (handEl) {
      handEl.object3D.getWorldPosition(releasePos);
      handEl.object3D.getWorldQuaternion(releaseQuat);
    } else {
      releasePos.set(0, 1.1, -0.3);
    }

    // Calcul de la vitesse de propulsion à partir de l'élan du bras
    const throwVel = this.calculateReleaseVelocity();

    // Torsion et rotation naturelle du bâton de bois en plein vol

}
