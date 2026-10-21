/**
 * ============================================================================
 * SCÈNE 3D, GRAPHISMES ET IMMERSION VISUELLE
 * Fichier : js/scene.js - Composant A-Frame 'molkky-manager'
 * ============================================================================
 * 
 * DESCRIPTION DU FONCTIONNEMENT :
 * 1. Architecture Entity-Component-System (ECS) d'A-Frame :
 *    - Le composant 'molkky-manager' centralise la création du monde et la boucle
 *      d'animation principale (tick).
 * 2. Génération procédurale des textures en mémoire vive (RAM) :
 *    - Zéro temps de chargement réseau pour les textures bois et gazon (via HTML5 Canvas).
 * 3. Modélisation géométrique Three.js fidèle aux normes officielles du Mölkky :
 *    - Quilles de 15 cm de hauteur avec biseau supérieur taillé à 45° face au lanceur.
 *    - Numéros pyrogravés sur la face biseautée (CanvasTexture dynamique 1 à 12).
 *    - Bâton de lancer (22.5 cm x 5.4 cm) avec double bague en noyer sculpté.
 * 4. Totem de score 3D diégétique (UI spatiale intégrée dans l'univers virtuel) :
 *    - Positionné ergonomiquement à 2 mètres à droite du joueur, pivoté de -48°
 *      vers la caméra pour éviter toute obstruction de la zone de lancer.
 *    - Éclairage autonome via une lanterne 3D (point light) pour créer du relief.
 * 5. Boucle d'animation 60 FPS (méthode tick) :
 *    - Synchronisation rigoureuse de la physique Cannon.js, des manettes WebXR,
 *      des particules de victoire et de l'écouteur spatial Web Audio API.
 * ============================================================================
 */

AFRAME.registerComponent('molkky-manager', {
  init: function () {
    // Dictionnaire associant le numéro officiel (1 à 12) à son objet 3D Three.js
    this.pinMeshesByNum = {};
    this.woodTexture = null;
    this.grassTexture = null;

    // Procédure d'initialisation ordonnée une fois la scène A-Frame chargée
    const onReady = () => {
      // 1. Textures procédurales Canvas -> Three.js CanvasTexture
      try { this.setupMaterials(); } catch (e) { console.warn('setupMaterials warning:', e); }
      // 2. Décor extérieur (arbres en forêt, piquets de clôture)
      try { this.buildEnvironment(); } catch (e) { console.warn('buildEnvironment warning:', e); }
      // 3. Totem de score interactif en bois sculpté
      try { this.buildScoreTotem(); } catch (e) { console.warn('buildScoreTotem warning:', e); }
      // 4. Ligne de lancer officielle (le Mölkkaari) et pupitre repose-bâton
      try { this.buildThrowZone(); } catch (e) { console.warn('buildThrowZone warning:', e); }
      // 5. Instanciation des 12 quilles et du bâton de lancer
      try { this.buildPinsAndBaton(); } catch (e) { console.error('buildPinsAndBaton error:', e); }

      // 6. Lancement de la partie inaugurale au niveau Normal (-3.5m)
      try {
        if (window.molkkyGame) {
          window.molkkyGame.startNewGame('normal');
        }
      } catch (e) {
        console.error('startNewGame error:', e);
      }
    };

    // Si A-Frame a déjà fini de charger, on exécute directement, sinon on écoute l'événement 'loaded'
    if (this.el.sceneEl.hasLoaded) {
      onReady();
    } else {
      this.el.sceneEl.addEventListener('loaded', onReady);
    }
  },

  setupMaterials: function () {
    // Texture procédurale bois via Canvas
    const woodCanvas = TextureGenerator.createWoodCanvas(512, 512);
    this.woodTexture = new THREE.CanvasTexture(woodCanvas);
    this.woodTexture.wrapS = THREE.RepeatWrapping;
    this.woodTexture.wrapT = THREE.RepeatWrapping;

    // Texture procédurale herbe via Canvas
    const grassCanvas = TextureGenerator.createGrassCanvas(512, 512);
    this.grassTexture = new THREE.CanvasTexture(grassCanvas);
    this.grassTexture.wrapS = THREE.RepeatWrapping;
    this.grassTexture.wrapT = THREE.RepeatWrapping;
    this.grassTexture.repeat.set(24, 24);

    // Application de la texture au sol
    const ground = document.getElementById('ground-plane');
    if (ground?.getObject3D('mesh')) {
      const mesh = ground.getObject3D('mesh');
      mesh.material.map = this.grassTexture;
      mesh.material.roughness = 0.88;
      mesh.material.needsUpdate = true;
    }
  },

  buildEnvironment: function () {
    const sceneEl = this.el.sceneEl;

    // Arbres décoratifs entourant le parc
    const treeCoords = [
      { x: -7, z: -8 }, { x: 7, z: -9 },
      { x: -8, z: -2 }, { x: 8, z: -3 },
      { x: -6, z: 4 }, { x: 6, z: 4 },
      { x: -4, z: -12 }, { x: 4, z: -12 }, { x: 0, z: -14 }
    ];

    treeCoords.forEach(pos => {
      const treeGroup = document.createElement('a-entity');
      treeGroup.setAttribute('position', `${pos.x} 0 ${pos.z}`);

      // Tronc
      const trunk = document.createElement('a-cylinder');
      trunk.setAttribute('radius', '0.22');
      trunk.setAttribute('height', '2.2');
      trunk.setAttribute('position', '0 1.1 0');
      trunk.setAttribute('color', '#5c3a21');
      treeGroup.appendChild(trunk);

      // Feuillage conique
      const f1 = document.createElement('a-cone');
      f1.setAttribute('radius-bottom', '1.8');
      f1.setAttribute('radius-top', '0.1');
      f1.setAttribute('height', '2.4');
      f1.setAttribute('position', '0 2.8 0');
      f1.setAttribute('color', '#2d5a27');
      treeGroup.appendChild(f1);

      const f2 = document.createElement('a-cone');
      f2.setAttribute('radius-bottom', '1.4');
      f2.setAttribute('radius-top', '0.05');
      f2.setAttribute('height', '2.0');
      f2.setAttribute('position', '0 3.8 0');
      f2.setAttribute('color', '#386e30');
      treeGroup.appendChild(f2);

      sceneEl.appendChild(treeGroup);
    });

    // Piquets de clôture en bois
    for (let x = -9; x <= 9; x += 3) {
      const postBack = document.createElement('a-box');
      postBack.setAttribute('position', `${x} 0.5 -12`);
      postBack.setAttribute('width', '0.12');
      postBack.setAttribute('depth', '0.12');
      postBack.setAttribute('height', '1.0');
      postBack.setAttribute('color', '#8b5a2b');
      sceneEl.appendChild(postBack);
    }
  },

  buildThrowZone: function () {
    const sceneEl = this.el.sceneEl;

    // Ligne de lancer officielle : le Mölkkaari (z = -0.1)
    const molkkaari = document.createElement('a-box');
    molkkaari.setAttribute('id', 'molkkaari');
    molkkaari.setAttribute('position', '0 0.02 -0.1');
    molkkaari.setAttribute('width', '1.4');
    molkkaari.setAttribute('height', '0.04');
    molkkaari.setAttribute('depth', '0.08');
    molkkaari.setAttribute('color', '#8b5a2b');
    sceneEl.appendChild(molkkaari);

    // Support en bois pour poser le bâton à hauteur de taille
    const stand = document.createElement('a-box');
    stand.setAttribute('id', 'baton-stand');
    stand.setAttribute('position', '0.35 0.45 -0.25');
    stand.setAttribute('width', '0.16');
    stand.setAttribute('height', '0.9');
    stand.setAttribute('depth', '0.22');
    stand.setAttribute('color', '#654321');
    sceneEl.appendChild(stand);

    // Plateau du support
    const tray = document.createElement('a-box');
    tray.setAttribute('position', '0.35 0.91 -0.25');
    tray.setAttribute('width', '0.22');
    tray.setAttribute('height', '0.03');
    tray.setAttribute('depth', '0.28');
    tray.setAttribute('color', '#4a3016');
    sceneEl.appendChild(tray);

    // Anneau lumineux indicateur sur le support
    const standRing = document.createElement('a-ring');
    standRing.setAttribute('position', '0.35 0.93 -0.25');
    standRing.setAttribute('rotation', '-90 0 0');
    standRing.setAttribute('radius-inner', '0.07');
    standRing.setAttribute('radius-outer', '0.11');
    standRing.setAttribute('color', '#fbbf24');
    standRing.setAttribute('opacity', '0.65');
    standRing.setAttribute('material', 'shader: flat');
    sceneEl.appendChild(standRing);
  },

  /* =========================================================================
   * 3. MODÉLISATION 3D DES 12 QUILLES ET DU BÂTON DE LANCER (THREE.JS)
   * Détails de conception :
   * - Quilles : Cylindre de bois + disque incliné à 45° face au joueur.
   *   L'angle de -Math.PI / 4 permet au joueur de lire distinctement les chiffres
   *   même lorsque les quilles sont posées à 3.5 mètres de distance.
   * - Bâton : Cylindre de bois lesté avec 2 tores (anneaux sombres) marquant
   *   la zone de préhension idéale.
   * ========================================================================= */
  buildPinsAndBaton: function () {
    const sceneEl = this.el.sceneEl;
    const R = window.molkkyPhysics.PIN_RADIUS;
    const H = window.molkkyPhysics.PIN_HEIGHT;

    // 1. Création des 12 quilles officielles avec biseau incliné à 45°
    for (let num = 1; num <= 12; num++) {
      const pinEntity = document.createElement('a-entity');
      pinEntity.setAttribute('id', `pin-${num}`);
      sceneEl.appendChild(pinEntity);

      const group = pinEntity.object3D;

      // Corps cylindrique en bois massif
      const cylGeom = new THREE.CylinderGeometry(R, R, H, 24);
      const woodMat = new THREE.MeshStandardMaterial({
        map: this.woodTexture,
        roughness: 0.72,
        metalness: 0.08
      });
      group.add(new THREE.Mesh(cylGeom, woodMat));

      // Face supérieure biseautée avec le numéro imprimé dynamiquement par Canvas
      const numCanvas = TextureGenerator.createPinNumberCanvas(num);
      const numTex = new THREE.CanvasTexture(numCanvas);
      const discGeom = new THREE.CircleGeometry(R * 0.95, 24);
      const discMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.6 });
      const discMesh = new THREE.Mesh(discGeom, discMat);
      discMesh.rotation.x = -Math.PI / 4; // Biseau à 45° face au joueur
      discMesh.position.set(0, H / 2 + 0.001, 0.003);
      group.add(discMesh);

      this.pinMeshesByNum[num] = group;
    }

    // 2. Création du bâton de lancer officiel (Mölkky stick)
    const batonEntity = document.createElement('a-entity');
    batonEntity.setAttribute('id', 'molkky-baton');
    batonEntity.setAttribute('class', 'clickable');
    sceneEl.appendChild(batonEntity);

    const batonGroup = batonEntity.object3D;
    const BR = window.molkkyPhysics.BATON_RADIUS;
    const BH = window.molkkyPhysics.BATON_HEIGHT;

    const batonGeom = new THREE.CylinderGeometry(BR, BR, BH, 24);
    const batonMat = new THREE.MeshStandardMaterial({
      map: this.woodTexture,
      roughness: 0.65,
      metalness: 0.05
    });
    batonGroup.add(new THREE.Mesh(batonGeom, batonMat));

    // Anneaux de prise en main en noyer foncé (repères visuels pour le grab VR)
    const ringGeom = new THREE.TorusGeometry(BR + 0.001, 0.002, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4a3016 });
    const r1 = new THREE.Mesh(ringGeom, ringMat);
    r1.rotation.x = Math.PI / 2;
    r1.position.y = 0.04;
    batonGroup.add(r1);

    const r2 = new THREE.Mesh(ringGeom, ringMat);
    r2.rotation.x = Math.PI / 2;
    r2.position.y = -0.04;
    batonGroup.add(r2);

    // Enregistrement du bâton avec le gestionnaire de contrôleurs WebXR
    try {
      if (window.vrControllerManager && typeof window.vrControllerManager.setBaton === 'function') {
        window.vrControllerManager.setBaton(batonEntity);
      }
    } catch (e) {
      console.warn('VRControllerManager.setBaton warning:', e);
    }

    try {
      if (window.molkkyPhysics) {
        window.molkkyPhysics.setupBaton(batonGroup, { x: 0.35, y: 0.95, z: -0.25 });
        window.molkkyPhysics.setupPins(this.pinMeshesByNum, -3.5);
      }
    } catch (e) {
      console.error('Physics setup error:', e);
    }
  },

  /* =========================================================================
   * 4. TOTEM DE SCORE 3D INTERACTIF ET DIÉGÉTIQUE
   * Détails d'ergonomie et de conception :
   * - Concept d'UI diégétique : Les informations de jeu (score, timer, fautes)
   *   ne sont pas de simples popups 2D artificielles collées à l'écran, mais
   *   un véritable panneau physique en bois et pierre intégré à l'environnement.
   * - Ergonomie VR :
   *   * Positionné à X = 2.05m, Z = -1.60m, pivoté de -48° vers l'utilisateur.
   *   * Boutons 3D avec bordures en relief et détection de raycasting Three.js.
   *   * Lanterne avec source de lumière ponctuelle (point light) pour détacher
   *     les reliefs du panneau de l'arrière-plan.
   * ========================================================================= */
  buildScoreTotem: function () {
    const sceneEl = this.el.sceneEl;

    // Totem en bois sculpté positionné à droite du joueur (2.05m, 0, -1.60m)
    const totem = document.createElement('a-entity');
    totem.setAttribute('id', 'vr-totem');
    totem.setAttribute('position', '2.05 0 -1.60');
    totem.setAttribute('rotation', '0 -48 0');

    // 1. Socle lourd en granit (stabilité visuelle)
    const stoneBase = document.createElement('a-cylinder');
    stoneBase.setAttribute('position', '0 0.05 0');
    stoneBase.setAttribute('radius', '0.28');
    stoneBase.setAttribute('height', '0.10');
    stoneBase.setAttribute('color', '#1e293b');
    stoneBase.setAttribute('material', 'roughness: 0.85; metalness: 0.15');
    totem.appendChild(stoneBase);

    // 2. Mât principal en chêne foncé
    const post = document.createElement('a-box');
    post.setAttribute('position', '0 0.85 0');
    post.setAttribute('width', '0.16');
    post.setAttribute('height', '1.7');
    post.setAttribute('depth', '0.16');
    post.setAttribute('color', '#3e2723');
    post.setAttribute('material', 'roughness: 0.7; metalness: 0.1');
    totem.appendChild(post);

    // Bagues décoratives en laiton doré
    [0.35, 0.85, 1.65].forEach(y => {
      const brassRing = document.createElement('a-box');
      brassRing.setAttribute('position', `0 ${y} 0`);
      brassRing.setAttribute('width', '0.175');
      brassRing.setAttribute('height', '0.035');
      brassRing.setAttribute('depth', '0.175');
      brassRing.setAttribute('color', '#d4af37');
      brassRing.setAttribute('material', 'metalness: 0.85; roughness: 0.2');
      totem.appendChild(brassRing);
    });

    // 3. Potence et lanterne d'éclairage 3D du tableau
    const lanternArm = document.createElement('a-box');
    lanternArm.setAttribute('position', '0 2.22 0.10');
    lanternArm.setAttribute('rotation', '-15 0 0');
    lanternArm.setAttribute('width', '0.04');
    lanternArm.setAttribute('height', '0.04');
    lanternArm.setAttribute('depth', '0.28');
    lanternArm.setAttribute('color', '#d4af37');
    lanternArm.setAttribute('material', 'metalness: 0.9; roughness: 0.15');
    totem.appendChild(lanternArm);

    const lantern = document.createElement('a-cylinder');
    lantern.setAttribute('position', '0 2.14 0.22');
    lantern.setAttribute('radius', '0.055');
    lantern.setAttribute('height', '0.11');
    lantern.setAttribute('color', '#78350f');
    lantern.setAttribute('material', 'metalness: 0.8; roughness: 0.3');
    totem.appendChild(lantern);

    const bulb = document.createElement('a-sphere');
    bulb.setAttribute('position', '0 2.10 0.22');
    bulb.setAttribute('radius', '0.035');
    bulb.setAttribute('color', '#fef08a');
    bulb.setAttribute('material', 'shader: standard; emissive: #fde047; emissiveIntensity: 0.95');
    totem.appendChild(bulb);

    const lanternLight = document.createElement('a-light');
    lanternLight.setAttribute('type', 'point');
    lanternLight.setAttribute('position', '0 2.10 0.24');
    lanternLight.setAttribute('color', '#ffedd5');
    lanternLight.setAttribute('intensity', '0.65');
    lanternLight.setAttribute('distance', '3.5');
    totem.appendChild(lanternLight);

    // 4. Cadre sculpté et plaque d'affichage en verre d'obsidienne
    const plaqueFrame = document.createElement('a-box');
    plaqueFrame.setAttribute('position', '0 1.44 0.04');
    plaqueFrame.setAttribute('width', '1.12');
    plaqueFrame.setAttribute('height', '1.38');
    plaqueFrame.setAttribute('depth', '0.03');
    plaqueFrame.setAttribute('color', '#92400e');
    plaqueFrame.setAttribute('material', 'roughness: 0.6; metalness: 0.2');
    totem.appendChild(plaqueFrame);

    const plaqueFace = document.createElement('a-box');
    plaqueFace.setAttribute('position', '0 1.44 0.07');
    plaqueFace.setAttribute('width', '1.02');
    plaqueFace.setAttribute('height', '1.28');
    plaqueFace.setAttribute('depth', '0.02');
    plaqueFace.setAttribute('color', '#090d16');
    plaqueFace.setAttribute('material', 'roughness: 0.25; metalness: 0.35');
    totem.appendChild(plaqueFace);

    // Titre Tournoi doré
    const title = document.createElement('a-text');
    title.setAttribute('value', 'MOLKKY VR');
    title.setAttribute('align', 'center');
    title.setAttribute('color', '#fbbf24');
    title.setAttribute('position', '0 2.01 0.105');
    title.setAttribute('width', '1.8');
    totem.appendChild(title);

    // Score principal géant (ex: '28 / 50')
    const scoreText = document.createElement('a-text');
    scoreText.setAttribute('id', 'vr-score-text');
    scoreText.setAttribute('value', '0 / 50');
    scoreText.setAttribute('align', 'center');
    scoreText.setAttribute('color', '#ffffff');
    scoreText.setAttribute('position', '0 1.75 0.105');
    scoreText.setAttribute('width', '2.2');
    totem.appendChild(scoreText);

    // Jauge de progression 3D vers les 50 points (boîte qui s'étire proportionnellement)
    const scoreBar = document.createElement('a-box');
    scoreBar.setAttribute('id', 'vr-score-bar');
    scoreBar.setAttribute('position', '-0.36 1.68 0.12');
    scoreBar.setAttribute('width', '0.02');
    scoreBar.setAttribute('height', '0.014');
    scoreBar.setAttribute('depth', '0.015');
    scoreBar.setAttribute('color', '#38bdf8');
    scoreBar.setAttribute('material', 'emissive: #0284c7; emissiveIntensity: 0.6');
    totem.appendChild(scoreBar);

    // Cartouche : Dernier lancer (+X pts)
    const lastText = document.createElement('a-text');
    lastText.setAttribute('id', 'vr-last-text');
    lastText.setAttribute('value', '+0 pts');
    lastText.setAttribute('align', 'center');
    lastText.setAttribute('color', '#34d399');
    lastText.setAttribute('position', '-0.25 1.47 0.105');
    lastText.setAttribute('width', '1.25');
    totem.appendChild(lastText);

    // Cartouche : Nombre de lancers
    const throwsText = document.createElement('a-text');
    throwsText.setAttribute('id', 'vr-throws-text');
    throwsText.setAttribute('value', 'Lancers : #0');
    throwsText.setAttribute('align', 'center');
    throwsText.setAttribute('color', '#38bdf8');
    throwsText.setAttribute('position', '0.25 1.545 0.105');
    throwsText.setAttribute('width', '0.95');
    totem.appendChild(throwsText);

    // Cartouche : Chronomètre
    const timerText = document.createElement('a-text');
    timerText.setAttribute('id', 'vr-timer-text');
    timerText.setAttribute('value', 'Temps : 00:00');
    timerText.setAttribute('align', 'center');
    timerText.setAttribute('color', '#cbd5e1');
    timerText.setAttribute('position', '0.25 1.47 0.105');
    timerText.setAttribute('width', '0.90');
    totem.appendChild(timerText);

    // Indicateurs des 3 échecs (Strike LEDs sphériques rougeoyantes)
    ['vr-strike-1', 'vr-strike-2', 'vr-strike-3'].forEach((id, idx) => {
      const s = document.createElement('a-sphere');
      s.setAttribute('id', id);
      s.setAttribute('position', `${0.20 + idx * 0.09} 1.34 0.11`);
      s.setAttribute('radius', '0.022');
      s.setAttribute('color', '#1e293b');
      totem.appendChild(s);
    });

    const missesText = document.createElement('a-entity');
    missesText.setAttribute('id', 'vr-misses-text');
    totem.appendChild(missesText);

    const diffText = document.createElement('a-entity');
    diffText.setAttribute('id', 'vr-diff-text');
    totem.appendChild(diffText);

    // Bandeau d'arbitrage en direct (Commentaire instantané de chaque coup)
    const feedbackText = document.createElement('a-text');
    feedbackText.setAttribute('id', 'vr-feedback-text');
    feedbackText.setAttribute('value', 'Pret a jouer ! Visez les 50 points.');
    feedbackText.setAttribute('align', 'center');
    feedbackText.setAttribute('color', '#fef08a');
    feedbackText.setAttribute('position', '0 1.22 0.105');
    feedbackText.setAttribute('width', '1.2');
    totem.appendChild(feedbackText);

    // Fabrique de boutons tactiles 3D avec châssis de protection et détection laser
    const createButton = (id, textId, label, x, y, width, height, baseColor, frameColor, textColor, onClick) => {
      const tray = document.createElement('a-box');
      tray.setAttribute('position', `${x} ${y} 0.08`);
      tray.setAttribute('width', (width + 0.025).toFixed(3));
      tray.setAttribute('height', (height + 0.02).toFixed(3));
      tray.setAttribute('depth', '0.02');
      tray.setAttribute('color', frameColor);
      totem.appendChild(tray);

      const btn = document.createElement('a-box');
      btn.setAttribute('id', id);
      btn.setAttribute('class', 'clickable');
      btn.setAttribute('position', `${x} ${y} 0.10`);
      btn.setAttribute('width', width.toFixed(3));
      btn.setAttribute('height', height.toFixed(3));
      btn.setAttribute('depth', '0.028');
      btn.setAttribute('color', baseColor);
      btn.setAttribute('material', 'roughness: 0.3; metalness: 0.1');

      const txt = document.createElement('a-text');
      txt.setAttribute('id', textId);
      txt.setAttribute('value', label);
      txt.setAttribute('align', 'center');
      txt.setAttribute('color', textColor);
      txt.setAttribute('position', '0 0 0.022');
      txt.setAttribute('width', '0.95');
      btn.appendChild(txt);

      btn.onButtonClick = onClick;
      btn.addEventListener('click', () => {
        if (btn.onButtonClick) btn.onButtonClick();
      });
      totem.appendChild(btn);
      return btn;
    };

    // Ligne 1 de boutons : Recommencer la partie & Basculer la difficulté
    createButton('vr-btn-new', 'vr-btn-new-text', 'Recommencer', -0.25, 1.08, 0.45, 0.10, '#f59e0b', '#451a03', '#0f172a', () => {
      if (window.molkkyGame) window.molkkyGame.startNewGame();
    });

    createButton('vr-btn-diff', 'vr-btn-diff-text', 'Niveau : Normal', 0.25, 1.08, 0.45, 0.10, '#2563eb', '#172554', '#ffffff', () => {
      if (window.molkkyGame) {
        const levels = ['facile', 'normal', 'difficile'];
        const nextLevel = levels[(levels.indexOf(window.molkkyGame.difficulty) + 1) % levels.length];
        window.molkkyGame.startNewGame(nextLevel);
      }
    });

    // Ligne 2 de boutons : Rappeler le bâton dans la main & Inverser le joystick
    createButton('vr-btn-grab', 'vr-btn-grab-text', 'Rappeler Baton', -0.25, 0.94, 0.45, 0.10, '#059669', '#064e3b', '#ffffff', () => {
      if (window.vrControllerManager) window.vrControllerManager.grabWithHand('right', 'trigger');
    });

    createButton('vr-btn-joy', 'vr-btn-joy-text', 'Joystick : Normal', 0.25, 0.94, 0.45, 0.10, '#7c3aed', '#3b0764', '#ffffff', () => {
      if (window.vrControllerManager) window.vrControllerManager.toggleLocomotionInvert();
    });

    sceneEl.appendChild(totem);

    // Rafraîchissement des raycasters pour indexer immédiatement les nouveaux boutons
    setTimeout(() => {
      ['left-ray', 'right-ray'].forEach(id => {
        const ray = document.getElementById(id);
        if (ray?.components?.raycaster) ray.components.raycaster.refreshObjects();
      });
    }, 80);
  },

  /* =========================================================================
   * 5. BOUCLE TICK PRINCIPALE (60 FPS) COORDONNANT TOUS LES MOTEURS
   * Fonctionnement :
   * - A-Frame appelle 'tick(time, deltaTime)' à chaque frame de rendu (rafraîchissement 72Hz/90Hz en VR).
   * - Cette fonction coordonne l'ensemble des sous-systèmes :
   *   1. Moteur physique Cannon.js : Fait avancer la simulation (gravité, chocs) d'un pas dt.
   *   2. Contrôles VR : Lit les axes des joysticks et les gâchettes pour la locomotion et le grab.
   *   3. Particules 3D : Anime les confettis dorés lors des victoires.
   *   4. Spatialisation audio : Oriente l'écouteur Web Audio API en fonction du regard du joueur.
   * ========================================================================= */
  tick: function (time, deltaTime) {
    const dtSeconds = deltaTime / 1000;

    // 1. Simulation physique Cannon.js
    if (window.molkkyPhysics) {
      window.molkkyPhysics.step(dtSeconds);
    }

    // 2. Contrôles VR, locomotion et lancer
    if (window.vrControllerManager) {
      window.vrControllerManager.update(time, deltaTime);
    }

    // 3. Animation 3D des confettis de célébration
    if (window.vrCelebration) {
      window.vrCelebration.updateConfetti(dtSeconds);
    }

    // 4. Spatialisation 3D audio suivant la caméra
    if (window.soundEngine && this.el.sceneEl.camera) {
      window.soundEngine.updateListener(this.el.sceneEl.camera);
    }
  }
});
