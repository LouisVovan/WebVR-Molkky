/**
 * ============================================================================
 * MODULE 3 : LOGIQUE DE JEU ET RÈGLES OFFICIELLES DU MÖLKKY
 * Fichier : js/game.js - Classe MolkkyGame
 * ============================================================================
 * 
 * DESCRIPTION DU FONCTIONNEMENT ET ARCHITECTURE :
 * 1. Machine à États Finis (Finite State Machine - FSM) :
 *    - 'MENU'       : Écran d'accueil avant le premier lancer.
 *    - 'READY'      : Le bâton repose sur son pupitre, joueur libre de se déplacer.
 *    - 'AIMING'     : Le joueur tient le bâton en main (gâchette enfoncée).
 *    - 'FLYING'     : Le bâton a été lâché et vole vers les quilles.
 *    - 'SETTLING'   : Phase de physique active jusqu'à l'arrêt complet de tous les corps.
 *    - 'GAME_OVER'  : Partie terminée (Victoire ou Défaite par 3 fautes).
 * 2. Implémentation stricte des règles officielles de la FIMO (Fédération Internationale de Mölkky) :
 *    - Règle 1 : Si une SEULE quille tombe, on marque la valeur inscrite sur la quille (1 à 12).
 *    - Règle 2 : Si PLUSIEURS quilles tombent, on marque le nombre de quilles abattues.
 *    - Règle 3 (Victoire) : Le but est d'atteindre EXACTEMENT 50 points.
 *    - Règle 4 (Pénalité de dépassement) : Si le score dépasse 50, il retombe automatiquement à 25 points !
 *    - Règle 5 (Élimination) : 3 lancers consécutifs sans faire tomber de quille entraînent la défaite.
 * 3. Synchronisation bidirectionnelle de l'interface (Dual UI) :
 *    - Met à jour simultanément le HUD 2D (HTML/CSS) pour le spectateur et le Totem 3D (A-Frame)
 *      pour le joueur immergé dans le casque VR.
 * ============================================================================
 */

class MolkkyGame {
  constructor() {
    // État courant de la machine à états finis
    this.state = 'MENU';
    this.difficulty = 'normal'; // 'facile' (-2.5m), 'normal' (-3.5m), 'difficile' (-4.8m)

    this.score = 0;
    this.targetScore = 50;
    this.throwCount = 0;
    this.consecutiveMisses = 0;  // Compteur d'échecs (défaite à 3)
    this.lastPoints = 0;
    this.lastFallenPins = [];
    this.history = [];

    // Chronomètre de la partie
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.timerInterval = null;

    // Paramètres selon la difficulté
    this.difficultyConfigs = {
      facile: {
        distance: -2.5,
        visualAssist: true,      // Active l'arc de visée parabolique en réalité virtuelle
        label: 'Facile'
      },
      normal: {
        distance: -3.5,          // Distance officielle standard
        visualAssist: false,
        label: 'Normal'
      },
      difficile: {
        distance: -4.8,          // Distance tournoi expert
        visualAssist: false,
        label: 'Difficile'
      }
    };

    // Clé de persistance locale dans le navigateur
    this.STORAGE_KEY = 'webvr_molkky_best_records';
    this.bestRecord = this.loadBestRecord();

    this.initPhysicsCallbacks();
  }

  loadBestRecord() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Cannot read localStorage', e);
    }
    return {
      wins: 0,
      bestThrows: null,
      bestTime: null,
      highestScore: 0,
      difficulty: 'normal'
    };
  }

  saveBestRecord() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.bestRecord));
    } catch (e) {
      console.warn('Cannot write localStorage', e);
    }
  }

  initPhysicsCallbacks() {
    if (window.molkkyPhysics) {
      window.molkkyPhysics.settleCallback = (fallenPins) => {
        this.onThrowSettled(fallenPins);
      };
    }
  }

  setDifficulty(level) {
    if (!this.difficultyConfigs[level]) return;
    this.difficulty = level;
    const config = this.difficultyConfigs[level];

    // Reposition pins to match distance
    if (window.molkkyPhysics) {
      window.molkkyPhysics.resetAllPinsToInitial(config.distance);
    }

    this.updateUI();
  }

  startNewGame(level = null) {
    if (level) this.setDifficulty(level);

    this.score = 0;
    this.throwCount = 0;
    this.consecutiveMisses = 0;
    this.lastPoints = 0;
    this.lastFallenPins = [];
    this.history = [];
    this.elapsedSeconds = 0;
    this.state = 'READY';

    // Timer start
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      if (this.state !== 'GAME_OVER' && this.state !== 'MENU') {
        this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        this.updateTimerUI();
      }
    }, 1000);

    // Reset physics pins & baton
    const config = this.difficultyConfigs[this.difficulty];
    if (window.molkkyPhysics) {
      window.molkkyPhysics.resetAllPinsToInitial(config.distance);
      window.molkkyPhysics.resetBatonToStand();
    }
    if (window.vrControllerManager) {
      window.vrControllerManager.resetToStand();
    }
    if (window.vrCelebration) {
      window.vrCelebration.dismiss();
    }

    this.showFeedback('Partie démarrée ! Visez les 50 points.', 'info');
    this.updateUI();
  }

  restartGame() {
    this.startNewGame(this.difficulty);
  }

  returnToMenu() {
    this.state = 'MENU';
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.updateUI();
  }

  /**
   * Called when player throws the baton
   */
  onThrowLaunched() {
    if (this.state !== 'READY' && this.state !== 'AIMING') return;

    this.state = 'FLYING';
    this.throwCount++;
    this.updateUI();
  }

  /**
   * Arbitrage automatique déclenché par Cannon.js dès l'arrêt des mouvements
   * Règles d'arbitrage et décompte des points :
   * - Cette méthode incarne le "Cerveau" des règles du jeu :
   *   1. Cas 0 quille tombée : Faux lancer (Miss), incrémente les échecs consécutifs.
   *      À 3 échecs consécutifs -> DÉFAITE immédiate (élimination du joueur).
   *   2. Cas 1 seule quille : Règle tactique où le joueur marque le NUMÉRO de la quille (1 à 12).
   *   3. Cas plusieurs quilles : Règle de masse où le joueur marque le NOMBRE de quilles (ex: 4 quilles = 4 points).
   *   4. Vérification Victoire : Si score == 50 -> Célébration (confettis + trophée 3D).
   *   5. Règle du dépassement : Si score > 50 -> Pénalité sévère, le score est ramené à 25 points !
   */
  onThrowSettled(fallenPins) {
    try {
      if (this.state === 'GAME_OVER') return;

      this.state = 'SETTLING';
      const safePins = Array.isArray(fallenPins) ? fallenPins : [];
      this.lastFallenPins = safePins.map(p => p.number);
      let pointsAwarded = 0;
      let feedbackMsg = '';
      let feedbackType = 'info';

      // Application stricte des règles officielles de décompte des points
      if (safePins.length === 0) {
        // Cas A : Échec (0 quille tombée)
        pointsAwarded = 0;
        this.consecutiveMisses++;
        feedbackMsg = `0 quille tombée ! Échec ${this.consecutiveMisses}/3`;
        feedbackType = 'warning';

        if (window.soundEngine) window.soundEngine.playMiss();
      } else if (safePins.length === 1) {
        // Cas B : 1 seule quille tombée -> Valeur du numéro inscrit dessus
        const pinNum = safePins[0].number;
        pointsAwarded = pinNum;
        this.consecutiveMisses = 0; // Remise à zéro de la série d'échecs
        feedbackMsg = `Quille ${pinNum} tombée ! +${pinNum} points`;
        feedbackType = 'success';

        if (window.soundEngine) window.soundEngine.playWoodImpact({ x: 0, y: 1, z: -2 }, 1.5);
      } else {
        // Cas C : Plusieurs quilles tombées -> Nombre de quilles abattues
        const count = safePins.length;
        pointsAwarded = count;
        this.consecutiveMisses = 0;
        const pinList = safePins.map(p => p.number).sort((a, b) => a - b).join(', ');
        feedbackMsg = `${count} quilles tombées (${pinList}) ! +${count} points`;
        feedbackType = 'success';

        if (window.soundEngine) window.soundEngine.playWoodImpact({ x: 0, y: 1, z: -2 }, 2.0);
      }

      this.lastPoints = pointsAwarded;
      const previousScore = this.score;
      const prospectiveScore = previousScore + pointsAwarded;

      // 1. Condition de Défaite : 3 échecs consécutifs
      if (this.consecutiveMisses >= 3) {
        this.handleGameOver(false, 'Défaite : 3 lancers consécutifs sans marquer.');
        this.recordThrow(pointsAwarded, this.score);
        return;
      }

      // 2. Condition de Victoire : Atteindre exactement 50 points
      if (prospectiveScore === this.targetScore) {
        this.score = 50;
        this.handleGameOver(true, `Victoire ! 50 points atteints en ${this.throwCount} lancers !`);
        this.recordThrow(pointsAwarded, this.score);
        return;
      }

      // 3. Règle de Pénalité : Si le joueur dépasse 50, son score retombe à 25
      if (prospectiveScore > this.targetScore) {
        this.score = 25;
        feedbackMsg = `DÉPASSEMENT (${prospectiveScore} pts) ! Score ramené à 25 points.`;
        feedbackType = 'penalty';

        if (window.soundEngine) window.soundEngine.playPenalty();
      } else {
        this.score = prospectiveScore;
      }

      // Record throw history
      this.recordThrow(pointsAwarded, this.score);
      this.showFeedback(feedbackMsg, feedbackType);

      // Stand fallen pins upright on spot & return baton
      setTimeout(() => {
        try {
          if (window.molkkyPhysics) {
            window.molkkyPhysics.standFallenPinsUpright();
            window.molkkyPhysics.resetBatonToStand();
          }
          this.state = 'READY';
          this.updateUI();
        } catch (e) {
          console.warn('Reset round error:', e);
        }
      }, 1500);

      this.updateUI();
    } catch (err) {
      console.warn('onThrowSettled error caught:', err);
      this.state = 'READY';
      if (window.molkkyPhysics) {
        window.molkkyPhysics.resetBatonToStand();
      }
    }
  }

  recordThrow(points, totalScore) {
    this.history.unshift({
      throwNum: this.throwCount,
      fallenPins: [...this.lastFallenPins],
      points: points,
      totalScore: totalScore,
      time: this.formatTime(this.elapsedSeconds)
    });
  }

  handleGameOver(isVictory, message) {
    this.state = 'GAME_OVER';
    if (this.timerInterval) clearInterval(this.timerInterval);

    // Save best records
    if (isVictory) {
      this.bestRecord.wins++;
      if (this.bestRecord.bestThrows === null || this.throwCount < this.bestRecord.bestThrows) {
        this.bestRecord.bestThrows = this.throwCount;
        this.bestRecord.bestTime = this.elapsedSeconds;
      }
      if (this.score > this.bestRecord.highestScore) {
        this.bestRecord.highestScore = this.score;
      }
      this.saveBestRecord();

      if (window.soundEngine) window.soundEngine.playVictory();

      // Trigger 3D VR Celebration
      if (window.vrCelebration) {
        window.vrCelebration.triggerVictory({
          throwCount: this.throwCount,
          time: this.formatTime(this.elapsedSeconds),
          difficulty: this.difficultyConfigs[this.difficulty].label,
          score: this.score
        });
      }
    } else {
      if (this.score > this.bestRecord.highestScore) {
        this.bestRecord.highestScore = this.score;
        this.saveBestRecord();
      }
      if (window.soundEngine) window.soundEngine.playDefeat();

      // Trigger 3D VR Defeat Scene
      if (window.vrCelebration) {
        window.vrCelebration.triggerDefeat({
          throwCount: this.throwCount,
          time: this.formatTime(this.elapsedSeconds),
          difficulty: this.difficultyConfigs[this.difficulty].label,
          score: this.score
        });
      }
    }

    this.showGameOverModal(isVictory, message);
    this.updateUI();
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  showFeedback(message, type = 'info') {
    const feedbackEl = document.getElementById('feedback-banner');
    if (feedbackEl) {
      feedbackEl.textContent = message;
      feedbackEl.className = `feedback-banner show ${type}`;

      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = setTimeout(() => {
        feedbackEl.className = 'feedback-banner';
      }, 3500);
    }

    // Also update 3D VR board notification (strip accents so A-Frame SDF font does not drop characters)
    const vrFeedback = document.getElementById('vr-feedback-text');
    if (vrFeedback) {
      const cleanMsg = (message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      vrFeedback.setAttribute('value', cleanMsg);
    }
  }

  showGameOverModal(isVictory, message) {
    const modal = document.getElementById('gameover-modal');
    const title = document.getElementById('gameover-title');
    const desc = document.getElementById('gameover-desc');
    const stats = document.getElementById('gameover-stats');

    if (!modal) return;

    if (isVictory) {
      title.textContent = '🏆 VICTOIRE !';
      title.style.color = '#4ade80';
    } else {
      title.textContent = '💀 DÉFAITE';
      title.style.color = '#f87171';
    }

    desc.textContent = message;
    stats.innerHTML = `
      <div class="stat-card"><span>Score final</span><strong>${this.score} / 50</strong></div>
      <div class="stat-card"><span>Nombre de lancers</span><strong>${this.throwCount}</strong></div>
      <div class="stat-card"><span>Temps de jeu</span><strong>${this.formatTime(this.elapsedSeconds)}</strong></div>
      <div class="stat-card"><span>Difficulté</span><strong>${this.difficultyConfigs[this.difficulty].label}</strong></div>
    `;

    modal.classList.add('visible');
  }

  closeGameOverModal() {
    const modal = document.getElementById('gameover-modal');
    if (modal) modal.classList.remove('visible');
  }

  updateTimerUI() {
    const timerStr = this.formatTime(this.elapsedSeconds);
    const timer2D = document.getElementById('hud-timer');
    if (timer2D) timer2D.textContent = timerStr;

    const vrTimer = document.getElementById('vr-timer-text');
    if (vrTimer) vrTimer.setAttribute('value', `Temps: ${timerStr}`);
  }

  updateUI() {
    // 2D HUD elements
    const hudScore = document.getElementById('hud-score');
    const hudThrows = document.getElementById('hud-throws');
    const hudLastPoints = document.getElementById('hud-last-points');
    const hudMisses = document.getElementById('hud-misses');
    const hudDifficulty = document.getElementById('hud-difficulty');
    const historyList = document.getElementById('history-list');

    if (hudScore) hudScore.textContent = `${this.score} / 50`;
    if (hudThrows) hudThrows.textContent = `Lancer #${this.throwCount}`;
    if (hudLastPoints) hudLastPoints.textContent = `+${this.lastPoints}`;
    if (hudDifficulty) hudDifficulty.textContent = this.difficultyConfigs[this.difficulty].label;

    if (hudMisses) {
      hudMisses.textContent = `${this.consecutiveMisses} / 3`;
      if (this.consecutiveMisses >= 2) {
        hudMisses.className = 'danger-text';
      } else {
        hudMisses.className = '';
      }
    }

    // History list rendering
    if (historyList) {
      if (this.history.length === 0) {
        historyList.innerHTML = '<li class="empty-history">Aucun lancer pour l\'instant</li>';
      } else {
        historyList.innerHTML = this.history.slice(0, 10).map(h => `
          <li>
            <span class="hist-num">#${h.throwNum}</span>
            <span class="hist-detail">${h.fallenPins.length === 0 ? 'Raté' : (h.fallenPins.length === 1 ? `Quille [${h.fallenPins[0]}]` : `${h.fallenPins.length} quilles`)}</span>
            <span class="hist-pts">+${h.points} pts</span>
            <span class="hist-tot">${h.totalScore} tot</span>
          </li>
        `).join('');
      }
    }

    // 3D VR Board Scoreboard Entities
    const vrScore = document.getElementById('vr-score-text');
    const vrThrows = document.getElementById('vr-throws-text');
    const vrLast = document.getElementById('vr-last-text');
    const vrMisses = document.getElementById('vr-misses-text');
    const vrDiff = document.getElementById('vr-diff-text');
    const vrBtnDiff = document.getElementById('vr-btn-diff-text');
    const vrBtnJoy = document.getElementById('vr-btn-joy-text');
    const vrScoreBar = document.getElementById('vr-score-bar');

    if (vrScore) vrScore.setAttribute('value', `${this.score} / 50`);
    if (vrThrows) vrThrows.setAttribute('value', `Lancers : #${this.throwCount}`);
    if (vrLast) vrLast.setAttribute('value', `Dernier : +${this.lastPoints} pts`);
    if (vrMisses) vrMisses.setAttribute('value', `Échecs : ${this.consecutiveMisses} / 3`);
    if (vrDiff) vrDiff.setAttribute('value', `Niveau : ${this.difficultyConfigs[this.difficulty].label}`);
    if (vrBtnDiff) vrBtnDiff.setAttribute('value', `Niveau : ${this.difficultyConfigs[this.difficulty].label}`);

    if (vrBtnJoy) {
      const joyMode = (window.vrControllerManager && window.vrControllerManager.invertLocomotion) ? 'Inversé' : 'Normal';
      vrBtnJoy.setAttribute('value', `Joystick : ${joyMode}`);
    }

    // Dynamic 3D Progress Bar (0 to 50 points)
    if (vrScoreBar) {
      const progressFraction = Math.max(0.015, Math.min(this.score / 50, 1.0));
      const fullWidth = 0.68;
      const barWidth = fullWidth * progressFraction;
      const startX = -0.34;
      vrScoreBar.setAttribute('width', barWidth.toFixed(3));
      vrScoreBar.setAttribute('position', `${(startX + barWidth / 2).toFixed(3)} 1.62 0.12`);

      if (this.score >= 50) {
        vrScoreBar.setAttribute('color', '#4ade80');
      } else if (this.score >= 35) {
        vrScoreBar.setAttribute('color', '#fbbf24');
      } else {
        vrScoreBar.setAttribute('color', '#38bdf8');
      }
    }

    // 3 Physical Strike Warning Indicator Gems
    const s1 = document.getElementById('vr-strike-1');
    const s2 = document.getElementById('vr-strike-2');
    const s3 = document.getElementById('vr-strike-3');

    if (s1) {
      if (this.consecutiveMisses >= 1) {
        s1.setAttribute('color', '#f59e0b');
        s1.setAttribute('material', 'emissive: #d97706; emissiveIntensity: 0.9; roughness: 0.2');
      } else {
        s1.setAttribute('color', '#1e293b');
        s1.setAttribute('material', 'emissive: #000000; emissiveIntensity: 0; roughness: 0.7');
      }
    }
    if (s2) {
      if (this.consecutiveMisses >= 2) {
        s2.setAttribute('color', '#ea580c');
        s2.setAttribute('material', 'emissive: #c2410c; emissiveIntensity: 0.9; roughness: 0.2');
      } else {
        s2.setAttribute('color', '#1e293b');
        s2.setAttribute('material', 'emissive: #000000; emissiveIntensity: 0; roughness: 0.7');
      }
    }
    if (s3) {
      if (this.consecutiveMisses >= 3) {
        s3.setAttribute('color', '#ef4444');
        s3.setAttribute('material', 'emissive: #b91c1c; emissiveIntensity: 1.0; roughness: 0.2');
      } else {
        s3.setAttribute('color', '#1e293b');
        s3.setAttribute('material', 'emissive: #000000; emissiveIntensity: 0; roughness: 0.7');
      }
    }
  }
}

window.molkkyGame = new MolkkyGame();
