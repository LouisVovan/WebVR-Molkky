/**
 * ============================================================================
 * MODULE 4 : AUDIO 3D & SPATIALISATION BINAURALE
 * Fichier : js/audio.js - Classe SoundEngine
 * ============================================================================
 * 
 * DESCRIPTION DU FONCTIONNEMENT ET ARCHITECTURE :
 * 1. Synthèse sonore procédurale intégrale (Zéro fichier MP3/WAV externe) :
 *    - Tous les sons (chocs de bois, frottement d'herbe, sifflement d'air, fanfare de victoire)
 *      sont générés par synthèse soustractive et modulation de fréquence en direct :
 *      * Oscillateurs (sinus, triangle, carré, dent de scie)
 *      * Tampons de bruit blanc (White Noise Buffer) filtrés par des BiquadFilterNode
 *      * Enveloppes d'amplitude ADSR (Attack-Decay-Sustain-Release) via GainNode.
 * 2. Spatialisation Audio 3D Binaurale (Web Audio API) :
 *    - La position et l'orientation de la tête du joueur sont transmises à l'objet `AudioListener`.
 *    - Chaque impact physique est émis depuis un `PannerNode` spatialisé aux coordonnées 3D
 *      exactes de la quille ou du bâton (modèle d'atténuation inverse de la distance).
 *    - Résultat : En fermant les yeux, le joueur entend précisément si la quille est tombée
 *      à sa gauche ou au fond à droite !
 * 3. Rate-Limiting & Protection du CPU mobile (Meta Quest 3) :
 *    - Lors d'une collision en chaîne (carreau), des dizaines de chocs surviennent en 50ms.
 *    - Un filtre temporel anti-saturation (minimum 45ms entre deux clacs de bois) évite tout
 *      écrêtage (clipping) ou ralentissement du processeur audio.
 * ============================================================================
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.listener = null;
    this.isMuted = false;

    // Horodatages pour limiter la cadence d'émission et éviter la saturation
    this.lastWoodTime = 0;
    this.lastGrassTime = 0;

    this.initAudioContext();
  }

  /**
   * Crée l'AudioContext standardisé ou webkit
   */
  initAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.listener = this.ctx.listener;
      }
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  /**
   * Réactive l'AudioContext si suspendu par les politiques de sécurité du navigateur
   * (Nécessite une première interaction utilisateur : clic, entrée VR ou appui bouton)
   */
  ensureContext() {
    try {
      if (!this.ctx) this.initAudioContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Met à jour la position et l'orientation de l'auditeur virtuel pour la spatialisation
   * Détails techniques et fonctionnement :
   * - Récupère la matrice de rotation de la caméra VR.
   * - Projette les vecteurs 'forward' (direction du regard) et 'up' (sommet du crâne)
   *   dans les paramètres forwardX/Y/Z et upX/Y/Z de l'AudioListener.
   */
  updateListener(cameraObj3D) {
    if (!this.ctx || !cameraObj3D || !this.listener) return;
    try {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      cameraObj3D.getWorldPosition(pos);
      cameraObj3D.getWorldQuaternion(quat);

      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);

      if (this.listener.positionX) {
        this.listener.positionX.setValueAtTime(pos.x, this.ctx.currentTime);
        this.listener.positionY.setValueAtTime(pos.y, this.ctx.currentTime);
        this.listener.positionZ.setValueAtTime(pos.z, this.ctx.currentTime);
        this.listener.forwardX.setValueAtTime(forward.x, this.ctx.currentTime);
        this.listener.forwardY.setValueAtTime(forward.y, this.ctx.currentTime);
        this.listener.forwardZ.setValueAtTime(forward.z, this.ctx.currentTime);
        this.listener.upX.setValueAtTime(up.x, this.ctx.currentTime);
        this.listener.upY.setValueAtTime(up.y, this.ctx.currentTime);
        this.listener.upZ.setValueAtTime(up.z, this.ctx.currentTime);
      } else if (this.listener.setPosition) {
        this.listener.setPosition(pos.x, pos.y, pos.z);
        this.listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
      }
    } catch (e) {
      // Ignore listener update error
    }
  }

  /**
   * Creates a lightweight PannerNode with automatic disconnection
   */
  createPanner(pos = { x: 0, y: 1, z: -3 }) {
    if (!this.ctx) return null;
    try {
      const panner = this.ctx.createPanner();
      // equalpower is much faster and stable than HRTF on mobile VR chipsets
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.5;
      panner.maxDistance = 25;
      panner.rolloffFactor = 1.0;

      const px = isFinite(pos.x) ? pos.x : 0;
      const py = isFinite(pos.y) ? pos.y : 1;
      const pz = isFinite(pos.z) ? pos.z : -3;

      if (panner.positionX) {
        panner.positionX.setValueAtTime(px, this.ctx.currentTime);
        panner.positionY.setValueAtTime(py, this.ctx.currentTime);
        panner.positionZ.setValueAtTime(pz, this.ctx.currentTime);
      } else if (panner.setPosition) {
        panner.setPosition(px, py, pz);
      }
      return panner;
    } catch (e) {
      return null;
    }
  }

  /**
   * Procedural wooden collision impact (Rate-limited, auto-cleanup)
   */
  playWoodImpact(pos, intensity = 1.0) {
    if (this.isMuted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastWoodTime < 70) return; // Rate-limit to max ~14/sec
    this.lastWoodTime = nowMs;

    try {
      this.ensureContext();
      if (!this.ctx) return;

      const clampedIntensity = Math.min(Math.max(intensity, 0.3), 2.5);
      const now = this.ctx.currentTime;
      const panner = this.createPanner(pos);
      const destination = panner ? panner : this.ctx.destination;
      if (panner) panner.connect(this.ctx.destination);

      const impactGain = this.ctx.createGain();
      impactGain.gain.setValueAtTime(Math.min(clampedIntensity * 0.35, 0.7), now);
      impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      impactGain.connect(destination);

      // Resonant wood tone
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(560 + Math.random() * 60, now);
      osc.frequency.exponentialRampToValueAtTime(380, now + 0.12);

      osc.connect(impactGain);
      osc.start(now);
      osc.stop(now + 0.14);

      // Auto-cleanup audio nodes after sound finishes
      setTimeout(() => {
        try {
          if (panner) panner.disconnect();
          impactGain.disconnect();
          osc.disconnect();
        } catch (e) {}
      }, 250);
    } catch (err) {
      console.warn('Wood impact audio error:', err);
    }
  }

  /**
   * Procedural grass landing sound (Rate-limited, auto-cleanup)
   */
  playGrassImpact(pos, intensity = 1.0) {
    if (this.isMuted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastGrassTime < 100) return; // Rate-limit to max 10/sec
    this.lastGrassTime = nowMs;

    try {
      this.ensureContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const panner = this.createPanner(pos);
      const destination = panner ? panner : this.ctx.destination;
      if (panner) panner.connect(this.ctx.destination);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.min(intensity * 0.25, 0.5), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      gain.connect(destination);

      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.15);

      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.16);

      setTimeout(() => {
        try {
          if (panner) panner.disconnect();
          gain.disconnect();
          osc.disconnect();
        } catch (e) {}
      }, 250);
    } catch (err) {
      console.warn('Grass impact audio error:', err);
    }
  }

  /**
   * Whoosh sound during throw

}
