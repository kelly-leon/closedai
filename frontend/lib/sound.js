const SOUND_DEFAULT_ON = false;
const PITCHES = [720, 960, 1280, 1680, 2200];

class SoundController {
  constructor(options = {}) {
    this.enabled = false;
    this.context = options.context ?? null;
    this.contextFactory = options.contextFactory ?? (() => {
      if (typeof window === "undefined") return null;
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      return AudioContextCtor ? new AudioContextCtor() : null;
    });
    this.lastBlip = 0;
    this.nodes = new Set();
    this.bed = null;
    this.visibilityHandler = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.stop();
  }

  async gesture() {
    if (!this.enabled || typeof window === "undefined") return;
    if (!this.context) this.context = this.contextFactory();
    if (!this.context) return;
    if (this.context.state === "suspended" && typeof this.context.resume === "function") {
      await this.context.resume();
    }
  }

  track(node) {
    this.nodes.add(node);
    node.addEventListener?.("ended", () => this.nodes.delete(node));
  }

  tone(frequency, duration, gainValue = 0.018, delay = 0) {
    if (!this.enabled || !this.context || typeof document !== "undefined" && document.hidden) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    this.track(oscillator);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  blip() {
    if (!this.enabled || !this.context || typeof document !== "undefined" && document.hidden) return;
    const nowMs = Date.now();
    if (nowMs - this.lastBlip < 85) return;
    this.lastBlip = nowMs;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(PITCHES[Math.floor(Math.random() * PITCHES.length)], now);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.setValueAtTime(5, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.012, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    this.track(oscillator);
    oscillator.start(now);
    oscillator.stop(now + 0.025);
  }

  startBed() {
    if (!this.enabled || !this.context || this.bed) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 62;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.004, ctx.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    this.bed = { oscillator, gain };
    this.track(oscillator);
  }

  tokens(_batch) {
    if (!this.enabled) return;
    this.startBed();
    this.blip();
  }

  done() {
    if (!this.enabled) return;
    this.stop(false);
    this.tone(660, 0.12, 0.014);
    this.tone(880, 0.16, 0.012, 0.09);
  }

  error() {
    if (!this.enabled) return;
    this.stop(false);
    this.tone(150, 0.18, 0.012);
  }

  stop(fade = true) {
    if (this.bed && this.context) {
      const now = this.context.currentTime;
      this.bed.gain.gain.cancelScheduledValues(now);
      this.bed.gain.gain.setValueAtTime(Math.max(0.0001, this.bed.gain.gain.value), now);
      this.bed.gain.gain.exponentialRampToValueAtTime(0.0001, now + (fade ? 0.15 : 0.01));
      this.bed.oscillator.stop(now + (fade ? 0.16 : 0.02));
    }
    this.bed = null;
  }

  unmount() {
    this.stop(false);
    if (this.context && typeof this.context.close === "function") void this.context.close();
    this.context = null;
  }
}

const chatSound = new SoundController();

class SoundTokenBatch {
  constructor(text) {
    this.text = text;
  }
}

module.exports = { SOUND_DEFAULT_ON, chatSound, SoundController, SoundTokenBatch };
