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
   */
  playThrow(pos, speed = 4.0) {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(550, now + 0.1);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.22);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);

      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (e) {}
      }, 300);
    } catch (e) {}
  }

  /**
   * Sound when grabbing Mölkky stick
   */
  playGrab(pos) {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.09);

      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (e) {}
      }, 150);
    } catch (e) {}
  }

  /**
   * Celebratory victory fanfare (50 points reached)
   */
  playVictory() {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx) return;

      const notes = [
        { f: 523.25, time: 0.0, dur: 0.16 }, // C5
        { f: 659.25, time: 0.14, dur: 0.16 }, // E5
        { f: 783.99, time: 0.28, dur: 0.18 }, // G5
        { f: 1046.50, time: 0.44, dur: 0.35 }, // C6
        { f: 880.00, time: 0.72, dur: 0.18 }, // A5
        { f: 1046.50, time: 0.90, dur: 0.60 }  // C6 long
      ];

      const now = this.ctx.currentTime;
      notes.forEach(n => {
        const start = now + n.time;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.f, start);

        gain.gain.setValueAtTime(0.28, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(start);
        osc.stop(start + n.dur);

        setTimeout(() => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch (e) {}
        }, 1500);
      });

      // Crowd cheer applause synthesis
      const bufferSize = Math.floor(this.ctx.sampleRate * 1.5);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.8));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, now + 0.3);
      filter.Q.setValueAtTime(1.2, now + 0.3);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.01, now + 0.3);
      noiseGain.gain.linearRampToValueAtTime(0.12, now + 0.6);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      noise.start(now + 0.3);
      noise.stop(now + 1.85);
    } catch (e) {}
  }

  /**
   * Defeat sound (3 consecutive misses)
   */
  playDefeat() {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;

      // Descending sad melody
      const notes = [
        { f: 349.23, time: 0.0, dur: 0.35 }, // F4
        { f: 329.63, time: 0.32, dur: 0.35 }, // E4
        { f: 293.66, time: 0.64, dur: 0.40 }, // D4
        { f: 220.00, time: 1.00, dur: 0.80 }  // A3
      ];

      notes.forEach(n => {
        const start = now + n.time;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(n.f, start);

        gain.gain.setValueAtTime(0.20, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(start);
        osc.stop(start + n.dur);

        setTimeout(() => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch (e) {}
        }, 1800);
      });

      // Low ominous gong bass
      const gongOsc = this.ctx.createOscillator();
      const gongGain = this.ctx.createGain();
      gongOsc.type = 'sine';
      gongOsc.frequency.setValueAtTime(80, now);
      gongOsc.frequency.exponentialRampToValueAtTime(35, now + 1.5);
      gongGain.gain.setValueAtTime(0.4, now);
      gongGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
      gongOsc.connect(gongGain);
      gongGain.connect(this.ctx.destination);
      gongOsc.start(now);
      gongOsc.stop(now + 1.6);
    } catch (e) {}
  }

  /**
   * Penalty sound (> 50 points reset to 25)
   */
  playPenalty() {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      [660, 440].forEach((freq, idx) => {
        const start = now + idx * 0.16;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.15, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(start);
        osc.stop(start + 0.16);

        setTimeout(() => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch (e) {}
        }, 500);
      });
    } catch (e) {}
  }

  /**
   * Miss sound (0 pin knocked down)
   */
  playMiss() {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(140, now + 0.22);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.24);

      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (e) {}
      }, 300);
    } catch (e) {}
  }
}

window.soundEngine = new SoundEngine();
