/**
 * Synthesised sound effects for the TV (no audio files). Browsers only allow
 * sound after a click or key press, so the host calls unlock() on the first one.
 * The on/off choice is remembered per browser.
 */
const KEY = 'partypack.sound';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean;

  constructor() {
    let on = true;
    try {
      on = localStorage.getItem(KEY) !== 'off';
    } catch {
      /* storage blocked */
    }
    this.enabled = on;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, vol = 0.3, type: OscillatorType = 'sine', delay = 0, slideTo?: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Someone joined. */
  join(): void {
    this.tone(660, 0.12, 0.25, 'square');
    this.tone(990, 0.16, 0.2, 'square', 0.08);
  }
  /** Someone locked in an answer. */
  lock(): void {
    this.tone(520, 0.08, 0.2, 'triangle');
  }
  /** Last seconds of a countdown. */
  tick(): void {
    this.tone(1200, 0.05, 0.15, 'square');
  }
  /** Time's up. */
  buzzer(): void {
    this.tone(180, 0.35, 0.3, 'sawtooth', 0, 120);
  }
  /** Big reveal sting. */
  reveal(): void {
    this.tone(392, 0.12, 0.25, 'triangle');
    this.tone(523, 0.12, 0.25, 'triangle', 0.1);
    this.tone(784, 0.3, 0.3, 'triangle', 0.2);
  }
  good(): void {
    this.tone(880, 0.1, 0.22, 'sine');
    this.tone(1320, 0.18, 0.22, 'sine', 0.08);
  }
  bad(): void {
    this.tone(300, 0.15, 0.25, 'square', 0, 200);
  }
  /** A new game or round starts. */
  whoosh(): void {
    this.tone(200, 0.35, 0.18, 'sawtooth', 0, 900);
  }
  fanfare(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 3 ? 0.6 : 0.16, 0.25, 'triangle', i * 0.14));
  }
}
