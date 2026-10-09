/**
 * Web Audio API 3D Spatialized Sound Engine for WebVR Mölkky
 * High-fidelity procedural audio: wood impacts, grass hits, throws, victory & defeat
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.listener = null;
    this.isMuted = false;
    this.initAudioContext();
  }

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

  ensureContext() {
    if (!this.ctx) this.initAudioContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Update listener position and orientation to match player's head/camera in VR
   */
  updateListener(cameraObj3D) {
    if (!this.ctx || !cameraObj3D || !this.listener) return;
    this.ensureContext();

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
  }

  /**
   * Creates a 3D PannerNode positioned at {x, y, z}
   */
  createPanner(pos = { x: 0, y: 1, z: -3 }) {
    if (!this.ctx) return null;
    try {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.5;
      panner.maxDistance = 30;
      panner.rolloffFactor = 1.0;

      if (panner.positionX) {
        panner.positionX.setValueAtTime(pos.x || 0, this.ctx.currentTime);
        panner.positionY.setValueAtTime(pos.y || 1, this.ctx.currentTime);
        panner.positionZ.setValueAtTime(pos.z || 0, this.ctx.currentTime);
      } else if (panner.setPosition) {
        panner.setPosition(pos.x || 0, pos.y || 1, pos.z || 0);
      }
      return panner;
    } catch (e) {
      return null;
    }
  }

  /**
   * Procedural wooden collision impact (Mölkky hits Pin or Pin hits Pin)
   * Sharp attack transient + resonant wooden body cavity filters
   */
  playWoodImpact(pos, intensity = 1.0) {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const clampedIntensity = Math.min(Math.max(intensity, 0.2), 3.0);
    const now = this.ctx.currentTime;
    const panner = this.createPanner(pos);
    const destination = panner ? panner : this.ctx.destination;
    if (panner) panner.connect(this.ctx.destination);

    // Master impact gain
    const impactGain = this.ctx.createGain();
    impactGain.gain.setValueAtTime(Math.min(clampedIntensity * 0.45, 0.9), now);
    impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    impactGain.connect(destination);

    // 1. Noise transient (initial tap)
    const bufferSize = this.ctx.sampleRate * 0.03;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(1400, now);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(impactGain);
    noiseSource.start(now);

    // 2. Resonant wooden frequency oscillators (dual cylindrical wood resonances)
    const baseFreq = 540 + Math.random() * 80;
    const freqs = [baseFreq, baseFreq * 2.2];

    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();

      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.85, now + 0.15);

      const amp = idx === 0 ? 0.6 : 0.3;
      oscGain.gain.setValueAtTime(amp, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(oscGain);
      oscGain.connect(impactGain);

      osc.start(now);
      osc.stop(now + 0.16);
    });
  }

  /**
   * Procedural grass landing sound (muffled organic thud)
   */
  playGrassImpact(pos, intensity = 1.0) {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const panner = this.createPanner(pos);
    const destination = panner ? panner : this.ctx.destination;
    if (panner) panner.connect(this.ctx.destination);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(Math.min(intensity * 0.3, 0.6), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    gain.connect(destination);

    // Filtered low frequency thump
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  /**
   * Whoosh sound during swing and throw
   */
  playThrow(pos, speed = 4.0) {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const panner = this.createPanner(pos);
    const destination = panner ? panner : this.ctx.destination;
    if (panner) panner.connect(this.ctx.destination);

    const bufferSize = this.ctx.sampleRate * 0.25;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3.0;
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(1100 + speed * 100, now + 0.12);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.25);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(Math.min(0.35, 0.15 + speed * 0.03), now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    noise.start(now);
    noise.stop(now + 0.26);
  }

  /**
   * Sound when grabbing Mölkky stick
   */
  playGrab(pos) {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(950, now + 0.06);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Celebratory victory fanfare (Target 50 points reached!)
   */
  playVictory() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const notes = [
      { f: 523.25, time: 0.0, dur: 0.2 }, // C5
      { f: 659.25, time: 0.18, dur: 0.2 }, // E5
      { f: 783.99, time: 0.36, dur: 0.2 }, // G5
      { f: 1046.50, time: 0.54, dur: 0.6 } // C6
    ];

    const now = this.ctx.currentTime;
    notes.forEach(n => {
      const start = now + n.time;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.f, start);

      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + n.dur);
    });
  }

  /**
   * Defeat buzzer / sad cadence (3 consecutive misses)
   */
  playDefeat() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const notes = [
      { f: 330.0, time: 0.0, dur: 0.35 },  // E4
      { f: 311.1, time: 0.32, dur: 0.35 }, // Eb4
      { f: 293.6, time: 0.64, dur: 0.35 }, // D4
      { f: 220.0, time: 0.96, dur: 0.7 }   // A3
    ];

    const now = this.ctx.currentTime;
    notes.forEach(n => {
      const start = now + n.time;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.f, start);

      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + n.dur);
    });
  }

  /**
   * Score overshot 50 points -> penalty reset to 25
   */
  playPenalty() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [660, 440].forEach((freq, idx) => {
      const start = now + idx * 0.18;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + 0.18);
    });
  }

  /**
   * Miss sound (0 pin knocked down)
   */
  playMiss() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(140, now + 0.25);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.26);
  }
}

// Global singleton instance
window.soundEngine = new SoundEngine();
