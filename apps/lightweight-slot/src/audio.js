/**
 * audio.js — Lightweight Web Audio cues (no external files).
 * Spin / stop / win / click — gated until first user gesture.
 */

export class Sfx {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.enabled = true;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * @param {number} freq
   * @param {number} dur
   * @param {OscillatorType} [type]
   * @param {number} [gain]
   */
  tone(freq, dur, type = 'square', gain = 0.04) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  click() {
    this.unlock();
    this.tone(880, 0.04, 'triangle', 0.03);
  }

  spinStart() {
    this.unlock();
    this.tone(180, 0.08, 'sawtooth', 0.035);
    this.tone(260, 0.12, 'square', 0.025);
  }

  reelStop(index = 0) {
    this.unlock();
    this.tone(420 + index * 40, 0.05, 'triangle', 0.04);
  }

  win(big = false) {
    this.unlock();
    const base = big ? 520 : 660;
    this.tone(base, 0.1, 'square', 0.045);
    this.tone(base * 1.25, 0.14, 'triangle', 0.035);
    if (big) this.tone(base * 1.5, 0.2, 'sawtooth', 0.03);
  }

  bonus() {
    this.unlock();
    this.tone(300, 0.1, 'sawtooth', 0.04);
    this.tone(450, 0.12, 'square', 0.04);
    this.tone(600, 0.16, 'triangle', 0.04);
  }
}

export const sfx = new Sfx();
export default sfx;
