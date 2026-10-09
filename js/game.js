/**
 * Core Game Engine and Rules Manager for WebVR Mölkky
 * Conforms strictly to official Mölkky rules and ST2AWD requirements
 */

class MolkkyGame {
  constructor() {
    this.state = 'MENU'; // 'MENU', 'READY', 'AIMING', 'FLYING', 'SETTLING', 'ROUND_OVER', 'GAME_OVER'
    this.difficulty = 'normal'; // 'facile', 'normal', 'difficile'

    this.score = 0;
    this.targetScore = 50;
    this.throwCount = 0;
    this.consecutiveMisses = 0;
    this.lastPoints = 0;
    this.lastFallenPins = [];
    this.history = [];

    // Timer
    this.startTime = null;
    this.elapsedSeconds = 0;
    this.timerInterval = null;

    // Distances based on difficulty (meters along Z)
    this.difficultyConfigs = {
      facile: {
        distance: -2.5,
        visualAssist: true,
        label: 'Facile'
      },
      normal: {
        distance: -3.5,
        visualAssist: false,
        label: 'Normal'
      },
      difficile: {
        distance: -4.8,
        visualAssist: false,
        label: 'Difficile'
      }
    };

    // Best results key
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
   * Called automatically by physics engine once all bodies have settled
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

      // Official Mölkky Scoring Rules
      if (safePins.length === 0) {
        // Échec (Miss)
        pointsAwarded = 0;
        this.consecutiveMisses++;
        feedbackMsg = `0 quille tombée ! Échec ${this.consecutiveMisses}/3`;
        feedbackType = 'warning';

        if (window.soundEngine) window.soundEngine.playMiss();
      } else if (safePins.length === 1) {
        // 1 seule quille : valeur du numéro
        const pinNum = safePins[0].number;
        pointsAwarded = pinNum;
        this.consecutiveMisses = 0;
        feedbackMsg = `Quille ${pinNum} tombée ! +${pinNum} points`;
        feedbackType = 'success';

        if (window.soundEngine) window.soundEngine.playWoodImpact({ x: 0, y: 1, z: -2 }, 1.5);
      } else {
        // Plusieurs quilles : nombre de quilles tombées
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

      // Check game condition:
      // 1. Defeat: 3 consecutive misses
      if (this.consecutiveMisses >= 3) {
        this.handleGameOver(false, 'Défaite : 3 lancers consécutifs sans marquer.');
        this.recordThrow(pointsAwarded, this.score);
        return;
      }

      // 2. Victory: exactly 50 points
      if (prospectiveScore === this.targetScore) {
        this.score = 50;
        this.handleGameOver(true, `Victoire ! 50 points atteints en ${this.throwCount} lancers !`);
        this.recordThrow(pointsAwarded, this.score);
        return;
      }

      // 3. Penalty: overshot 50 -> reset to 25
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
    } else {
      if (this.score > this.bestRecord.highestScore) {
        this.bestRecord.highestScore = this.score;
        this.saveBestRecord();
      }
      if (window.soundEngine) window.soundEngine.playDefeat();
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

    // Also update 3D VR board notification
    const vrFeedback = document.getElementById('vr-feedback-text');
    if (vrFeedback) {
      vrFeedback.setAttribute('value', message);
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

    if (vrScore) vrScore.setAttribute('value', `SCORE: ${this.score} / 50`);
    if (vrThrows) vrThrows.setAttribute('value', `Lancers: ${this.throwCount}`);
    if (vrLast) vrLast.setAttribute('value', `Dernier lancer: +${this.lastPoints} pts`);
    if (vrMisses) vrMisses.setAttribute('value', `Échecs: ${this.consecutiveMisses} / 3`);
    if (vrDiff) vrDiff.setAttribute('value', `Difficulté: ${this.difficultyConfigs[this.difficulty].label}`);
  }
}

window.molkkyGame = new MolkkyGame();
