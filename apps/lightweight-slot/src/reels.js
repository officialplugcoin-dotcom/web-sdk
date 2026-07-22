/**
 * reels.js — Robo 5000 Core Reel Engine (5 × 5)
 *
 * Pooled sprites, staggered spin/stop, motion-blur stretch (no GPU filters),
 * win highlights, and optional wild-multiplier badges.
 */

import { assets } from './assets.js';
import { REEL_COUNT, ROW_COUNT } from './math.js';

export const SYMBOL_W = 108;
export const SYMBOL_H = 108;
export const REEL_GAP = 6;
export const ROW_GAP = 5;

const SPIN_BUFFER = 1;
const STRIP_EXTRA = 1;

const PHASE_IDLE = 0;
const PHASE_START_WAIT = 1;
const PHASE_SPIN = 2;
const PHASE_STOP_WAIT = 3;
const PHASE_LAND = 4;

const SPIN_SPEED = 2800;
const BLUR_SCALE_Y = 1.5;
const LAND_MS = 260;
const BOUNCE_PX = 14;

class SymbolView {
  /** @param {typeof PIXI} PIXI */
  constructor(PIXI) {
    this.PIXI = PIXI;
    this.container = new PIXI.Container();
    this.container.eventMode = 'none';

    this.sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    this.sprite.anchor.set(0.5);
    this.sprite.eventMode = 'none';
    this.container.addChild(this.sprite);

    this.multText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'Orbitron, system-ui, sans-serif',
        fontSize: 18,
        fontWeight: '800',
        fill: 0xffe566,
        stroke: { color: 0x050b14, width: 3 },
      },
    });
    this.multText.anchor.set(0.5);
    this.multText.eventMode = 'none';
    this.multText.visible = false;
    this.container.addChild(this.multText);

    /** @type {string|null} */
    this.symbolId = null;
    this.multiplier = 1;
    this._baseScaleY = 1;
  }

  /**
   * @param {string} id
   * @param {number} [mult]
   * @param {number} [w]
   * @param {number} [h]
   */
  setSymbol(id, mult = 1, w = SYMBOL_W, h = SYMBOL_H) {
    this.symbolId = id;
    this.multiplier = mult;
    this.sprite.texture = assets.getTexture(id);
    this.sprite.width = w;
    this.sprite.height = h;
    this._baseScaleY = this.sprite.scale.y;
    this.container.visible = true;
    this.setHighlight(false);

    if (id === 'WILD' && mult > 1) {
      this.multText.text = `${mult}×`;
      this.multText.visible = true;
      this.multText.position.set(0, SYMBOL_H * 0.32);
    } else {
      this.multText.visible = false;
    }
  }

  /** @param {boolean} on @param {boolean} [winner] */
  setHighlight(on, winner = false) {
    if (!on) {
      this.sprite.tint = 0xffffff;
      this.sprite.alpha = 1;
      return;
    }
    if (winner) {
      this.sprite.tint = 0xffffff;
      this.sprite.alpha = 1;
    } else {
      this.sprite.tint = 0x556677;
      this.sprite.alpha = 0.4;
    }
  }

  /** @param {number} amount */
  setBlur(amount) {
    const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    const sx = this.sprite.scale.x;
    const base = this._baseScaleY || sx;
    this.sprite.scale.set(sx, base * (1 + (BLUR_SCALE_Y - 1) * a));
  }

  clearBlur() {
    const sx = this.sprite.scale.x;
    const base = this._baseScaleY || sx;
    this.sprite.scale.set(sx, base);
  }

  release() {
    this.clearBlur();
    this.container.visible = false;
    this.multText.visible = false;
    this.symbolId = null;
  }
}

class SymbolPool {
  /** @param {typeof PIXI} PIXI @param {number} [prewarm] */
  constructor(PIXI, prewarm = REEL_COUNT * (ROW_COUNT + SPIN_BUFFER + STRIP_EXTRA + 2)) {
    this._PIXI = PIXI;
    /** @type {SymbolView[]} */
    this._free = [];
    for (let i = 0; i < prewarm; i++) this._free.push(new SymbolView(PIXI));
  }

  acquire() {
    return this._free.pop() ?? new SymbolView(this._PIXI);
  }

  /** @param {SymbolView} view */
  release(view) {
    view.release();
    this._free.push(view);
  }
}

function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

class Reel {
  /**
   * @param {object} opts
   * @param {typeof PIXI} opts.PIXI
   * @param {number} opts.index
   * @param {SymbolPool} opts.pool
   * @param {string[]} opts.initialSymbols
   * @param {number[]} [opts.initialMults]
   * @param {(index: number) => void} [opts.onLand]
   */
  constructor({ PIXI, index, pool, initialSymbols, initialMults, onLand }) {
    this.index = index;
    this.pool = pool;
    this.onLand = onLand;
    this.container = new PIXI.Container();
    this.container.eventMode = 'none';
    this.container.label = `Reel${index}`;

    /** @type {SymbolView[]} */
    this.symbols = [];
    this.step = SYMBOL_H + ROW_GAP;
    this.offsetY = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.phase = PHASE_IDLE;
    this._startWait = 0;
    this._stopWait = 0;
    /** @type {string[]|null} */
    this._stopSymbols = null;
    /** @type {number[]|null} */
    this._stopMults = null;
    this._landElapsed = 0;
    this._landFrom = 0;
    this._blur = 0;
    this._stopArmed = false;
    this._pendingStopAfterStart = false;

    this._buildStrip(initialSymbols, initialMults);
    this._layout();
  }

  get isBusy() {
    return this.phase !== PHASE_IDLE;
  }

  /**
   * @param {string[]} visible
   * @param {number[]} [mults]
   */
  _buildStrip(visible, mults) {
    for (let i = 0; i < this.symbols.length; i++) {
      this.container.removeChild(this.symbols[i].container);
      this.pool.release(this.symbols[i]);
    }
    this.symbols.length = 0;

    const stripCount = ROW_COUNT + SPIN_BUFFER + STRIP_EXTRA;
    for (let i = 0; i < stripCount; i++) {
      const view = this.pool.acquire();
      let id;
      let mult = 1;
      if (i === 0) {
        id = assets.randomId();
      } else if (i <= ROW_COUNT) {
        id = visible[i - 1];
        mult = mults?.[i - 1] ?? 1;
      } else {
        id = assets.randomId();
      }
      view.setSymbol(id, mult);
      this.container.addChild(view.container);
      this.symbols.push(view);
    }
  }

  _layout() {
    for (let i = 0; i < this.symbols.length; i++) {
      const y = (i - SPIN_BUFFER) * this.step + this.offsetY + SYMBOL_H * 0.5;
      this.symbols[i].container.position.set(SYMBOL_W * 0.5, y);
    }
  }

  _applyBlurToStrip() {
    for (let i = 0; i < this.symbols.length; i++) this.symbols[i].setBlur(this._blur);
  }

  _clearBlurOnStrip() {
    this._blur = 0;
    for (let i = 0; i < this.symbols.length; i++) this.symbols[i].clearBlur();
  }

  /** @param {number} [delayMs] @param {number} [speedPxPerSec] */
  spin(delayMs = 0, speedPxPerSec = SPIN_SPEED) {
    this._stopSymbols = null;
    this._stopMults = null;
    this._stopArmed = false;
    this._stopWait = 0;
    this._landElapsed = 0;
    this.targetSpeed = speedPxPerSec;
    this._startWait = delayMs;
    this.phase = delayMs > 0 ? PHASE_START_WAIT : PHASE_SPIN;
    if (this.phase === PHASE_SPIN) this.speed = speedPxPerSec * 0.35;
  }

  /**
   * @param {string[]} result
   * @param {number[]} [mults]
   * @param {number} [delayMs]
   */
  stop(result, mults = [], delayMs = 0) {
    this._stopSymbols = result;
    this._stopMults = mults;
    this._stopWait = delayMs;
    this._stopArmed = true;

    if (this.phase === PHASE_IDLE) {
      this.setVisibleSymbols(result, mults);
      return;
    }
    if (this.phase === PHASE_START_WAIT) {
      this._pendingStopAfterStart = true;
      return;
    }
    this.phase = PHASE_STOP_WAIT;
  }

  /** @param {number} deltaMS */
  update(deltaMS) {
    if (this.phase === PHASE_IDLE) return;

    if (this.phase === PHASE_START_WAIT) {
      this._startWait -= deltaMS;
      if (this._startWait <= 0) {
        this.phase = this._pendingStopAfterStart || this._stopArmed ? PHASE_STOP_WAIT : PHASE_SPIN;
        this._pendingStopAfterStart = false;
        this.speed = this.targetSpeed * 0.35;
      }
      return;
    }

    if (this.phase === PHASE_SPIN || this.phase === PHASE_STOP_WAIT) {
      const lerp = Math.min(1, (10 * deltaMS) / 1000);
      this.speed += (this.targetSpeed - this.speed) * lerp;
      this.offsetY += (this.speed * deltaMS) / 1000;

      while (this.offsetY >= this.step) {
        this.offsetY -= this.step;
        this._recycleTop();
      }

      this._blur = Math.min(1, this.speed / SPIN_SPEED);
      this._applyBlurToStrip();

      if (this.phase === PHASE_STOP_WAIT) {
        this._stopWait -= deltaMS;
        if (this._stopWait <= 0) this._beginLand();
      }
      this._layout();
      return;
    }

    if (this.phase === PHASE_LAND) {
      this._landElapsed += deltaMS;
      const t = Math.min(1, this._landElapsed / LAND_MS);
      const settle = easeOutCubic(t);
      const bounce = BOUNCE_PX * Math.sin(settle * Math.PI) * (1 - settle);
      this.offsetY = this._landFrom * (1 - settle) + bounce;
      this._blur = Math.max(0, 1 - t);
      this._applyBlurToStrip();
      this._layout();

      if (t >= 1) {
        this.offsetY = 0;
        this.speed = 0;
        this.targetSpeed = 0;
        this._clearBlurOnStrip();
        this.phase = PHASE_IDLE;
        this._stopArmed = false;
        this._stopSymbols = null;
        this._stopMults = null;
        this._layout();
        this.onLand?.(this.index);
      }
    }
  }

  _beginLand() {
    const targets = this._stopSymbols;
    const mults = this._stopMults;
    if (targets && targets.length >= ROW_COUNT) {
      this.symbols[0].setSymbol(assets.randomId());
      for (let row = 0; row < ROW_COUNT; row++) {
        this.symbols[row + SPIN_BUFFER].setSymbol(targets[row], mults?.[row] ?? 1);
      }
      for (let i = ROW_COUNT + SPIN_BUFFER; i < this.symbols.length; i++) {
        this.symbols[i].setSymbol(assets.randomId());
      }
    }
    this._landFrom = this.offsetY > 0 ? this.offsetY : this.step * 0.85;
    this.offsetY = this._landFrom;
    this._landElapsed = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.phase = PHASE_LAND;
  }

  _recycleTop() {
    const bottom = this.symbols.pop();
    if (!bottom) return;
    bottom.setSymbol(assets.randomId());
    this.symbols.unshift(bottom);
  }

  /** @param {string[]} ids @param {number[]} [mults] */
  setVisibleSymbols(ids, mults) {
    this._buildStrip(ids, mults);
    this.offsetY = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.phase = PHASE_IDLE;
    this._clearBlurOnStrip();
    this._layout();
  }

  /** @param {number} row */
  getVisibleSymbol(row) {
    return this.symbols[row + SPIN_BUFFER] ?? null;
  }
}

export class ReelGridController {
  /**
   * @param {object} opts
   * @param {typeof PIXI} opts.PIXI
   * @param {PIXI.Container} opts.parent
   * @param {string[][]} [opts.initialGrid]
   * @param {(reelIndex: number) => void} [opts.onReelLand]
   */
  constructor({ PIXI, parent, initialGrid, onReelLand }) {
    this.PIXI = PIXI;
    this.spinStaggerMs = 90;
    this.stopStaggerMs = 130;
    this.pool = new SymbolPool(PIXI);
    this.onReelLand = onReelLand;

    this.root = new PIXI.Container();
    this.root.eventMode = 'none';
    this.root.label = 'ReelGrid';

    this.board = new PIXI.Container();
    this.board.eventMode = 'none';

    this.frame = new PIXI.Graphics();
    this._drawFrame();
    this.maskGfx = new PIXI.Graphics();
    this._drawMask();
    this.board.mask = this.maskGfx;

    this.root.addChild(this.frame, this.board, this.maskGfx);
    parent.addChild(this.root);

    const grid =
      initialGrid ??
      Array.from({ length: REEL_COUNT }, () =>
        Array.from({ length: ROW_COUNT }, () => {
          const lows = /** @type {const} */ (['L1', 'L2', 'L3', 'L4', 'H1']);
          return lows[(Math.random() * lows.length) | 0];
        }),
      );

    /** @type {Reel[]} */
    this.reels = [];
    for (let i = 0; i < REEL_COUNT; i++) {
      const reel = new Reel({
        PIXI,
        index: i,
        pool: this.pool,
        initialSymbols: grid[i],
        onLand: (idx) => this.onReelLand?.(idx),
      });
      reel.container.x = i * (SYMBOL_W + REEL_GAP);
      this.board.addChild(reel.container);
      this.reels.push(reel);
    }

    this.width = this._boardW();
    this.height = this._boardH();
    /** @type {null | (() => void)} */
    this._onComplete = null;
    this._awaitingComplete = false;
  }

  _boardW() {
    return REEL_COUNT * SYMBOL_W + (REEL_COUNT - 1) * REEL_GAP;
  }

  _boardH() {
    return ROW_COUNT * SYMBOL_H + (ROW_COUNT - 1) * ROW_GAP;
  }

  _drawFrame() {
    const pad = 14;
    const w = this._boardW();
    const h = this._boardH();
    const g = this.frame;
    g.clear();
    g.roundRect(-pad, -pad, w + pad * 2, h + pad * 2, 12);
    g.fill({ color: 0x0a0614 });
    g.roundRect(-pad, -pad, w + pad * 2, h + pad * 2, 12);
    g.stroke({ width: 3, color: 0xb44cff, alpha: 0.75 });
    g.roundRect(-pad + 5, -pad + 5, w + pad * 2 - 10, h + pad * 2 - 10, 8);
    g.stroke({ width: 1, color: 0xd4af37, alpha: 0.45 });
    const bolt = 0x6a4a20;
    for (const [x, y] of [
      [-pad + 11, -pad + 11],
      [w + pad - 11, -pad + 11],
      [-pad + 11, h + pad - 11],
      [w + pad - 11, h + pad - 11],
    ]) {
      g.circle(x, y, 3);
      g.fill({ color: bolt });
    }
  }

  _drawMask() {
    this.maskGfx.clear();
    this.maskGfx.rect(0, 0, this._boardW(), this._boardH());
    this.maskGfx.fill({ color: 0xffffff });
  }

  /** @param {number} stageW @param {number} stageH */
  centerIn(stageW, stageH) {
    this.root.position.set(
      Math.round((stageW - this.width) * 0.5),
      Math.round((stageH - this.height) * 0.5),
    );
  }

  get isSpinning() {
    for (let i = 0; i < this.reels.length; i++) {
      if (this.reels[i].isBusy) return true;
    }
    return false;
  }

  /** @param {{ staggerMs?: number, speed?: number, onComplete?: () => void }} [opts] */
  spin(opts = {}) {
    const stagger = opts.staggerMs ?? this.spinStaggerMs;
    if (opts.onComplete) {
      this._onComplete = opts.onComplete;
      this._awaitingComplete = true;
    }
    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].spin(i * stagger, (opts.speed ?? SPIN_SPEED) + i * 50);
    }
  }

  /**
   * @param {string[][]} symbolGrid
   * @param {number[][]} [multGrid]
   * @param {{ staggerMs?: number, baseDelayMs?: number, onComplete?: () => void }} [opts]
   */
  stop(symbolGrid, multGrid, opts = {}) {
    const stagger = opts.staggerMs ?? this.stopStaggerMs;
    const baseDelay = opts.baseDelayMs ?? 500;
    if (opts.onComplete) {
      this._onComplete = opts.onComplete;
      this._awaitingComplete = true;
    } else if (!this._awaitingComplete) {
      this._awaitingComplete = true;
    }
    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].stop(symbolGrid[i], multGrid?.[i] ?? [], baseDelay + i * stagger);
    }
  }

  /** @param {number} deltaMS */
  update(deltaMS) {
    for (let i = 0; i < this.reels.length; i++) this.reels[i].update(deltaMS);
    if (this._awaitingComplete && this._onComplete && !this.isSpinning) {
      const cb = this._onComplete;
      this._onComplete = null;
      this._awaitingComplete = false;
      cb();
    }
  }

  /** @param {string[][]} grid @param {number[][]} [mults] */
  setGrid(grid, mults) {
    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].setVisibleSymbols(grid[i], mults?.[i]);
    }
  }

  clearHighlights() {
    for (let r = 0; r < this.reels.length; r++) {
      for (let row = 0; row < ROW_COUNT; row++) {
        this.reels[r].getVisibleSymbol(row)?.setHighlight(false);
      }
    }
  }

  /** @param {Array<{ positions: Array<{ reel: number, row: number }> }>} winningLines */
  highlightWins(winningLines) {
    const marked = Array.from({ length: REEL_COUNT }, () =>
      Array.from({ length: ROW_COUNT }, () => false),
    );
    let any = false;
    if (winningLines) {
      for (const line of winningLines) {
        for (const { reel, row } of line.positions ?? []) {
          if (reel >= 0 && reel < REEL_COUNT && row >= 0 && row < ROW_COUNT) {
            marked[reel][row] = true;
            any = true;
          }
        }
      }
    }
    for (let r = 0; r < this.reels.length; r++) {
      for (let row = 0; row < ROW_COUNT; row++) {
        const view = this.reels[r].getVisibleSymbol(row);
        if (!view) continue;
        view.setHighlight(any, marked[r][row]);
      }
    }
  }
}

export default ReelGridController;
