/**
 * ============================================================================
 * MODULE 3 : CÉLÉBRATIONS ET EFFETS VISUELS IMMERSIFS
 * Fichier : js/celebration.js - Classe VRCelebrationManager
 * ============================================================================
 * 
 * DESCRIPTION DU FONCTIONNEMENT ET ARCHITECTURE :
 * 1. Immersion spatiale des écrans de fin de partie (Victoire / Défaite) :
 *    - En réalité virtuelle, un écran 2D classique (HUD plat) brise le sentiment de présence.
 *    - La bannière 3D flotte directement dans l'espace virtuel, à 1.8 mètre devant le regard
 *      du joueur, calculée dynamiquement par trigonométrie (rigPos + forwardVector * 1.8m).
 * 2. Système de particules 3D de confettis (Confetti Physics System) :
 *    - Fontaine de 80 confettis rectangulaires colorés projetés vers le haut.
 *    - Simulation aérodynamique avec oscillation sinusoïdale (effet de feuille morte / flottement).
 *    - Collision avec le sol : Les confettis s'immobilisent au niveau de l'herbe (Y = 0.02m).
 * 3. Trophée doré 3D lévitant au-dessus des quilles :
 *    - Modélisé par géométries imbriquées Three.js (socle, coupe, anses, orbe brillant) avec
 *      rotation continue (yaw) pour un effet de récompense gratifiant.
 * 4. Fanfare haptique synchronisée :
 *    - Vibrations cadencées envoyées simultanément aux manettes gauche et droite via
 *      l'API WebXR `gamepad.hapticActuators[0].pulse()`.
 * ============================================================================
 */

class VRCelebrationManager {
  constructor() {
    this.victoryEntity = null;
    this.defeatEntity = null;
    this.confettiParticles = [];
    this.trophyEntity = null;
    this.isActive = false;
    this.isVictory = false;

    this.init();
  }

  init() {
    const tryBuild = () => {
      const scene = document.querySelector('a-scene');
      if (scene) {
        if (scene.hasLoaded) {
          this.buildCelebrationEntities();
        } else {
          scene.addEventListener('loaded', () => this.buildCelebrationEntities(), { once: true });
          this.buildCelebrationEntities();
        }
      }
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', tryBuild);
    } else {
      tryBuild();
    }
  }

  buildCelebrationEntities() {
    if (this.container && this.container.parentNode) return;
    const scene = document.querySelector('a-scene');
    if (!scene) return;

    // 1. Root container for floating end-game banners
    const container = document.createElement('a-entity');
    container.setAttribute('id', 'vr-endgame-container');
    container.setAttribute('position', '0 1.6 -1.8');
    container.setAttribute('visible', 'false');
    scene.appendChild(container);
    this.container = container;

    // -------------------------------------------------------------
    // VICTORY BANNER
    // -------------------------------------------------------------
    const victoryGroup = document.createElement('a-entity');
    victoryGroup.setAttribute('id', 'vr-victory-group');
    victoryGroup.setAttribute('visible', 'false');

    // Outer Glowing Frame
    const vicFrame = document.createElement('a-box');
    vicFrame.setAttribute('width', '1.34');
    vicFrame.setAttribute('height', '0.98');
    vicFrame.setAttribute('depth', '0.04');
    vicFrame.setAttribute('color', '#fbbf24');
    vicFrame.setAttribute('material', 'metalness: 0.8; roughness: 0.2; emissive: #d97706; emissiveIntensity: 0.3');
    victoryGroup.appendChild(vicFrame);

    // Dark Obsidian Glass Plaque
    const vicPlaque = document.createElement('a-box');
    vicPlaque.setAttribute('position', '0 0 0.02');
    vicPlaque.setAttribute('width', '1.28');
    vicPlaque.setAttribute('height', '0.92');
    vicPlaque.setAttribute('depth', '0.03');
    vicPlaque.setAttribute('color', '#090d16');
    vicPlaque.setAttribute('material', 'roughness: 0.3; metalness: 0.4');
    victoryGroup.appendChild(vicPlaque);

    // Title
    const vicTitle = document.createElement('a-text');
    vicTitle.setAttribute('value', 'VICTOIRE !');
    vicTitle.setAttribute('align', 'center');
    vicTitle.setAttribute('color', '#fbbf24');
    vicTitle.setAttribute('position', '0 0.32 0.06');
    vicTitle.setAttribute('width', '2.6');
    victoryGroup.appendChild(vicTitle);

    const vicSubtitle = document.createElement('a-text');
    vicSubtitle.setAttribute('id', 'vr-vic-subtitle');
    vicSubtitle.setAttribute('value', '50 POINTS ATTEINTS !');
    vicSubtitle.setAttribute('align', 'center');
    vicSubtitle.setAttribute('color', '#34d399');
    vicSubtitle.setAttribute('position', '0 0.18 0.06');
    vicSubtitle.setAttribute('width', '1.8');
    victoryGroup.appendChild(vicSubtitle);

    // Stats Card Box
    const vicStatsCard = document.createElement('a-box');
    vicStatsCard.setAttribute('position', '0 -0.02 0.05');
    vicStatsCard.setAttribute('width', '1.14');
    vicStatsCard.setAttribute('height', '0.22');
    vicStatsCard.setAttribute('depth', '0.02');
    vicStatsCard.setAttribute('color', '#1e293b');
    victoryGroup.appendChild(vicStatsCard);

    const vicStats = document.createElement('a-text');
    vicStats.setAttribute('id', 'vr-vic-stats');
    vicStats.setAttribute('value', 'Lancers: 6  |  Temps: 01:45  |  Niveau: Normal');
    vicStats.setAttribute('align', 'center');
    vicStats.setAttribute('color', '#f1f5f9');
    vicStats.setAttribute('position', '0 -0.02 0.07');
    vicStats.setAttribute('width', '1.35');
    victoryGroup.appendChild(vicStats);

    // Button 1: Rejouer
    const btnReplay = document.createElement('a-box');
    btnReplay.setAttribute('id', 'vr-vic-btn-replay');
    btnReplay.setAttribute('class', 'clickable');
    btnReplay.setAttribute('position', '-0.30 -0.28 0.06');
    btnReplay.setAttribute('width', '0.48');
    btnReplay.setAttribute('height', '0.14');
    btnReplay.setAttribute('depth', '0.03');
    btnReplay.setAttribute('color', '#f59e0b');
    btnReplay.setAttribute('material', 'roughness: 0.3; metalness: 0.1');

    const btnReplayTxt = document.createElement('a-text');
    btnReplayTxt.setAttribute('value', 'Rejouer');
    btnReplayTxt.setAttribute('align', 'center');
    btnReplayTxt.setAttribute('color', '#0f172a');
    btnReplayTxt.setAttribute('position', '0 0 0.025');
    btnReplayTxt.setAttribute('width', '1.1');
    btnReplay.appendChild(btnReplayTxt);

    btnReplay.onButtonClick = () => {
      this.dismiss();
      if (window.molkkyGame) window.molkkyGame.startNewGame();
    };
    btnReplay.addEventListener('click', () => {
      if (btnReplay.onButtonClick) btnReplay.onButtonClick();
    });
    victoryGroup.appendChild(btnReplay);

    // Button 2: Niveau Suivant
    const btnNext = document.createElement('a-box');
    btnNext.setAttribute('id', 'vr-vic-btn-next');
    btnNext.setAttribute('class', 'clickable');
    btnNext.setAttribute('position', '0.30 -0.28 0.06');
    btnNext.setAttribute('width', '0.48');
    btnNext.setAttribute('height', '0.14');
    btnNext.setAttribute('depth', '0.03');
    btnNext.setAttribute('color', '#2563eb');
    btnNext.setAttribute('material', 'roughness: 0.3; metalness: 0.1');

    const btnNextTxt = document.createElement('a-text');
    btnNextTxt.setAttribute('id', 'vr-vic-btn-next-text');
    btnNextTxt.setAttribute('value', 'Niveau Suivant');
    btnNextTxt.setAttribute('align', 'center');
    btnNextTxt.setAttribute('color', '#ffffff');
    btnNextTxt.setAttribute('position', '0 0 0.025');
    btnNextTxt.setAttribute('width', '1.1');
    btnNext.appendChild(btnNextTxt);

    btnNext.onButtonClick = () => {
      this.dismiss();
      if (window.molkkyGame) {
        const levels = ['facile', 'normal', 'difficile'];
        const currentIdx = levels.indexOf(window.molkkyGame.difficulty);
        const nextLevel = levels[(currentIdx + 1) % levels.length];
        window.molkkyGame.startNewGame(nextLevel);
      }
    };
    btnNext.addEventListener('click', () => {
      if (btnNext.onButtonClick) btnNext.onButtonClick();
    });
    victoryGroup.appendChild(btnNext);

    container.appendChild(victoryGroup);
    this.victoryEntity = victoryGroup;

    // -------------------------------------------------------------
    // DEFEAT BANNER
    // -------------------------------------------------------------
    const defeatGroup = document.createElement('a-entity');
    defeatGroup.setAttribute('id', 'vr-defeat-group');
    defeatGroup.setAttribute('visible', 'false');

    // Outer Crimson Frame
    const defFrame = document.createElement('a-box');
    defFrame.setAttribute('width', '1.34');
    defFrame.setAttribute('height', '0.98');
    defFrame.setAttribute('depth', '0.04');
    defFrame.setAttribute('color', '#ef4444');
    defFrame.setAttribute('material', 'metalness: 0.7; roughness: 0.3; emissive: #b91c1c; emissiveIntensity: 0.3');
    defeatGroup.appendChild(defFrame);

    // Dark Plaque
    const defPlaque = document.createElement('a-box');
    defPlaque.setAttribute('position', '0 0 0.02');
    defPlaque.setAttribute('width', '1.28');
    defPlaque.setAttribute('height', '0.92');
    defPlaque.setAttribute('depth', '0.03');
    defPlaque.setAttribute('color', '#180d0e');
    defPlaque.setAttribute('material', 'roughness: 0.3; metalness: 0.3');
    defeatGroup.appendChild(defPlaque);

    // Title
    const defTitle = document.createElement('a-text');
    defTitle.setAttribute('value', 'DEFAITE');
    defTitle.setAttribute('align', 'center');
    defTitle.setAttribute('color', '#f87171');
    defTitle.setAttribute('position', '0 0.32 0.06');
    defTitle.setAttribute('width', '2.6');
    defeatGroup.appendChild(defTitle);

    const defSubtitle = document.createElement('a-text');
    defSubtitle.setAttribute('id', 'vr-def-subtitle');
    defSubtitle.setAttribute('value', '3 lancers consecutifs sans marquer');
    defSubtitle.setAttribute('align', 'center');
    defSubtitle.setAttribute('color', '#fca5a5');
    defSubtitle.setAttribute('position', '0 0.18 0.06');
    defSubtitle.setAttribute('width', '1.6');
    defeatGroup.appendChild(defSubtitle);

    // Stats Card
    const defStatsCard = document.createElement('a-box');
    defStatsCard.setAttribute('position', '0 -0.02 0.05');
    defStatsCard.setAttribute('width', '1.14');
    defStatsCard.setAttribute('height', '0.22');
    defStatsCard.setAttribute('depth', '0.02');
    defStatsCard.setAttribute('color', '#2d1517');
    defeatGroup.appendChild(defStatsCard);

    const defStats = document.createElement('a-text');
    defStats.setAttribute('id', 'vr-def-stats');
    defStats.setAttribute('value', 'Score final: 24 / 50  |  Lancers: 5');
    defStats.setAttribute('align', 'center');
    defStats.setAttribute('color', '#fed7aa');
    defStats.setAttribute('position', '0 -0.02 0.07');
    defStats.setAttribute('width', '1.35');
    defeatGroup.appendChild(defStats);

    // Button 1: Reessayer
    const btnRetry = document.createElement('a-box');
    btnRetry.setAttribute('id', 'vr-def-btn-retry');
    btnRetry.setAttribute('class', 'clickable');
    btnRetry.setAttribute('position', '-0.30 -0.28 0.06');
    btnRetry.setAttribute('width', '0.48');
    btnRetry.setAttribute('height', '0.14');
    btnRetry.setAttribute('depth', '0.03');
    btnRetry.setAttribute('color', '#f59e0b');
    btnRetry.setAttribute('material', 'roughness: 0.3; metalness: 0.1');

    const btnRetryTxt = document.createElement('a-text');
    btnRetryTxt.setAttribute('value', 'Reessayer');
    btnRetryTxt.setAttribute('align', 'center');
    btnRetryTxt.setAttribute('color', '#0f172a');
    btnRetryTxt.setAttribute('position', '0 0 0.025');
    btnRetryTxt.setAttribute('width', '1.1');
    btnRetry.appendChild(btnRetryTxt);

    btnRetry.onButtonClick = () => {
      this.dismiss();
      if (window.molkkyGame) window.molkkyGame.startNewGame();
    };
    btnRetry.addEventListener('click', () => {
      if (btnRetry.onButtonClick) btnRetry.onButtonClick();
    });
    defeatGroup.appendChild(btnRetry);

    // Button 2: Niveau Facile
    const btnEasier = document.createElement('a-box');
    btnEasier.setAttribute('id', 'vr-def-btn-easier');
    btnEasier.setAttribute('class', 'clickable');
    btnEasier.setAttribute('position', '0.30 -0.28 0.06');
    btnEasier.setAttribute('width', '0.48');
    btnEasier.setAttribute('height', '0.14');
    btnEasier.setAttribute('depth', '0.03');
    btnEasier.setAttribute('color', '#10b981');
    btnEasier.setAttribute('material', 'roughness: 0.3; metalness: 0.1');

    const btnEasierTxt = document.createElement('a-text');
    btnEasierTxt.setAttribute('value', 'Niveau Facile');
    btnEasierTxt.setAttribute('align', 'center');
    btnEasierTxt.setAttribute('color', '#0f172a');
    btnEasierTxt.setAttribute('position', '0 0 0.025');
    btnEasierTxt.setAttribute('width', '1.1');
    btnEasier.appendChild(btnEasierTxt);

    btnEasier.onButtonClick = () => {
      this.dismiss();
      if (window.molkkyGame) window.molkkyGame.startNewGame('facile');
    };
    btnEasier.addEventListener('click', () => {
      if (btnEasier.onButtonClick) btnEasier.onButtonClick();
    });
    defeatGroup.appendChild(btnEasier);

    container.appendChild(defeatGroup);
    this.defeatEntity = defeatGroup;

    // -------------------------------------------------------------
    // ROTATING 3D GOLDEN TROPHY
    // -------------------------------------------------------------
    const trophy = document.createElement('a-entity');
    trophy.setAttribute('id', 'vr-golden-trophy');
    trophy.setAttribute('position', '0 1.6 -3.5');
    trophy.setAttribute('visible', 'false');

    // Trophy cup bowl
    const bowl = document.createElement('a-cone');
    bowl.setAttribute('radius-bottom', '0.08');
    bowl.setAttribute('radius-top', '0.18');
    bowl.setAttribute('height', '0.24');
    bowl.setAttribute('position', '0 0.12 0');
    bowl.setAttribute('color', '#fbbf24');
    bowl.setAttribute('material', 'metalness: 0.9; roughness: 0.15; emissive: #d97706; emissiveIntensity: 0.25');
    trophy.appendChild(bowl);

    // Stem & Base
    const stem = document.createElement('a-cylinder');
    stem.setAttribute('radius', '0.035');
    stem.setAttribute('height', '0.14');
    stem.setAttribute('position', '0 -0.06 0');
    stem.setAttribute('color', '#d4af37');
    stem.setAttribute('material', 'metalness: 0.9; roughness: 0.2');
    trophy.appendChild(stem);

    const base = document.createElement('a-cylinder');
    base.setAttribute('radius', '0.14');
    base.setAttribute('height', '0.06');
    base.setAttribute('position', '0 -0.15 0');
    base.setAttribute('color', '#3e2723');
    trophy.appendChild(base);

    // Handles
    const h1 = document.createElement('a-torus');
    h1.setAttribute('radius', '0.09');
    h1.setAttribute('radius-tubular', '0.012');
    h1.setAttribute('position', '0.18 0.12 0');
    h1.setAttribute('rotation', '0 0 0');
    h1.setAttribute('color', '#fbbf24');
    h1.setAttribute('material', 'metalness: 0.9; roughness: 0.15');
    trophy.appendChild(h1);

    const h2 = document.createElement('a-torus');
    h2.setAttribute('radius', '0.09');
    h2.setAttribute('radius-tubular', '0.012');
    h2.setAttribute('position', '-0.18 0.12 0');
    h2.setAttribute('rotation', '0 0 0');
    h2.setAttribute('color', '#fbbf24');
    h2.setAttribute('material', 'metalness: 0.9; roughness: 0.15');
    trophy.appendChild(h2);

    scene.appendChild(trophy);
    this.trophyEntity = trophy;
  }

  triggerVictory(stats = {}) {
    this.isActive = true;
    this.isVictory = true;

    if (!this.container || !this.container.parentNode) {
      this.buildCelebrationEntities();
    }

    const safeStats = {
      throwCount: stats.throwCount || 1,
      time: stats.time || '00:00',
      difficulty: stats.difficulty || 'Normal',
      score: stats.score || 50
    };

    // Position floating banner directly in front of camera rig
    const rig = document.getElementById('rig');
    const camera = document.getElementById('camera');
    if (this.container) {
      if (rig && camera) {
        const rigPos = rig.getAttribute('position') || { x: 0, y: 0, z: 0 };
        const camRot = camera.getAttribute('rotation') || { x: 0, y: 0, z: 0 };
        const radY = ((camRot.y || 0) * Math.PI) / 180;
        const forwardX = -Math.sin(radY);
        const forwardZ = -Math.cos(radY);
        this.container.setAttribute('position', `${(rigPos.x || 0) + forwardX * 1.8} 1.6 ${(rigPos.z || 0) + forwardZ * 1.8}`);
        this.container.setAttribute('rotation', `0 ${camRot.y || 0} 0`);
      } else {
        this.container.setAttribute('position', '0 1.6 -1.8');
        this.container.setAttribute('rotation', '0 0 0');
      }
      this.container.setAttribute('visible', 'true');
    }

    if (this.victoryEntity) {
      this.victoryEntity.setAttribute('visible', 'true');
    }
    if (this.defeatEntity) {
      this.defeatEntity.setAttribute('visible', 'false');
    }

    // Update dynamic text
    const subtitle = document.getElementById('vr-vic-subtitle');
    if (subtitle) {
      subtitle.setAttribute('value', `50 POINTS EN ${safeStats.throwCount} LANCERS !`);
    }

    const statsTxt = document.getElementById('vr-vic-stats');
    if (statsTxt) {
      statsTxt.setAttribute('value', `Lancers: ${safeStats.throwCount}  |  Temps: ${safeStats.time}  |  Niveau: ${safeStats.difficulty}`);
    }

    // Show trophy
    if (this.trophyEntity) {
      const pinZ = (window.molkkyGame && window.molkkyGame.difficultyConfigs[window.molkkyGame.difficulty] && window.molkkyGame.difficultyConfigs[window.molkkyGame.difficulty].distance) || -3.5;
      this.trophyEntity.setAttribute('position', `0 1.6 ${pinZ}`);
      this.trophyEntity.setAttribute('visible', 'true');
    }

    // Spawn 3D Confetti Particles
    this.spawnConfetti();

    // Controller celebratory haptics
    this.pulseHapticSequence();

    // Ensure laser raycasters index newly visible victory buttons
    setTimeout(() => {
      ['left-ray', 'right-ray'].forEach(id => {
        const ray = document.getElementById(id);
        if (ray && ray.components && ray.components.raycaster) {
          ray.components.raycaster.refreshObjects();
        }
      });
    }, 80);
  }

  triggerDefeat(stats = {}) {
    this.isActive = true;
    this.isVictory = false;

    if (!this.container || !this.container.parentNode) {
      this.buildCelebrationEntities();
    }

    const safeStats = {
      throwCount: stats.throwCount || 0,
      time: stats.time || '00:00',
      difficulty: stats.difficulty || 'Normal',
      score: stats.score || 0
    };

    // Position floating banner directly in front of camera rig
    const rig = document.getElementById('rig');
    const camera = document.getElementById('camera');
    if (this.container) {
      if (rig && camera) {
        const rigPos = rig.getAttribute('position') || { x: 0, y: 0, z: 0 };
        const camRot = camera.getAttribute('rotation') || { x: 0, y: 0, z: 0 };
        const radY = ((camRot.y || 0) * Math.PI) / 180;
        const forwardX = -Math.sin(radY);
        const forwardZ = -Math.cos(radY);
        this.container.setAttribute('position', `${(rigPos.x || 0) + forwardX * 1.8} 1.6 ${(rigPos.z || 0) + forwardZ * 1.8}`);
        this.container.setAttribute('rotation', `0 ${camRot.y || 0} 0`);
      } else {
        this.container.setAttribute('position', '0 1.6 -1.8');
        this.container.setAttribute('rotation', '0 0 0');
      }
      this.container.setAttribute('visible', 'true');
    }

    if (this.defeatEntity) {
      this.defeatEntity.setAttribute('visible', 'true');
    }
    if (this.victoryEntity) {
      this.victoryEntity.setAttribute('visible', 'false');
    }
    if (this.trophyEntity) {
      this.trophyEntity.setAttribute('visible', 'false');
    }

    const statsTxt = document.getElementById('vr-def-stats');
    if (statsTxt) {
      statsTxt.setAttribute('value', `Score final: ${safeStats.score} / 50  |  Lancers: ${safeStats.throwCount}`);
    }

    // Heavy defeat rumble
    if (window.vrControllerManager) {
      window.vrControllerManager.triggerHaptic('left', 0.8, 250);
      window.vrControllerManager.triggerHaptic('right', 0.8, 250);
    }

    // Ensure laser raycasters index newly visible defeat buttons
    setTimeout(() => {
      ['left-ray', 'right-ray'].forEach(id => {
        const ray = document.getElementById(id);
        if (ray && ray.components && ray.components.raycaster) {
          ray.components.raycaster.refreshObjects();
        }
      });
    }, 80);
  }

  spawnConfetti() {
    this.clearConfetti();
    const scene = document.querySelector('a-scene');
    if (!scene) return;

    const colors = ['#fbbf24', '#f43f5e', '#38bdf8', '#34d399', '#a855f7', '#fb923c'];
    const count = 90;

    for (let i = 0; i < count; i++) {
      const conf = document.createElement('a-plane');
      conf.setAttribute('width', '0.04');
      conf.setAttribute('height', '0.07');
      conf.setAttribute('color', colors[i % colors.length]);
      conf.setAttribute('side', 'double');
      conf.setAttribute('material', 'roughness: 0.3; metalness: 0.1');

      // Random starting positions above play field
      const startX = (Math.random() - 0.5) * 4.0;
      const startY = 2.8 + Math.random() * 2.5;
      const startZ = -1.0 - Math.random() * 4.0;
      conf.setAttribute('position', `${startX} ${startY} ${startZ}`);

      scene.appendChild(conf);

      this.confettiParticles.push({
        el: conf,
        x: startX,
        y: startY,
        z: startZ,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -0.8 - Math.random() * 1.1,
        vz: (Math.random() - 0.5) * 0.8,
        rx: Math.random() * 360,
        ry: Math.random() * 360,
        rz: Math.random() * 360,
        vrx: (Math.random() - 0.5) * 320,
        vry: (Math.random() - 0.5) * 320,
        vrz: (Math.random() - 0.5) * 320
      });
    }
  }

  updateConfetti(dt) {
    if (this.confettiParticles.length === 0) return;

    for (const p of this.confettiParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      p.rx += p.vrx * dt;
      p.ry += p.vry * dt;
      p.rz += p.vrz * dt;

      // Rest on grass
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vx = 0;
        p.vy = 0;
        p.vz = 0;
      }

      p.el.setAttribute('position', `${p.x} ${p.y} ${p.z}`);
      p.el.setAttribute('rotation', `${p.rx} ${p.ry} ${p.rz}`);
    }

    // Rotate trophy
    if (this.trophyEntity && this.trophyEntity.getAttribute('visible')) {
      const rot = this.trophyEntity.getAttribute('rotation') || { x: 0, y: 0, z: 0 };
      this.trophyEntity.setAttribute('rotation', `0 ${rot.y + dt * 45} 0`);
    }
  }

  clearConfetti() {
    for (const p of this.confettiParticles) {
      if (p.el && p.el.parentNode) {
        p.el.parentNode.removeChild(p.el);
      }
    }
    this.confettiParticles = [];
  }

  pulseHapticSequence() {
    if (!window.vrControllerManager) return;
    const delays = [0, 150, 320, 520, 800];
    delays.forEach((delay, idx) => {
      setTimeout(() => {
        window.vrControllerManager.triggerHaptic('left', 0.7, 90);
        window.vrControllerManager.triggerHaptic('right', 0.7, 90);
      }, delay);
    });
  }

  dismiss() {
    this.isActive = false;
    if (this.container) {
      this.container.setAttribute('visible', 'false');
    }
    if (this.victoryEntity) {
      this.victoryEntity.setAttribute('visible', 'false');
    }
    if (this.defeatEntity) {
      this.defeatEntity.setAttribute('visible', 'false');
    }
    if (this.trophyEntity) {
      this.trophyEntity.setAttribute('visible', 'false');
    }
    this.clearConfetti();
  }
}

window.vrCelebration = new VRCelebrationManager();
