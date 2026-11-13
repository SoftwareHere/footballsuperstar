/** Tiny synthesized sound effects (no audio files). */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.crowd = null;
  }

  /** Browsers only allow audio after a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.6;
  }

  tone({ freq, to = freq, dur = 0.15, type = 'sine', gain = 0.3, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noiseBuffer(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  noise({ dur = 0.2, gain = 0.3, freq = 1000, to = freq, q = 1, type = 'bandpass', delay = 0, attack = 0.01 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur + 0.05);
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Low crowd murmur while a game is on. */
  setCrowd(on) {
    if (!this.ctx) return;
    if (on && !this.crowd) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(3);
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 520;
      filter.Q.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.value = 0.045;
      src.connect(filter).connect(g).connect(this.master);
      src.start();
      this.crowd = { src, g };
    } else if (!on && this.crowd) {
      try {
        this.crowd.src.stop();
      } catch {
        /* already stopped */
      }
      this.crowd = null;
    }
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'click':
        this.tone({ freq: 660, to: 880, dur: 0.05, type: 'triangle', gain: 0.15 });
        break;
      case 'hut':
        this.tone({ freq: 190, to: 120, dur: 0.11, type: 'sawtooth', gain: 0.3 });
        this.noise({ dur: 0.08, gain: 0.2, freq: 900 });
        break;
      case 'call':
        this.tone({ freq: 740, to: 990, dur: 0.09, type: 'square', gain: 0.12 });
        this.tone({ freq: 990, to: 1240, dur: 0.09, type: 'square', gain: 0.12, delay: 0.09 });
        break;
      case 'pressure':
        this.tone({ freq: 440, to: 330, dur: 0.14, type: 'square', gain: 0.14 });
        this.tone({ freq: 440, to: 330, dur: 0.14, type: 'square', gain: 0.14, delay: 0.16 });
        break;
      case 'throw':
        this.noise({ dur: 0.32, gain: 0.25, freq: 500, to: 2200, q: 2 });
        break;
      case 'juke':
        this.noise({ dur: 0.12, gain: 0.14, freq: 1800, to: 700, q: 1.5 });
        break;
      case 'jump':
        this.tone({ freq: 220, to: 420, dur: 0.12, type: 'sine', gain: 0.12 });
        break;
      case 'catch':
        this.tone({ freq: 150, to: 55, dur: 0.14, type: 'sine', gain: 0.5 });
        this.noise({ dur: 0.07, gain: 0.3, freq: 1400 });
        break;
      case 'tip':
        // Leather off fingertips.
        this.noise({ dur: 0.06, gain: 0.3, freq: 2400, q: 2 });
        this.tone({ freq: 520, to: 300, dur: 0.07, type: 'triangle', gain: 0.18 });
        break;
      case 'dive':
        this.noise({ dur: 0.22, gain: 0.16, freq: 900, to: 2600, q: 1.2 });
        break;
      case 'bump':
        this.tone({ freq: 95, to: 60, dur: 0.08, type: 'sine', gain: 0.22 });
        this.noise({ dur: 0.05, gain: 0.1, freq: 700 });
        break;
      case 'hands':
        // Palms on pads: the hand fight.
        this.noise({ dur: 0.045, gain: 0.2, freq: 1500, q: 1.4 });
        this.tone({ freq: 140, to: 90, dur: 0.05, type: 'sine', gain: 0.14 });
        break;
      case 'stumble':
        // Cleats scrabbling for grip.
        this.noise({ dur: 0.07, gain: 0.12, freq: 2200, to: 900, q: 1.5 });
        this.noise({ dur: 0.07, gain: 0.1, freq: 1900, to: 800, q: 1.5, delay: 0.11 });
        break;
      case 'hit':
        // Pads cracking together.
        this.tone({ freq: 130, to: 38, dur: 0.2, type: 'sine', gain: 0.6 });
        this.noise({ dur: 0.09, gain: 0.5, freq: 1900, to: 500, q: 0.8 });
        this.noise({ dur: 0.05, gain: 0.3, freq: 3600, q: 3 });
        break;
      case 'bodyfall':
        this.tone({ freq: 80, to: 40, dur: 0.18, type: 'sine', gain: 0.4 });
        this.noise({ dur: 0.16, gain: 0.16, freq: 420, to: 180, q: 0.7 });
        break;
      case 'thud':
        this.tone({ freq: 110, to: 45, dur: 0.16, type: 'sine', gain: 0.45 });
        this.noise({ dur: 0.1, gain: 0.2, freq: 500 });
        break;
      case 'cheer':
        this.noise({ dur: 1.7, gain: 0.22, freq: 700, to: 1500, q: 0.4, attack: 0.3 });
        break;
      case 'groan':
        this.noise({ dur: 1.1, gain: 0.14, freq: 600, to: 260, q: 0.6, attack: 0.15 });
        break;
      case 'whistle':
        for (let i = 0; i < 7; i++) {
          this.tone({ freq: 2350 + (i % 2) * 180, dur: 0.07, type: 'sine', gain: 0.1, delay: 0.25 + i * 0.055 });
        }
        break;
      case 'level':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.22, delay: i * 0.1 }));
        break;
      case 'win':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.28, type: 'triangle', gain: 0.22, delay: i * 0.13 }));
        this.noise({ dur: 2.4, gain: 0.25, freq: 700, to: 1600, q: 0.4, attack: 0.4 });
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.2, delay: i * 0.16 }));
        break;
      default:
    }
  }
}
