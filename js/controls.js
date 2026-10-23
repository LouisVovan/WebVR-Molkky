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
    const speed = throwVel.length();
    const angVel = new THREE.Vector3(-speed * 2.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.5);

    if (speed > 0.1) {
      releasePos.add(throwVel.clone().normalize().multiplyScalar(0.10));
    }

    this.triggerHaptic(hand, 0.9, 130);

    // Lancement dans le moteur physique Cannon.js
    if (window.molkkyPhysics) {
      window.molkkyPhysics.launchBaton(releasePos, throwVel, angVel);
    }
    if (window.soundEngine) {
      window.soundEngine.playThrow(releasePos, speed);
    }

    window.molkkyGame.onThrowLaunched();
  }

  /**
   * Synthétise la vitesse de lancer en combinant vitesse de pointe et moyenne de fin de geste
   * Principe ergonomique et physique du lancer VR :
   * 1. Échantillonnage temporel : Récupère les vecteurs vitesses des 220 dernières millisecondes.
   * 2. Moyenne pondérée dans le temps : Les frames les plus récentes reçoivent un poids plus fort.
   * 3. Compensation du relâchement des doigts : Un joueur de VR ralentit inconsciemment son bras
   *    au moment précis où il ouvre les doigts pour lâcher la gâchette.
   *    -> Pour compenser ce biais physiologique, on mélange 65% de la vitesse de pointe maximale
   *       enregistrée pendant l'élan + 35% de la vitesse moyenne.
   * 4. Portance balistique : Ajout d'une composante verticale (+Y) pour former une belle parabole.
   * 5. Aide à la visée douce (20% regard) : Aligne subtilement la direction du lancer avec l'orientation
   *    de la tête pour éviter les lancers aberrants vers l'arrière ou les murs réels de la pièce.
   */
  calculateReleaseVelocity() {
    const targetZ = window.molkkyGame?.difficultyConfigs[window.molkkyGame.difficulty]?.distance || -3.5;
    const dist = Math.abs(targetZ);
    const now = performance.now();

    // Filtre les échantillons des 220 dernières millisecondes
    const samples = this.velocityHistory.filter(s => (now - s.time) < 220);
    if (samples.length === 0) {
      return new THREE.Vector3(0, 1.8, -dist * 1.45);
    }

    let maxSpeed = 0;
    let peakVel = null;
    const avgVel = new THREE.Vector3();
    let totalWeight = 0;

    // Calcul de la moyenne pondérée dans le temps
    samples.forEach((s, i) => {
      if (!isFinite(s.vel.length())) return;
      const spd = s.vel.length();
      if (spd > maxSpeed) {
        maxSpeed = spd;
        peakVel = s.vel.clone();
      }
      const weight = i + 1;
      avgVel.addScaledVector(s.vel, weight);
      totalWeight += weight;
    });

    if (totalWeight > 0) avgVel.divideScalar(totalWeight);

    // Mélange 65% pointe + 35% moyenne
    const finalVel = new THREE.Vector3();
    if (peakVel && maxSpeed > 0.8) {
      finalVel.addScaledVector(peakVel, 0.65).addScaledVector(avgVel, 0.35);
    } else {
      finalVel.copy(avgVel);
    }

    // Multiplicateur pour un lancer dynamique et sans fatigue musculaire excessive
    finalVel.multiplyScalar(2.2);

    // Portance parabolique (+Y) pour un arc balistique gracieux
    const currentSpeed = finalVel.length();
    if (currentSpeed > 0.4) finalVel.y += 0.45 * Math.min(currentSpeed, 4.0);

    // Force la propulsion vers l'avant (-Z)
    if (finalVel.z > 0.2) finalVel.z = -Math.abs(finalVel.z);

    // Assistance d'alignement avec la direction du regard (20%)
    const camera = document.getElementById('camera');
    if (camera?.object3D) {
      const camDir = new THREE.Vector3();
      camera.object3D.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();
      if (finalVel.clone().normalize().dot(camDir) > 0.15) {
        const hMag = Math.hypot(finalVel.x, finalVel.z);
        const blended = new THREE.Vector3(finalVel.x, 0, finalVel.z)
          .normalize().multiplyScalar(0.8)
          .addScaledVector(camDir, 0.2)
          .normalize().multiplyScalar(hMag);
        finalVel.x = blended.x;
        finalVel.z = blended.z;
      }
    }

    // Sécurités de vitesse min et max
    if (!isFinite(finalVel.length()) || finalVel.length() < 1.8) {
      finalVel.set(0, 1.8, -dist * 1.45);
    }
    if (finalVel.length() > 22) finalVel.normalize().multiplyScalar(22);

    return finalVel;
  }

  resetToStand() {
    this.heldByHand = null;
    this.grabbedWithButton = null;
    this.velocityHistory = [];
    const baton = this.getBaton();
    if (baton) baton.setAttribute('visible', 'true');
    this.hideTrajectory();
  }

  /* =========================================================================
   * 3. INTERACTIONS LASER & CLIC SUR LES BOUTONS (BOUTONS A ET X)
   * ========================================================================= */

  /**
   * Trouve le bouton .clickable le plus proche d'un rayon dans l'espace 3D
   */
  findClickableNearRay(origin, dir, maxPerpDist = 0.85, minForwardDist = 0.3) {
    const ray = new THREE.Ray(origin, dir);
    const clickables = Array.from(document.querySelectorAll('.clickable'));
    let bestEl = null;
    let minPerp = maxPerpDist;

    for (const el of clickables) {
      if (el.id === 'molkky-baton' || !el.object3D) continue;
      // Ignore les éléments dans une bannière masquée
      const hiddenParent = el.closest('[visible="false"]');
      if (hiddenParent) continue;

      const pos = new THREE.Vector3();
      el.object3D.getWorldPosition(pos);

      const toBtn = pos.clone().sub(origin);
      if (toBtn.dot(dir) > minForwardDist) {
        const perpDist = ray.distanceToPoint(pos);
        if (perpDist < minPerp) {
          minPerp = perpDist;
          bestEl = el;
        }
      }
    }
    return bestEl;
  }

  /**
   * Raycast direct depuis la manette pour détecter les boutons survolés
   */
  getIntersectedClickable(hand) {
    const rayEl = hand === 'left' ? this.leftRayEl : this.rightRayEl;
    const ctrlEl = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    if (!rayEl) return null;

    // 1. Vérification des raycasters A-Frame (laser et manette)
    for (const el of [rayEl, ctrlEl]) {
      const rc = el?.components?.raycaster;
      if (rc?.intersectedEls?.length > 0) {
        for (const hit of rc.intersectedEls) {
          if (!hit || hit.id === 'molkky-baton') continue;
          const clickable = hit.classList.contains('clickable') ? hit : hit.closest('.clickable');
          if (clickable && clickable.id !== 'molkky-baton') return clickable;
        }
      }
    }

    // 2. Raycast direct Three.js
    if (rayEl.object3D) {
      rayEl.object3D.updateMatrixWorld(true);
      const origin = new THREE.Vector3();
      const dir = new THREE.Vector3(0, 0, -1);
      rayEl.object3D.getWorldPosition(origin);
      const quat = new THREE.Quaternion();
      rayEl.object3D.getWorldQuaternion(quat);
      dir.applyQuaternion(quat).normalize();

      const threeRc = new THREE.Raycaster(origin, dir, 0.1, 12);
      const candidateMeshes = [];
      const meshToEl = new Map();

      document.querySelectorAll('.clickable').forEach(el => {
        if (el.id === 'molkky-baton' || !el.object3D) return;
        el.object3D.traverse(child => {
          if (child.isMesh) {
            candidateMeshes.push(child);
            meshToEl.set(child, el);
          }
        });
      });

      const hits = threeRc.intersectObjects(candidateMeshes, false);
      if (hits.length > 0) {
        return meshToEl.get(hits[0].object) || null;
      }
    }

    return null;
  }

  getTargetFromHand(hand) {
    const rayEl = hand === 'left' ? this.leftRayEl : this.rightRayEl;
    if (!rayEl?.object3D) return null;

    rayEl.object3D.updateMatrixWorld(true);
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3(0, 0, -1);
    rayEl.object3D.getWorldPosition(origin);
    const quat = new THREE.Quaternion();
    rayEl.object3D.getWorldQuaternion(quat);
    dir.applyQuaternion(quat).normalize();

    return this.findClickableNearRay(origin, dir, 0.85, 0.3);
  }

  getTargetFromGaze() {
    const camera = document.getElementById('camera');
    if (!camera?.object3D) return null;

    camera.object3D.updateMatrixWorld(true);
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3(0, 0, -1);
    camera.object3D.getWorldPosition(origin);
    const quat = new THREE.Quaternion();
    camera.object3D.getWorldQuaternion(quat);
    dir.applyQuaternion(quat).normalize();

    return this.findClickableNearRay(origin, dir, 0.95, 0.4);
  }

  getBannerOrTotemFallback() {
    // Si la bannière de victoire ou défaite est affichée
    const vic = document.getElementById('vr-victory-group');
    const def = document.getElementById('vr-defeat-group');
    if (vic && vic.getAttribute('visible') !== 'false') return document.getElementById('vr-vic-btn-replay');
    if (def && def.getAttribute('visible') !== 'false') return document.getElementById('vr-def-btn-retry');

    // Sur le totem : bouton le plus aligné avec la direction du regard
    const camera = document.getElementById('camera');
    if (!camera?.object3D) return null;
    const camDir = new THREE.Vector3();
    camera.object3D.getWorldDirection(camDir);

    let bestEl = null;
    let maxDot = 0.45;
    for (const id of ['vr-btn-new', 'vr-btn-diff', 'vr-btn-grab', 'vr-btn-joy']) {
      const el = document.getElementById(id);
      if (!el?.object3D) continue;
      const pos = new THREE.Vector3();
      el.object3D.getWorldPosition(pos);
      const toBtn = pos.sub(camera.object3D.position).normalize();
      const dot = camDir.dot(toBtn);
      if (dot > maxDot) {
        maxDot = dot;
        bestEl = el;
      }
    }
    return bestEl;
  }

  /**
   * Déclenché lors de l'appui sur le Bouton A ou X
   * Résout le bouton visé et exécute le clic
   */
  onFaceButtonPressed(hand) {
    const otherHand = hand === 'left' ? 'right' : 'left';

    const target =
      this.hoveredEls[hand] ||
      this.hoveredEls[otherHand] ||
      this.getIntersectedClickable(hand) ||
      this.getIntersectedClickable(otherHand) ||
      this.getTargetFromHand(hand) ||
      this.getTargetFromHand(otherHand) ||
      this.getTargetFromGaze() ||
      this.getBannerOrTotemFallback();

    if (target) {
      this.handleElementClick(target, hand);
    }
  }

  /**
   * Exécute l'action associée à un bouton 3D cliqué
   */
  handleElementClick(rawEl, hand) {
    if (!rawEl) return;
    const now = performance.now();
    if (now - this.lastActionTimestamp < 220) return;
    this.lastActionTimestamp = now;

    // Résolution de l'élément cliquable parent si on a touché du texte 3D
    const el = rawEl.classList?.contains('clickable')
      ? rawEl
      : (rawEl.closest?.('.clickable') || rawEl) || rawEl;
    const id = (el.id || rawEl.id || '').toLowerCase();

    // Retour haptique et sonore
    this.triggerHaptic(hand, 0.75, 80);
    if (window.soundEngine) {
      const pos = el.object3D ? el.object3D.position : { x: 2.0, y: 1.2, z: -1.6 };
      window.soundEngine.playWhoosh(pos, 0.45);
    }

    // Animation visuelle de clic (enfoncement et rebond)
    el.setAttribute('scale', '0.90 0.90 0.90');
    setTimeout(() => {
      el.setAttribute('scale', this.hoveredEls[hand] === el ? '1.08 1.08 1.08' : '1 1 1');
    }, 120);

    // Déclenchement de l'action selon l'ID du bouton
    if (id.includes('new') || id.includes('recommencer') || id.includes('restart')) {
      if (window.molkkyGame) window.molkkyGame.startNewGame();
    } else if (id.includes('diff') || id.includes('niveau')) {
      if (window.molkkyGame) {
        const levels = ['facile', 'normal', 'difficile'];
        const next = levels[(levels.indexOf(window.molkkyGame.difficulty) + 1) % levels.length];
        window.molkkyGame.startNewGame(next);
      }
    } else if (id.includes('grab') || id.includes('baton') || id.includes('rappeler')) {
      this.grabWithHand(hand || 'right', 'trigger');
    } else if (id.includes('joy')) {
      this.toggleLocomotionInvert();
    } else if (id.includes('replay') || id.includes('rejouer') || id.includes('retry') || id.includes('reessayer')) {
      if (window.molkkyGame) {
        window.molkkyGame.closeGameOverModal();
        window.molkkyGame.startNewGame();
      }
      if (window.vrCelebration) window.vrCelebration.dismiss();
    } else if (id.includes('next')) {
      if (window.molkkyGame) {
        const levels = ['facile', 'normal', 'difficile'];
        const next = levels[Math.min(levels.indexOf(window.molkkyGame.difficulty) + 1, levels.length - 1)];
        window.molkkyGame.startNewGame(next);
      }
      if (window.vrCelebration) window.vrCelebration.dismiss();
    } else if (id.includes('easier')) {
      if (window.molkkyGame) window.molkkyGame.startNewGame('facile');
      if (window.vrCelebration) window.vrCelebration.dismiss();
    }

    // Exécution de la fonction directe attachée si présente
    if (typeof el.onButtonClick === 'function') el.onButtonClick();
    else if (typeof rawEl.onButtonClick === 'function') rawEl.onButtonClick();

    // Émission des événements DOM et A-Frame
    el.emit('click', { hand, fromVR: true, fromButtonA: true });
    el.dispatchEvent(new CustomEvent('click', { detail: { hand, fromVR: true, fromButtonA: true }, bubbles: true }));
  }

  triggerHaptic(hand, intensity = 0.5, duration = 60) {
    const el = hand === 'left' ? this.leftHandEl : this.rightHandEl;
    if (!el) return;
    try {
      const controller = el.components['meta-touch-controls'] || el.components['oculus-touch-controls'] || el.components['tracked-controls'];
      const gp = controller?.controller?.gamepad;
      if (gp?.hapticActuators?.[0]) {
        gp.hapticActuators[0].pulse(intensity, duration);
      }
    } catch (e) {}
  }

  updateRayInteractions() {
    for (const hand of ['left', 'right']) {
      const closestEl = this.getIntersectedClickable(hand);
      const prevHovered = this.hoveredEls[hand];

      if (closestEl !== prevHovered) {
        if (prevHovered) {
          if (prevHovered._origColor) prevHovered.setAttribute('color', prevHovered._origColor);
          prevHovered.setAttribute('scale', '1 1 1');
          prevHovered.emit('mouseleave', { hand, fromVR: true });
        }
        if (closestEl) {
          if (!closestEl._origColor) closestEl._origColor = closestEl.getAttribute('color') || '#ffffff';
          let hoverColor = '#fbbf24';
          if (closestEl.id === 'vr-btn-diff' || closestEl.id.includes('next')) hoverColor = '#60a5fa';
          else if (closestEl.id === 'vr-btn-grab') hoverColor = '#34d399';
          else if (closestEl.id === 'vr-btn-joy') hoverColor = '#c084fc';

          closestEl.setAttribute('color', hoverColor);
          closestEl.setAttribute('scale', '1.08 1.08 1.08');
          this.triggerHaptic(hand, 0.25, 25);
          closestEl.emit('mouseenter', { hand, fromVR: true });
        }
        this.hoveredEls[hand] = closestEl;
      }
    }
  }

  toggleLocomotionInvert() {
    this.invertLocomotion = !this.invertLocomotion;
    try {
      localStorage.setItem('molkky_invert_locomotion', this.invertLocomotion ? '1' : '0');
    } catch (e) {}

    const label = this.invertLocomotion ? 'Inversé' : 'Normal';
    if (window.molkkyGame) window.molkkyGame.showFeedback(`Joystick Déplacement : ${label}`, 'info');
    const btnTxt = document.getElementById('vr-btn-joy-text');
    if (btnTxt) btnTxt.setAttribute('value', `Joystick : ${label}`);
  }

  /* =========================================================================
   * 4. BOUCLE PRINCIPALE DE MISE À JOUR (CHAQUE FRAME)
   * ========================================================================= */

  update(time, deltaTime) {
    try {
      this.updateRayInteractions();
      this.updateWebXRGamepads(deltaTime);

      if (!this.heldByHand) {
        this.hideTrajectory();
        return;
      }

      // Enregistre les positions pour la vélocité de lancer
      const handEl = this.heldByHand === 'left' ? this.leftHandEl : this.rightHandEl;
      if (!handEl) return;

      const handPos = new THREE.Vector3();
      handEl.object3D.getWorldPosition(handPos);
      if (!isFinite(handPos.x)) return;

      const now = performance.now();
      const dt = Math.max((now - this.lastTimestamp) / 1000, 0.001);

      if (dt > 0.003) {
        const vel = new THREE.Vector3().subVectors(handPos, this.lastHandPos).divideScalar(dt);
        if (isFinite(vel.x)) {
          this.velocityHistory.push({ vel, time: now });
          if (this.velocityHistory.length > 25) this.velocityHistory.shift();
        }
        this.lastHandPos.copy(handPos);
        this.lastTimestamp = now;
      }

      // Guide de trajectoire visuelle en mode Facile
      if (window.molkkyGame?.difficulty === 'facile') {
        this.renderTrajectoryArc(handPos, this.calculateReleaseVelocity());
      } else {
        this.hideTrajectory();
      }
    } catch (e) {
      console.warn('VR update error:', e);
    }
  }

  /**
   * Lecture directe de l'API WebXR Gamepad pour Meta Quest 3 :
   * - Déplacement caméra (stick gauche)
   * - Rotation caméra (stick droit)
   * - Clic boutons A/X (boutons de face b >= 2)
   * - Prise / Lancer du bâton (gâchettes index & grip)
   */
  updateWebXRGamepads(deltaTime) {
    const scene = document.querySelector('a-scene');
    if (!scene?.xrSession) return;

    const rig = document.getElementById('rig');
    const camera = document.getElementById('camera');
    if (!rig || !camera) return;

    for (const source of scene.xrSession.inputSources) {
      if (!source.gamepad) continue;
      const gp = source.gamepad;
      const hand = source.handedness;

      const axisX = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] || 0);
      const axisY = gp.axes.length >= 4 ? gp.axes[3] : (gp.axes[1] || 0);

      const triggerVal = gp.buttons[0] ? (gp.buttons[0].value || (gp.buttons[0].pressed ? 1 : 0)) : 0;
      const gripVal = gp.buttons[1] ? (gp.buttons[1].value || (gp.buttons[1].pressed ? 1 : 0)) : 0;

      // 1. JOYSTICK GAUCHE : Déplacement fluide aligné sur la caméra
      if (hand === 'left' && (Math.abs(axisX) > 0.12 || Math.abs(axisY) > 0.12)) {
        const forward = new THREE.Vector3();
        camera.object3D.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const sign = this.invertLocomotion ? -1 : 1;

        const moveDir = new THREE.Vector3()
          .addScaledVector(forward, axisY * sign)
          .addScaledVector(right, -axisX * sign);
        if (moveDir.lengthSq() > 0.001) moveDir.normalize();

        const moveSpeed = 2.4 * Math.min(Math.hypot(axisX, axisY), 1.0) * (deltaTime / 1000);
        rig.object3D.position.addScaledVector(moveDir, moveSpeed);

        // Limites de jeu autour du terrain
        rig.object3D.position.x = Math.max(Math.min(rig.object3D.position.x, 8), -8);
        rig.object3D.position.z = Math.max(Math.min(rig.object3D.position.z, 2), -6);
      }

      // 2. JOYSTICK DROIT : Rotation fluide de la vue
      if (hand === 'right' && Math.abs(axisX) > 0.12) {
        rig.object3D.rotation.y -= axisX * 2.3 * (deltaTime / 1000);
      }

      // 3. BOUTONS DE FACE (A / X / B / Y) : Clic UI
      let facePressed = false;
      for (let b = 2; b < gp.buttons.length; b++) {
        if (gp.buttons[b] && (gp.buttons[b].pressed || gp.buttons[b].value > 0.5)) {
          facePressed = true;
          break;
        }
      }

      if (facePressed && !this.prevFaceButton[hand]) {
        this.onFaceButtonPressed(hand);
      }
      this.prevFaceButton[hand] = facePressed;

      // 4. LES 4 GÂCHETTES (Index + Grip) : Attraper et lancer le bâton
      const isPulling = triggerVal > 0.40 || gripVal > 0.40;
      const isReleased = triggerVal < 0.18 && gripVal < 0.18;

      if (!this.heldByHand) {
        if (isPulling && !this.isSqueezing[hand]) {
          this.isSqueezing[hand] = true;
          this.checkAndGrab(hand, triggerVal > 0.40 ? 'trigger' : 'grip');
        }
      } else if (this.heldByHand === hand) {
        if (isReleased && (performance.now() - this.grabTimestamp) >= 200) {
          this.isSqueezing[hand] = false;
          this.onRelease(hand);
        }
      }

      if (isReleased) {
        this.isSqueezing[hand] = false;
      }
    }
  }

  /* =========================================================================
   * 5. ARC DE TRAJECTOIRE EN MODE FACILE & FALLBACK BUREAU (DESKTOP)
   * ========================================================================= */

  renderTrajectoryArc(startPos, velocity) {
    const scene = document.querySelector('a-scene');
    if (!scene?.object3D || !isFinite(velocity.x) || !isFinite(startPos.x)) return;

    if (!this.trajectoryLine) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 3), 3));
      this.trajectoryLine = new THREE.Line(geom, new THREE.LineBasicMaterial({
        color: 0xfacc15,
        linewidth: 3,
        transparent: true,
        opacity: 0.85
      }));
      this.trajectoryLine.frustumCulled = false;
      scene.object3D.add(this.trajectoryLine);
    }

    const pos = this.trajectoryLine.geometry.attributes.position.array;
    const gravity = new THREE.Vector3(0, -9.81, 0);
    const dt = 0.035;
    const p = startPos.clone();
    const v = velocity.clone();

    for (let i = 0; i < 30; i++) {
      pos[i * 3]     = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      p.addScaledVector(v, dt);
      v.addScaledVector(gravity, dt);

      if (p.y < 0.01) {
        for (let j = i + 1; j < 30; j++) {
          pos[j * 3]     = p.x;
          pos[j * 3 + 1] = 0.01;
          pos[j * 3 + 2] = p.z;
        }
        break;
      }
    }
    this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
    this.trajectoryLine.visible = true;
  }

  hideTrajectory() {
    if (this.trajectoryLine) this.trajectoryLine.visible = false;
  }

  setupDesktopFallback() {
    let isAiming = false;
    let startX = 0, startY = 0;

    window.addEventListener('mousedown', (e) => {
      if (e.target.closest?.('#hud-container') || e.target.closest?.('.modal-overlay') || e.target.closest?.('#vr-totem') || e.target.closest?.('.clickable')) return;
      if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;

      isAiming = true;
      startX = e.clientX;
      startY = e.clientY;
      window.molkkyGame.state = 'AIMING';
    });

    window.addEventListener('mouseup', (e) => {
      if (!isAiming || !window.molkkyGame || window.molkkyGame.state !== 'AIMING') return;
      isAiming = false;

      const power = Math.max(Math.min((startY - e.clientY) * 0.045, 12), 3.5);
      const angle = Math.max(Math.min((e.clientX - startX) * 0.003, 1.2), -1.2);
      const targetZ = window.molkkyGame.difficultyConfigs[window.molkkyGame.difficulty].distance;
      const dist = Math.abs(targetZ);

      const linVel = new THREE.Vector3(
        angle * 2.2,
        Math.max(power * 0.45, 1.6),
        -Math.max(dist * 1.45 + (power - 5) * 0.4, 3.8)
      );
      const angVel = new THREE.Vector3((Math.random() - 0.5) * 2, -5, (Math.random() - 0.5) * 2);
      const launchPos = new THREE.Vector3(0, 1.1, -0.3);

      if (window.molkkyPhysics) window.molkkyPhysics.launchBaton(launchPos, linVel, angVel);
      if (window.soundEngine) window.soundEngine.playThrow(launchPos, linVel.length());
      window.molkkyGame.onThrowLaunched();
    });
  }

  executeSimulatedThrow(powerModifier = 1.0, horizontalAim = 0.0) {
    if (!window.molkkyGame || window.molkkyGame.state !== 'READY') return;
    const targetZ = window.molkkyGame.difficultyConfigs[window.molkkyGame.difficulty].distance;
    const dist = Math.abs(targetZ);

    const linVel = new THREE.Vector3(
      horizontalAim * 0.8 + (Math.random() - 0.5) * 0.15,
      1.75 * Math.sqrt(powerModifier),
      -(dist * 1.55 * powerModifier)
    );
    const angVel = new THREE.Vector3(-4, -2, 1);
    const launchPos = new THREE.Vector3(0, 1.05, -0.3);

    if (window.molkkyPhysics) window.molkkyPhysics.launchBaton(launchPos, linVel, angVel);
    if (window.soundEngine) window.soundEngine.playThrow(launchPos, linVel.length());
    window.molkkyGame.onThrowLaunched();
  }
}

window.vrControllerManager = new VRControllerManager();
