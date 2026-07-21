/**
 * reels.js — Reel grid controller (5 reels × 3 rows)
 *
 * Architecture goals for low-end Android:
 *  - Symbol sprites come from a small object pool (no per-frame `new`).
 *  - One Graphics/texture atlas path so Pixi can batch draw calls.
 *  - Frame-rate independent motion via ticker `deltaMS`.
 *  - No filters / custom shaders on the reel stage.
 */

import { REEL_COUNT, ROW_COUNT, SYMBOL_IDS } from './math.js';

/** Design-space cell metrics (logical px before stage scale). */
export const SYMBOL_W = 140;
export const SYMBOL_H = 140;
export const REEL_GAP = 8;
export const ROW_GAP = 6;

/** Extra off-screen symbols above the visible window for spin padding. */
const SPIN_BUFFER = 1;

/** Placeholder colour map — swap for Texture.from(atlasFrame) when assets land. */
const SYMBOL_COLORS = Object.freeze({
  H1: 0xe74c3c,
  H2: 0xe67e22,
  H3: 0xf1c40f,
  L1: 0x2ecc71,
  L2: 0x1abc9c,
  L3: 0x3498db,
  L4: 0x9b59b6,
  WILD: 0xecf0f1,
  SCATTER: 0xff6b9d,
});

/**
 * Tiny symbol view — Graphics rect + label. Designed for pooling:
 * call `configure()` to recycle; never destroy during play.
 */
class SymbolView {
  /**
   * @param {typeof PIXI} PIXI
   */
  constructor(PIXI) {
    this.container = new PIXI.Container();
    this.container.eventMode = 'none';
    this.container.sortableChildren = false;

    this.bg = new PIXI.Graphics();
    this.label = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 28,
        fontWeight: '700',
        fill: 0x0b1220,
        align: 'center',
      },
    });
    this.label.anchor.set(0.5);
    this.label.eventMode = 'none';

    this.container.addChild(this.bg, this.label);

    /** @type {import('./math.js').SymbolId|null} */
    this.symbolId = null;
    this._w = SYMBOL_W;
    this._h = SYMBOL_H;
  }

  /**
   * Recycle this view for a new symbol id / size.
   * @param {import('./math.js').SymbolId} id
   * @param {number} [w]
   * @param {number} [h]
   */
  configure(id, w = SYMBOL_W, h = SYMBOL_H) {
    this.symbolId = id;
    this._w = w;
    this._h = h;

    const color = SYMBOL_COLORS[id] ?? 0x555555;
    const g = this.bg;
    g.clear();
    g.roundRect(-w * 0.5, -h * 0.5, w, h, 10);
    g.fill({ color, alpha: 1 });
    g.stroke({ width: 2, color: 0x000000, alpha: 0.25 });

    this.label.text = id;
    this.label.position.set(0, 0);
    this.container.visible = true;
  }

  /** Return to pool — hide, keep in memory. */
  release() {
    this.container.visible = false;
    this.symbolId = null;
  }
}

/**
 * Simple object pool for SymbolView instances.
 * Acquire / release only — never construct inside the ticker.
 */
class SymbolPool {
  /**
   * @param {typeof PIXI} PIXI
   * @param {number} [prewarm]
   */
  constructor(PIXI, prewarm = REEL_COUNT * (ROW_COUNT + SPIN_BUFFER + 2)) {
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
 * Single vertical reel strip.
 */
class Reel {
  /**
   * @param {object} opts
   * @param {typeof PIXI} opts.PIXI
   * @param {number} opts.index
   * @param {SymbolPool} opts.pool
   * @param {import('./math.js').SymbolId[]} opts.initialSymbols  length === ROW_COUNT
   */
  constructor({ PIXI, index, pool, initialSymbols }) {
    this.index = index;
    this.pool = pool;
    this.container = new PIXI.Container();
    this.container.eventMode = 'none';

    /** @type {SymbolView[]} visible + buffer strip (top → bottom) */
    this.symbols = [];

    /** Scroll offset in px within one symbol step (0 … step). */
    this.offsetY = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.spinning = false;
    this.stopping = false;
    /** @type {import('./math.js').SymbolId[]|null} */
    this.stopSymbols = null;
    this._stopTimer = 0;

    this.step = SYMBOL_H + ROW_GAP;
    this.stripLen = ROW_COUNT + SPIN_BUFFER;

    this._buildStrip(initialSymbols);
    this._layout();
  }

  /**
   * @param {import('./math.js').SymbolId[]} visible
   */
  _buildStrip(visible) {
    // Release any existing pooled views
    for (const s of this.symbols) {
      this.container.removeChild(s.container);
      this.pool.release(s);
    }
    this.symbols.length = 0;

    // One buffer symbol above the window, then the 3 visible rows
    const ids = [
      SYMBOL_IDS[(Math.random() * SYMBOL_IDS.length) | 0],
      ...visible,
    ];

    for (let i = 0; i < ids.length; i++) {
      const view = this.pool.acquire();
      view.configure(/** @type {import('./math.js').SymbolId} */ (ids[i]));
      this.container.addChild(view.container);
      this.symbols.push(view);
    }
  }

  _layout() {
    // Index 0 sits just above the visible top (row 0).
    for (let i = 0; i < this.symbols.length; i++) {
      const y = (i - SPIN_BUFFER) * this.step + this.offsetY + SYMBOL_H * 0.5;
      this.symbols[i].container.position.set(SYMBOL_W * 0.5, y);
    }
  }

  /**
   * Begin spinning this reel.
   * @param {number} speedPxPerSec
   */
  startSpin(speedPxPerSec = 2200) {
    this.spinning = true;
    this.stopping = false;
    this.stopSymbols = null;
    this._stopTimer = 0;
    this.targetSpeed = speedPxPerSec;
  }

  /**
   * Request stop on a specific 3-symbol result (after optional delay).
   * @param {import('./math.js').SymbolId[]} result  length === ROW_COUNT
   * @param {number} [delayMs]
   */
  requestStop(result, delayMs = 0) {
    this.stopping = true;
    this.stopSymbols = result;
    this._stopTimer = delayMs;
  }

  /**
   * Advance reel by delta time (ms). Called from the shared ticker.
   * @param {number} deltaMS
   */
  update(deltaMS) {
    if (!this.spinning) return;

    // Ease toward target speed (no allocations)
    const accel = 8;
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, (accel * deltaMS) / 1000);

    // Move strip downward
    this.offsetY += (this.speed * deltaMS) / 1000;

    // Recycle symbols that scroll past the bottom back to the top
    while (this.offsetY >= this.step) {
      this.offsetY -= this.step;
      this._recycleTop();
    }

    if (this.stopping) {
      this._stopTimer -= deltaMS;
      if (this._stopTimer <= 0) {
        this._finishStop();
      }
    }

    this._layout();
  }

  /** Move the bottom-most symbol to the top with a fresh random id (spin blur). */
  _recycleTop() {
    const bottom = this.symbols.pop();
    if (!bottom) return;

    const nextId = /** @type {import('./math.js').SymbolId} */ (
      SYMBOL_IDS[(Math.random() * SYMBOL_IDS.length) | 0]
    );
    bottom.configure(nextId);
    this.symbols.unshift(bottom);
    // Re-parent order not required for Graphics batching, but keep array order correct.
  }

  /** Snap to stopSymbols and halt. */
  _finishStop() {
    if (this.stopSymbols) {
      // Rebuild visible rows from result; keep one buffer above
      const bufferId = /** @type {import('./math.js').SymbolId} */ (
        SYMBOL_IDS[(Math.random() * SYMBOL_IDS.length) | 0]
      );
      const ids = [bufferId, ...this.stopSymbols];
      for (let i = 0; i < this.symbols.length; i++) {
        this.symbols[i].configure(ids[i]);
      }
    }

    this.offsetY = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.spinning = false;
    this.stopping = false;
    this.stopSymbols = null;
    this._layout();
  }

  /** Force-set visible symbols without animation. */
  setVisibleSymbols(ids) {
    this._buildStrip(ids);
    this.offsetY = 0;
    this.spinning = false;
    this._layout();
  }
}

/**
 * ReelGridController — owns the 5×3 board, mask, and spin orchestration.
 */
export class ReelGridController {
  /**
   * @param {object} opts
   * @param {typeof PIXI} opts.PIXI
   * @param {PIXI.Container} opts.parent
   * @param {import('./math.js').SymbolId[][]} [opts.initialGrid]  column-major 5×3
   */
  constructor({ PIXI, parent, initialGrid }) {
    this.PIXI = PIXI;
    this.pool = new SymbolPool(PIXI);

    this.root = new PIXI.Container();
    this.root.eventMode = 'none';
    this.root.label = 'ReelGrid';

    this.board = new PIXI.Container();
    this.board.eventMode = 'none';

    /** Frame / background behind symbols (single Graphics = 1 draw-friendly shape). */
    this.frame = new PIXI.Graphics();
    this._drawFrame();

    /** Clip to the 3-row visible window */
    this.maskGfx = new PIXI.Graphics();
    this._drawMask();
    this.board.mask = this.maskGfx;

    this.root.addChild(this.frame, this.board, this.maskGfx);
    parent.addChild(this.root);

    const grid =
      initialGrid ??
      Array.from({ length: REEL_COUNT }, () =>
        Array.from(
          { length: ROW_COUNT },
          () => SYMBOL_IDS[(Math.random() * (SYMBOL_IDS.length - 2)) | 0],
        ),
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
    this._onSpinComplete = null;
  }

  _drawFrame() {
    const pad = 12;
    const w = REEL_COUNT * SYMBOL_W + (REEL_COUNT - 1) * REEL_GAP;
    const h = ROW_COUNT * SYMBOL_H + (ROW_COUNT - 1) * ROW_GAP;
    const g = this.frame;
    g.clear();
    g.roundRect(-pad, -pad, w + pad * 2, h + pad * 2, 16);
    g.fill({ color: 0x152033, alpha: 1 });
    g.stroke({ width: 3, color: 0x5b9dff, alpha: 0.55 });
  }

  _drawMask() {
    const w = REEL_COUNT * SYMBOL_W + (REEL_COUNT - 1) * REEL_GAP;
    const h = ROW_COUNT * SYMBOL_H + (ROW_COUNT - 1) * ROW_GAP;
    const g = this.maskGfx;
    g.clear();
    g.rect(0, 0, w, h);
    g.fill({ color: 0xffffff });
  }

  /**
   * Center the grid inside a design-space stage of given size.
   * @param {number} stageW
   * @param {number} stageH
   */
  centerIn(stageW, stageH) {
    this.root.position.set(
      Math.round((stageW - this.width) * 0.5),
      Math.round((stageH - this.height) * 0.5),
    );
  }

  /**
   * Spin all reels, then stop staggered onto `grid`.
   * @param {import('./math.js').SymbolId[][]} grid  column-major 5×3
   * @param {{ reelDelayMs?: number, baseSpinMs?: number, onComplete?: () => void }} [opts]
   */
  spinTo(grid, opts = {}) {
    const reelDelayMs = opts.reelDelayMs ?? 120;
    const baseSpinMs = opts.baseSpinMs ?? 600;
    this._onSpinComplete = opts.onComplete ?? null;

    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i];
      reel.startSpin(2000 + i * 80);
      reel.requestStop(grid[i], baseSpinMs + i * reelDelayMs);
    }
  }

  /** @returns {boolean} */
  get isSpinning() {
    for (let i = 0; i < this.reels.length; i++) {
      if (this.reels[i].spinning) return true;
    }
    return false;
  }

  /**
   * Ticker hook — deltaMS keeps motion frame-rate independent.
   * @param {number} deltaMS
   */
  update(deltaMS) {
    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].update(deltaMS);
    }

    // Fire once when the last reel settles — no allocations in the hot path.
    if (this._onSpinComplete && !this.isSpinning) {
      const cb = this._onSpinComplete;
      this._onSpinComplete = null;
      cb();
    }
  }

  /**
   * Replace the board instantly (e.g. after a restored session).
   * @param {import('./math.js').SymbolId[][]} grid
   */
  setGrid(grid) {
    for (let i = 0; i < this.reels.length; i++) {
      this.reels[i].setVisibleSymbols(grid[i]);
    }
  }
}

export default ReelGridController;
