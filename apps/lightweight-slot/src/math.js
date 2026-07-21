/**
 * math.js — Modular Math Engine (placeholder)
 *
 * Owns win evaluation, RTP-facing helpers, and outcome shaping.
 * Keep this layer pure (no Pixi / DOM) so it can run in tests or on the
 * server-side RGS without pulling in renderer code.
 *
 * Performance notes:
 *  - Avoid allocating per spin where possible (reuse result buffers).
 *  - Prefer typed arrays / flat arrays over nested objects for hot paths.
 */

/** @typedef {'H1'|'H2'|'H3'|'L1'|'L2'|'L3'|'L4'|'WILD'|'SCATTER'} SymbolId */

/** Visible reel grid: 5 reels × 3 rows (column-major: reel → row). */
export const REEL_COUNT = 5;
export const ROW_COUNT = 3;

/** Symbol catalogue used by the placeholder RNG / paytable. */
export const SYMBOL_IDS = Object.freeze([
  'H1',
  'H2',
  'H3',
  'L1',
  'L2',
  'L3',
  'L4',
  'WILD',
  'SCATTER',
]);

/**
 * Minimal paytable: [symbolId] → payout multipliers for [3-of-kind, 4, 5].
 * Values are illustrative only — replace with certified game math.
 */
export const PAYTABLE = Object.freeze({
  H1: Object.freeze([10, 50, 200]),
  H2: Object.freeze([8, 30, 100]),
  H3: Object.freeze([6, 20, 80]),
  L1: Object.freeze([4, 12, 40]),
  L2: Object.freeze([3, 10, 30]),
  L3: Object.freeze([2, 8, 20]),
  L4: Object.freeze([2, 6, 15]),
  WILD: Object.freeze([0, 0, 0]),
  SCATTER: Object.freeze([0, 0, 0]),
});

/** Line definitions for a classic 5×3 — left-to-right, index = row on each reel. */
export const PAYLINES = Object.freeze([
  Object.freeze([1, 1, 1, 1, 1]), // middle
  Object.freeze([0, 0, 0, 0, 0]), // top
  Object.freeze([2, 2, 2, 2, 2]), // bottom
  Object.freeze([0, 1, 2, 1, 0]), // V
  Object.freeze([2, 1, 0, 1, 2]), // ^
]);

/**
 * Reusable spin-result buffer to avoid GC pressure during rapid spins.
 * Callers should treat returned objects as read-only until the next spin.
 */
const _resultScratch = {
  /** @type {SymbolId[][]} */
  grid: [],
  /** @type {Array<{ lineIndex: number, symbol: SymbolId, count: number, win: number }>} */
  lineWins: [],
  totalWin: 0,
  scatterCount: 0,
};

/** Seeded PRNG (mulberry32) — replace with server-authoritative outcomes in production. */
export function createRng(seed = Date.now() >>> 0) {
  let t = seed >>> 0;
  return function next() {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a flat weight table for weighted symbol picks.
 * @param {Record<string, number>} weights
 */
export function buildWeightTable(weights) {
  /** @type {SymbolId[]} */
  const table = [];
  for (const id of SYMBOL_IDS) {
    const w = weights[id] ?? 1;
    for (let i = 0; i < w; i++) table.push(/** @type {SymbolId} */ (id));
  }
  return table;
}

const DEFAULT_WEIGHTS = Object.freeze({
  H1: 2,
  H2: 3,
  H3: 4,
  L1: 8,
  L2: 8,
  L3: 10,
  L4: 10,
  WILD: 2,
  SCATTER: 1,
});

const WEIGHT_TABLE = buildWeightTable(DEFAULT_WEIGHTS);

/**
 * Generate a 5×3 symbol grid (column-major).
 * @param {() => number} rng  returns [0, 1)
 * @param {SymbolId[]} [weightTable]
 * @returns {SymbolId[][]}
 */
export function generateGrid(rng, weightTable = WEIGHT_TABLE) {
  /** @type {SymbolId[][]} */
  const grid = new Array(REEL_COUNT);
  for (let r = 0; r < REEL_COUNT; r++) {
    /** @type {SymbolId[]} */
    const col = new Array(ROW_COUNT);
    for (let row = 0; row < ROW_COUNT; row++) {
      col[row] = weightTable[(rng() * weightTable.length) | 0];
    }
    grid[r] = col;
  }
  return grid;
}

/**
 * Evaluate left-to-right line wins. Wild substitutes for all except scatter.
 * @param {SymbolId[][]} grid
 * @param {number} bet
 * @param {typeof _resultScratch} [out]  optional reuse buffer
 */
export function evaluateWins(grid, bet, out = _resultScratch) {
  out.lineWins.length = 0;
  out.totalWin = 0;
  out.scatterCount = 0;
  out.grid = grid;

  // Scatter count (any position)
  for (let r = 0; r < REEL_COUNT; r++) {
    for (let row = 0; row < ROW_COUNT; row++) {
      if (grid[r][row] === 'SCATTER') out.scatterCount++;
    }
  }

  for (let li = 0; li < PAYLINES.length; li++) {
    const line = PAYLINES[li];
    let first = /** @type {SymbolId|null} */ (null);
    let count = 0;

    for (let reel = 0; reel < REEL_COUNT; reel++) {
      const sym = grid[reel][line[reel]];
      if (sym === 'SCATTER') break;

      if (first === null) {
        if (sym === 'WILD') {
          // Leading wilds count; wait for a paying symbol to lock the line type.
          count++;
          continue;
        }
        first = sym;
        count++;
        continue;
      }

      if (sym === first || sym === 'WILD') {
        count++;
      } else {
        break;
      }
    }

    // If the line was all wilds, treat as WILD (no line pay in this placeholder).
    const paySym = first ?? 'WILD';
    const pays = PAYTABLE[paySym];
    if (count >= 3 && pays) {
      const multi = pays[count - 3] ?? 0;
      if (multi > 0) {
        const win = multi * bet;
        out.lineWins.push({ lineIndex: li, symbol: paySym, count, win });
        out.totalWin += win;
      }
    }
  }

  return out;
}

/**
 * Full spin cycle: generate grid + evaluate.
 * @param {{ bet?: number, rng?: () => number }} [opts]
 */
export function spin(opts = {}) {
  const bet = opts.bet ?? 1;
  const rng = opts.rng ?? createRng();
  const grid = generateGrid(rng);
  return evaluateWins(grid, bet);
}

/**
 * Placeholder RTP helper — theoretical long-run estimate for tooling / QA.
 * Replace with certified simulation output before launch.
 * @param {number} spins
 * @param {number} [bet]
 * @param {number} [seed]
 */
export function estimateRtp(spins = 10000, bet = 1, seed = 1) {
  const rng = createRng(seed);
  let totalWon = 0;
  let totalWagered = 0;

  for (let i = 0; i < spins; i++) {
    totalWagered += bet;
    const result = spin({ bet, rng });
    totalWon += result.totalWin;
  }

  return {
    spins,
    totalWagered,
    totalWon,
    rtp: totalWagered > 0 ? totalWon / totalWagered : 0,
  };
}

export const MathEngine = Object.freeze({
  REEL_COUNT,
  ROW_COUNT,
  SYMBOL_IDS,
  PAYTABLE,
  PAYLINES,
  createRng,
  buildWeightTable,
  generateGrid,
  evaluateWins,
  spin,
  estimateRtp,
});

export default MathEngine;
