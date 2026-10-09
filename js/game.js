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

}
