/**
 * reels.js — Core Reel Engine (5 × 3)
 *
 * - Pixi Containers + Sprites (texture-swapped from AssetManager pool)
 * - spin()  → start all reels with stagger delays (reel 1 → 5)
 * - stop(symbolGrid) → land cleanly on target symbols with ease-out + bounce
 * - Motion blur via vertical scale (no GPU filters — mobile safe)
 * - SymbolView object pool — zero construction during the ticker
 */

import { assets } from './assets.js';
import { REEL_COUNT, ROW_COUNT } from './math.js';

/** Display cell size — source PNGs are 96×96, scaled once at setSymbol. */
export const SYMBOL_W = 140;
export const SYMBOL_H = 140;
export const REEL_GAP = 8;
export const ROW_GAP = 6;

/** Off-screen pad above the visible window. */
const SPIN_BUFFER = 1;
/** Extra strip length below for smoother recycle during fast spins. */
const STRIP_EXTRA = 1;

const PHASE_IDLE = 0;
const PHASE_START_WAIT = 1;
const PHASE_SPIN = 2;
const PHASE_STOP_WAIT = 3;
const PHASE_LAND = 4;

/** Peak spin speed (px / sec). */
const SPIN_SPEED = 2600;
/** Max vertical stretch used as cheap motion blur. */
const BLUR_SCALE_Y = 1.55;
/** Land ease duration (ms). */
const LAND_MS = 280;
/** Overshoot bounce (px) then settle. */
const BOUNCE_PX = 18;

/**
 * Pooled symbol view — one Container + one Sprite.
 * Recycle with `setSymbol()`; never destroy during play.
 */
class SymbolView {
  /**
   * @param {typeof PIXI} PIXI
   */
  constructor(PIXI) {
    this.container = new PIXI.Container();
    this.container.eventMode = 'none';
    this.container.sortableChildren = false;

    this.sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    this.sprite.anchor.set(0.5);
    this.sprite.eventMode = 'none';
    this.container.addChild(this.sprite);

    /** @type {string|null} */
    this.symbolId = null;
    this._baseScaleY = 1;
  }

  /**
   * @param {string} id
   * @param {number} [w]
   * @param {number} [h]
   */
  setSymbol(id, w = SYMBOL_W, h = SYMBOL_H) {
    this.symbolId = id;
    const tex = assets.getTexture(id);
    this.sprite.texture = tex;
    // Fit into cell while preserving texture aspect (placeholders are square).
    this.sprite.width = w;
    this.sprite.height = h;
    this._baseScaleY = this.sprite.scale.y;
    this.container.visible = true;
    this.setHighlight(false);
  }

  /**
   * Dim / brighten for win presentation (tint only — no extra draw calls).
   * @param {boolean} on
   * @param {boolean} [winner]
   */
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
      this.sprite.tint = 0x667788;
      this.sprite.alpha = 0.45;
    }
  }

  /**
   * Apply / clear motion-blur stretch. `amount` in 0..1.
   * Mutates scale only — no allocations.
   * @param {number} amount
   */
  setBlur(amount) {
    const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    // Preserve width scale; stretch height for directional blur feel.
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
    this.symbolId = null;
  }
}

/** Pre-warmed pool of SymbolView instances. */
class SymbolPool {
  /**
   * @param {typeof PIXI} PIXI
   * @param {number} [prewarm]
   */
  constructor(PIXI, prewarm = REEL_COUNT * (ROW_COUNT + SPIN_BUFFER + STRIP_EXTRA + 2)) {
    this._PIXI = PIXI;
    /** @type {SymbolView[]} */
    this._free = [];
    for (let i = 0; i < prewarm; i++) {
      this._free.push(new SymbolView(PIXI));
    }
  }

  /** @returns {SymbolView} */
  acquire() {
    return this._free.pop() ?? new SymbolView(this._PIXI);
  }

  /** @param {SymbolView} view */
  release(view) {
    view.release();
    this._free.push(view);
  }
}

/**
 * Ease-out cubic. `t` in 0..1.
 * @param {number} t
 */
function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Single vertical reel strip.
 */
class Reel {
  /**
   * @param {object} opts
   * @param {typeof PIXI} opts.PIXI
   * @param {number} opts.index
   * @param {SymbolPool} opts.pool
   * @param {string[]} opts.initialSymbols
   */
  constructor({ PIXI, index, pool, initialSymbols }) {
    this.index = index;
    this.pool = pool;
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
    this._landElapsed = 0;
    this._landFrom = 0;
    this._blur = 0;
    this._stopArmed = false;
    this._pendingStopAfterStart = false;

    this._buildStrip(initialSymbols);
    this._layout();
  }

  /** @returns {boolean} */
  get isBusy() {
    return this.phase !== PHASE_IDLE;
  }

  /**
   * @param {string[]} visible  length === ROW_COUNT
   */
  _buildStrip(visible) {
    for (let i = 0; i < this.symbols.length; i++) {
      this.container.removeChild(this.symbols[i].container);
      this.pool.release(this.symbols[i]);
    }
    this.symbols.length = 0;

    const stripCount = ROW_COUNT + SPIN_BUFFER + STRIP_EXTRA;
    for (let i = 0; i < stripCount; i++) {
      const view = this.pool.acquire();
      let id;
      if (i === 0) {
        id = assets.randomId(); // buffer above
      } else if (i <= ROW_COUNT) {
        id = visible[i - 1];
      } else {
        id = assets.randomId(); // below pad
      }
      view.setSymbol(id);
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
    for (let i = 0; i < this.symbols.length; i++) {
      this.symbols[i].setBlur(this._blur);
    }
  }

  _clearBlurOnStrip() {
    this._blur = 0;
    for (let i = 0; i < this.symbols.length; i++) {
      this.symbols[i].clearBlur();
    }
  }

  /**
   * Begin spinning after an optional stagger delay.
   * @param {number} [delayMs]
   * @param {number} [speedPxPerSec]
   */
  spin(delayMs = 0, speedPxPerSec = SPIN_SPEED) {
    this._stopSymbols = null;
    this._stopArmed = false;
    this._stopWait = 0;
    this._landElapsed = 0;
    this.targetSpeed = speedPxPerSec;
    this._startWait = delayMs;
    this.phase = delayMs > 0 ? PHASE_START_WAIT : PHASE_SPIN;
    if (this.phase === PHASE_SPIN) {
      // Kick a little so blur appears immediately
      this.speed = speedPxPerSec * 0.35;
    }
  }

  /**
   * Request a clean stop onto `result` (3 visible rows) after delay.
   * @param {string[]} result
   * @param {number} [delayMs]
   */
  stop(result, delayMs = 0) {
    this._stopSymbols = result;
    this._stopWait = delayMs;
    this._stopArmed = true;

    if (this.phase === PHASE_IDLE) {
      // stop() without prior spin — snap symbols immediately
      this.setVisibleSymbols(result);
      return;
    }

    if (this.phase === PHASE_START_WAIT) {
      // Still staggered-in: begin stop countdown once motion starts
      this._pendingStopAfterStart = true;
      return;
    }

    // Already spinning (or already stop-waiting) — count down to land
    this.phase = PHASE_STOP_WAIT;
  }

  /**
   * @param {number} deltaMS
   */
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
      // Ease speed toward target (accel / hold)
      const lerp = Math.min(1, (10 * deltaMS) / 1000);
      this.speed += (this.targetSpeed - this.speed) * lerp;

      this.offsetY += (this.speed * deltaMS) / 1000;

      while (this.offsetY >= this.step) {
        this.offsetY -= this.step;
        this._recycleTop();
      }

      // Blur amount from normalised speed
      this._blur = Math.min(1, this.speed / SPIN_SPEED);
      this._applyBlurToStrip();

      if (this.phase === PHASE_STOP_WAIT) {
        this._stopWait -= deltaMS;
        if (this._stopWait <= 0) {
          this._beginLand();
        }
      }
      this._layout();
      return;
    }

    if (this.phase === PHASE_LAND) {
      this._landElapsed += deltaMS;
      const t = Math.min(1, this._landElapsed / LAND_MS);
      const settle = easeOutCubic(t);
      // Soft bounce that decays as we settle on the target row
      const bounce = BOUNCE_PX * Math.sin(settle * Math.PI) * (1 - settle);
      this.offsetY = this._landFrom * (1 - settle) + bounce;

      // Fade blur out during land
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
        this._layout();
      }
    }
  }

  /** Inject stop symbols into the strip and enter landing phase. */
  _beginLand() {
    const targets = this._stopSymbols;
    if (targets && targets.length >= ROW_COUNT) {
      // symbols[0] = buffer above, [1..3] = visible rows
      this.symbols[0].setSymbol(assets.randomId());
      for (let row = 0; row < ROW_COUNT; row++) {
        this.symbols[row + SPIN_BUFFER].setSymbol(targets[row]);
      }
      for (let i = ROW_COUNT + SPIN_BUFFER; i < this.symbols.length; i++) {
        this.symbols[i].setSymbol(assets.randomId());
      }
    }

    // Start land from a partial step so ease-out travels a short distance
    this._landFrom = this.offsetY > 0 ? this.offsetY : this.step * 0.85;
    this.offsetY = this._landFrom;
    this._landElapsed = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.phase = PHASE_LAND;
  }

  /** Recycle bottom symbol to top with a fresh random texture (pooled). */
  _recycleTop() {
    const bottom = this.symbols.pop();
    if (!bottom) return;
    bottom.setSymbol(assets.randomId());
    this.symbols.unshift(bottom);
  }

  /** @param {string[]} ids */
  setVisibleSymbols(ids) {
    this._buildStrip(ids);
    this.offsetY = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.phase = PHASE_IDLE;
    this._clearBlurOnStrip();
    this._layout();
  }

  /**
   * Access the visible SymbolView at board row (0..ROW_COUNT-1).
   * @param {number} row
   * @returns {SymbolView|null}
   */
  getVisibleSymbol(row) {
    const idx = row + SPIN_BUFFER;
    return this.symbols[idx] ?? null;
  }
}

/**
 * ReelGridController — 5×3 board with spin / stop orchestration.
 */
export class ReelGridController {
  /**
   * @param {object} opts
   * @param {typeof PIXI} opts.PIXI
   * @param {PIXI.Container} opts.parent
   * @param {string[][]} [opts.initialGrid]  column-major 5×3
   * @param {number} [opts.spinStaggerMs]  delay between reel starts
   * @param {number} [opts.stopStaggerMs]  delay between reel stops
   */
  constructor({ PIXI, parent, initialGrid, spinStaggerMs = 100, stopStaggerMs = 140 }) {
    this.PIXI = PIXI;
    this.spinStaggerMs = spinStaggerMs;
    this.stopStaggerMs = stopStaggerMs;
    this.pool = new SymbolPool(PIXI);

    this.root = new PIXI.Container();
    this.root.eventMode = 'none';
    this.root.label = 'ReelGrid';

    this.board = new PIXI.Container();
    this.board.eventMode = 'none';
    this.board.label = 'Board';

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
          // Prefer lows for the idle board
          const lows = /** @type {const} */ (['L1', 'L2', 'L3', 'L4', 'H1', 'H2']);
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
      });
      reel.container.x = i * (SYMBOL_W + REEL_GAP);
      this.board.addChild(reel.container);
      this.reels.push(reel);
    }

    this.width = REEL_COUNT * SYMBOL_W + (REEL_COUNT - 1) * REEL_GAP;
    this.height = ROW_COUNT * SYMBOL_H + (ROW_COUNT - 1) * ROW_GAP;

    /** @type {null | (() => void)} */
    this._onComplete = null;
    this._awaitingComplete = false;
  }

  _drawFrame() {
    const pad = 12;
    const w = this._boardW();
    const h = this._boardH();
    const g = this.frame;
    g.clear();
    // Dark chassis plate
    g.roundRect(-pad, -pad, w + pad * 2, h + pad * 2, 10);
    g.fill({ color: 0x0c1826, alpha: 1 });
    // Neon cyan outer rail
    g.roundRect(-pad, -pad, w + pad * 2, h + pad * 2, 10);
    g.stroke({ width: 3, color: 0x00d4ff, alpha: 0.7 });
    // Inner accent rail
    g.roundRect(-pad + 5, -pad + 5, w + pad * 2 - 10, h + pad * 2 - 10, 7);
    g.stroke({ width: 1, color: 0x7ee8ff, alpha: 0.35 });
    // Corner bolts (cheap robotic detail, no extra sprites)
    const bolt = 0x3a5a70;
    const r = 3;
    g.circle(-pad + 10, -pad + 10, r);
    g.fill({ color: bolt });
    g.circle(w + pad - 10, -pad + 10, r);
    g.fill({ color: bolt });
    g.circle(-pad + 10, h + pad - 10, r);
    g.fill({ color: bolt });
    g.circle(w + pad - 10, h + pad - 10, r);
    g.fill({ color: bolt });
  }

  _drawMask() {
    const g = this.maskGfx;
    g.clear();
    g.rect(0, 0, this._boardW(), this._boardH());
    g.fill({ color: 0xffffff });
  }

  _boardW() {
    return REEL_COUNT * SYMBOL_W + (REEL_COUNT - 1) * REEL_GAP;
  }

  _boardH() {
    return ROW_COUNT * SYMBOL_H + (ROW_COUNT - 1) * ROW_GAP;
  }

  /**
   * @param {number} stageW
   * @param {number} stageH
   */
  centerIn(stageW, stageH) {
    this.root.position.set(
      Math.round((stageW - this.width) * 0.5),
      Math.round((stageH - this.height) * 0.5),
    );
  }

  /** @returns {boolean} */
  get isSpinning() {
    for (let i = 0; i < this.reels.length; i++) {
      if (this.reels[i].isBusy) return true;
    }
    return false;
  }

  /**
   * Start spinning all reels with stagger (reel 1 → 5).
   * @param {{ staggerMs?: number, speed?: number, onComplete?: () => void }} [opts]
   */
  spin(opts = {}) {
    const stagger = opts.staggerMs ?? this.spinStaggerMs;
    if (opts.onComplete) {
      this._onComplete = opts.onComplete;
      this._awaitingComplete = true;
    }

    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].spin(i * stagger, opts.speed ?? SPIN_SPEED + i * 60);
    }
  }

  /**
   * Stop reels onto a specific 5×3 symbol grid (column-major).
   * Staggers stop delays so reel 1 lands first, reel 5 last.
   * @param {string[][]} symbolGrid
   * @param {{ staggerMs?: number, baseDelayMs?: number, onComplete?: () => void }} [opts]
   */
  stop(symbolGrid, opts = {}) {
    const stagger = opts.staggerMs ?? this.stopStaggerMs;
    const baseDelay = opts.baseDelayMs ?? 450;

    if (opts.onComplete) {
      this._onComplete = opts.onComplete;
      this._awaitingComplete = true;
    } else if (!this._awaitingComplete) {
      this._awaitingComplete = true;
    }

    for (let i = 0; i < this.reels.length; i++) {
      const col = symbolGrid[i];
      if (!col || col.length < ROW_COUNT) {
        console.warn('[reels] stop: invalid column', i, col);
        continue;
      }
      this.reels[i].stop(col, baseDelay + i * stagger);
    }
  }

  /**
   * Convenience: spin then stop on `grid` in one call.
   * @param {string[][]} grid
   * @param {{ onComplete?: () => void, spinStaggerMs?: number, stopStaggerMs?: number, baseDelayMs?: number }} [opts]
   */
  spinTo(grid, opts = {}) {
    this.spin({
      staggerMs: opts.spinStaggerMs ?? this.spinStaggerMs,
      onComplete: opts.onComplete,
    });
    this.stop(grid, {
      staggerMs: opts.stopStaggerMs ?? this.stopStaggerMs,
      baseDelayMs: opts.baseDelayMs ?? 500,
    });
  }

  /**
   * @param {number} deltaMS
   */
  update(deltaMS) {
    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].update(deltaMS);
    }

    if (this._awaitingComplete && this._onComplete && !this.isSpinning) {
      const cb = this._onComplete;
      this._onComplete = null;
      this._awaitingComplete = false;
      cb();
    }
  }

  /**
   * @param {string[][]} grid
   */
  setGrid(grid) {
    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].setVisibleSymbols(grid[i]);
    }
  }

  /** Clear all win dimming / highlights. */
  clearHighlights() {
    for (let r = 0; r < this.reels.length; r++) {
      for (let row = 0; row < ROW_COUNT; row++) {
        const view = this.reels[r].getVisibleSymbol(row);
        if (view) view.setHighlight(false);
      }
    }
  }

  /**
   * Highlight winning cells from math `winningLines` positions.
   * Non-winning symbols are dimmed for contrast.
   * @param {Array<{ positions: Array<{ reel: number, row: number }> }>} winningLines
   */
  highlightWins(winningLines) {
    /** @type {boolean[][]} */
    const marked = Array.from({ length: REEL_COUNT }, () =>
      Array.from({ length: ROW_COUNT }, () => false),
    );

    let any = false;
    if (winningLines) {
      for (let i = 0; i < winningLines.length; i++) {
        const positions = winningLines[i].positions;
        if (!positions) continue;
        for (let p = 0; p < positions.length; p++) {
          const { reel, row } = positions[p];
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
        if (!any) {
          view.setHighlight(false);
        } else {
          view.setHighlight(true, marked[r][row]);
        }
      }
    }
  }
}

export default ReelGridController;
