/**
 * math.js — Modular Math Engine (placeholder)
 *
 * Owns win evaluation, RTP-facing helpers, and outcome shaping.
 * Keep this layer pure (no Pixi / DOM) so it can run in tests or on the
 * server-side RGS without pulling in renderer code.
 *
 * Symbol ids align with assets.js robotic catalogue:
 *   H1 Robot Head · H2 Plasma Core · H3 Cyber Heart · H4 Battery
 *   L1–L4 Energy Chips · WILD · SCATTER
 */

/** @typedef {'H1'|'H2'|'H3'|'H4'|'L1'|'L2'|'L3'|'L4'|'WILD'|'SCATTER'} SymbolId */

export const REEL_COUNT = 5;
export const ROW_COUNT = 3;

export const SYMBOL_IDS = Object.freeze([
  'H1',
  'H2',
  'H3',
  'H4',
  'L1',
  'L2',
  'L3',
  'L4',
  'WILD',
  'SCATTER',
]);

/**
 * Paytable: multipliers for [3-of-kind, 4, 5].
 * Illustrative only — replace with certified game math.
 */
export const PAYTABLE = Object.freeze({
  H1: Object.freeze([12, 60, 250]),
  H2: Object.freeze([10, 45, 180]),
  H3: Object.freeze([8, 35, 140]),
  H4: Object.freeze([6, 25, 100]),
  L1: Object.freeze([4, 12, 40]),
  L2: Object.freeze([3, 10, 30]),
  L3: Object.freeze([2, 8, 20]),
  L4: Object.freeze([2, 6, 15]),
  WILD: Object.freeze([0, 0, 0]),
  SCATTER: Object.freeze([0, 0, 0]),
});

export const PAYLINES = Object.freeze([
  Object.freeze([1, 1, 1, 1, 1]),
  Object.freeze([0, 0, 0, 0, 0]),
  Object.freeze([2, 2, 2, 2, 2]),
  Object.freeze([0, 1, 2, 1, 0]),
  Object.freeze([2, 1, 0, 1, 2]),
]);

const _resultScratch = {
  /** @type {SymbolId[][]} */
  grid: [],
  /** @type {Array<{ lineIndex: number, symbol: SymbolId, count: number, win: number }>} */
  lineWins: [],
  totalWin: 0,
  scatterCount: 0,
};

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
  H3: 3,
  H4: 4,
  L1: 8,
  L2: 8,
  L3: 10,
  L4: 10,
  WILD: 2,
  SCATTER: 1,
});

const WEIGHT_TABLE = buildWeightTable(DEFAULT_WEIGHTS);

/**
 * @param {() => number} rng
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
 * @param {SymbolId[][]} grid
 * @param {number} bet
 * @param {typeof _resultScratch} [out]
 */
export function evaluateWins(grid, bet, out = _resultScratch) {
  out.lineWins.length = 0;
  out.totalWin = 0;
  out.scatterCount = 0;
  out.grid = grid;

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
 * @param {{ bet?: number, rng?: () => number }} [opts]
 */
export function spin(opts = {}) {
  const bet = opts.bet ?? 1;
  const rng = opts.rng ?? createRng();
  const grid = generateGrid(rng);
  return evaluateWins(grid, bet);
}

/**
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
