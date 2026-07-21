/**
 * math.js — Math Engine
 *
 * Design targets (standard balanced 20-line model — no sim tuning required):
 *  - Target RTP: 96%
 *  - Max win cap: 5000× total bet
 *  - 20 fixed paylines on a 5×3 grid
 *
 * Deterministic API:
 *  evaluateSpin(betAmount, seed) → { grid, totalWin, winningLines, isFreeSpinTriggered, … }
 *
 * Pure JS — no Pixi / DOM dependencies.
 */

/** @typedef {'H1'|'H2'|'H3'|'H4'|'L1'|'L2'|'L3'|'L4'|'WILD'|'SCATTER'} SymbolId */

/** @typedef {{ reel: number, row: number }} CellPos */

/**
 * @typedef {object} WinningLine
 * @property {number} lineIndex
 * @property {SymbolId} symbol
 * @property {number} count
 * @property {number} win
 * @property {CellPos[]} positions  winning cells for visual highlight
 */

/**
 * @typedef {object} SpinResult
 * @property {SymbolId[][]} grid  column-major 5×3
 * @property {number} totalWin  capped at betAmount * MAX_WIN_MULT
 * @property {WinningLine[]} winningLines
 * @property {boolean} isFreeSpinTriggered
 * @property {number} freeSpinsAwarded
 * @property {number} scatterCount
 * @property {number} scatterWin
 * @property {number} betAmount
 * @property {number} seed
 * @property {boolean} winCapped
 */

export const REEL_COUNT = 5;
export const ROW_COUNT = 3;

/** Target return-to-player for this balanced 20-line design. */
export const TARGET_RTP = 0.96;

/** Hard cap on a single spin payout as a multiple of total bet. */
export const MAX_WIN_MULT = 5000;

/** Scatter count that awards free spins. */
export const SCATTER_FS_THRESHOLD = 3;

/** Free spins awarded when threshold is met. */
export const FREE_SPINS_AWARD = 10;

export const SYMBOL_IDS = Object.freeze([
  'H1', // Robot Head
  'H2', // Plasma Core
  'H3', // Cyber Heart
  'H4', // Battery
  'L1', // Energy Chip Red
  'L2', // Energy Chip Blue
  'L3', // Energy Chip Green
  'L4', // Energy Chip Yellow
  'WILD',
  'SCATTER',
]);

/**
 * Standard balanced 20-line paytable (multipliers of LINE bet).
 * Line bet = totalBet / 20.
 *
 * Values follow a conventional mid-volatility video-slot curve aimed at ~96% RTP
 * when paired with STRIP_WEIGHTS below (certified math not required for this stub).
 */
export const PAYTABLE = Object.freeze({
  // High symbols — steeper top awards
  H1: Object.freeze([25, 100, 750]), // Robot Head
  H2: Object.freeze([20, 75, 500]), // Plasma Core
  H3: Object.freeze([15, 50, 300]), // Cyber Heart
  H4: Object.freeze([10, 40, 200]), // Battery
  // Low symbols — Energy Chips
  L1: Object.freeze([5, 20, 100]),
  L2: Object.freeze([5, 15, 75]),
  L3: Object.freeze([5, 10, 50]),
  L4: Object.freeze([5, 10, 50]),
  // All-wild lines pay as top high
  WILD: Object.freeze([25, 100, 750]),
  SCATTER: Object.freeze([0, 0, 0]),
});

/**
 * Scatter pays as a multiple of TOTAL bet (anywhere on the grid).
 * Index by scatter count 0..5 — classic 20-line scatter curve.
 */
export const SCATTER_PAYS = Object.freeze([0, 0, 0, 2, 10, 50]);

/**
 * 20 fixed left-to-right paylines.
 * Each entry is length-5: row index (0=top, 1=mid, 2=bot) per reel.
 */
export const PAYLINES = Object.freeze([
  Object.freeze([1, 1, 1, 1, 1]), // 0  middle
  Object.freeze([0, 0, 0, 0, 0]), // 1  top
  Object.freeze([2, 2, 2, 2, 2]), // 2  bottom
  Object.freeze([0, 1, 2, 1, 0]), // 3  V
  Object.freeze([2, 1, 0, 1, 2]), // 4  ^
  Object.freeze([0, 0, 1, 2, 2]), // 5
  Object.freeze([2, 2, 1, 0, 0]), // 6
  Object.freeze([1, 0, 0, 0, 1]), // 7
  Object.freeze([1, 2, 2, 2, 1]), // 8
  Object.freeze([0, 1, 1, 1, 0]), // 9
  Object.freeze([2, 1, 1, 1, 2]), // 10
  Object.freeze([0, 1, 0, 1, 0]), // 11
  Object.freeze([2, 1, 2, 1, 2]), // 12
  Object.freeze([1, 0, 1, 0, 1]), // 13
  Object.freeze([1, 2, 1, 2, 1]), // 14
  Object.freeze([0, 0, 1, 0, 0]), // 15
  Object.freeze([2, 2, 1, 2, 2]), // 16
  Object.freeze([1, 0, 1, 2, 1]), // 17
  Object.freeze([1, 2, 1, 0, 1]), // 18
  Object.freeze([0, 2, 1, 2, 0]), // 19
]);

export const LINE_COUNT = PAYLINES.length;

/**
 * Balanced strip weights — lows dominate, highs / WILD / SCATTER stay scarce.
 * Keeps hit rate and feature frequency in a typical 96% mid-vol band.
 */
export const STRIP_WEIGHTS = Object.freeze({
  H1: 2,
  H2: 3,
  H3: 4,
  H4: 5,
  L1: 10,
  L2: 10,
  L3: 12,
  L4: 12,
  WILD: 2,
  SCATTER: 2,
});

/** Seeded PRNG (mulberry32) — same seed ⇒ same spin outcome. */
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
 * @returns {SymbolId[]}
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

const WEIGHT_TABLE = buildWeightTable(STRIP_WEIGHTS);

/**
 * Generate a 5×3 symbol grid (column-major) from an RNG stream.
 * @param {() => number} rng
 * @param {SymbolId[]} [weightTable]
 * @returns {SymbolId[][]}
 */
export function generateGrid(rng, weightTable = WEIGHT_TABLE) {
  /** @type {SymbolId[][]} */
  const grid = new Array(REEL_COUNT);
  const len = weightTable.length;
  for (let r = 0; r < REEL_COUNT; r++) {
    /** @type {SymbolId[]} */
    const col = new Array(ROW_COUNT);
    for (let row = 0; row < ROW_COUNT; row++) {
      col[row] = weightTable[(rng() * len) | 0];
    }
    grid[r] = col;
  }
  return grid;
}

/**
 * Evaluate a left-to-right line with WILD substitution (SCATTER breaks the line).
 * @param {SymbolId[][]} grid
 * @param {readonly number[]} line
 * @returns {{ symbol: SymbolId, count: number, positions: CellPos[] } | null}
 */
function evaluateLine(grid, line) {
  /** @type {SymbolId|null} */
  let paySymbol = null;
  let count = 0;
  /** @type {CellPos[]} */
  const positions = [];

  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const row = line[reel];
    const sym = grid[reel][row];

    if (sym === 'SCATTER') break;

    if (paySymbol === null) {
      if (sym === 'WILD') {
        count++;
        positions.push({ reel, row });
        continue;
      }
      paySymbol = sym;
      count++;
      positions.push({ reel, row });
      continue;
    }

    if (sym === paySymbol || sym === 'WILD') {
      count++;
      positions.push({ reel, row });
    } else {
      break;
    }
  }

  if (count < 3) return null;

  const symbol = /** @type {SymbolId} */ (paySymbol ?? 'WILD');
  const pays = PAYTABLE[symbol];
  if (!pays || (pays[count - 3] ?? 0) <= 0) return null;

  return { symbol, count, positions };
}

/**
 * @param {SymbolId[][]} grid
 */
function countScatters(grid) {
  let n = 0;
  /** @type {CellPos[]} */
  const positions = [];
  for (let r = 0; r < REEL_COUNT; r++) {
    for (let row = 0; row < ROW_COUNT; row++) {
      if (grid[r][row] === 'SCATTER') {
        n++;
        positions.push({ reel: r, row });
      }
    }
  }
  return { count: n, positions };
}

/**
 * Evaluate an existing grid against the paytable (no RNG).
 * @param {SymbolId[][]} grid
 * @param {number} betAmount  total bet for the spin
 * @param {number} [seed]
 * @returns {SpinResult}
 */
export function evaluateGrid(grid, betAmount, seed = 0) {
  const bet = Math.max(0, Number(betAmount) || 0);
  const lineBet = LINE_COUNT > 0 ? bet / LINE_COUNT : 0;
  const maxWin = bet * MAX_WIN_MULT;

  /** @type {WinningLine[]} */
  const winningLines = [];
  let lineWinTotal = 0;

  for (let li = 0; li < LINE_COUNT; li++) {
    const hit = evaluateLine(grid, PAYLINES[li]);
    if (!hit) continue;
    const multi = PAYTABLE[hit.symbol][hit.count - 3] ?? 0;
    const win = multi * lineBet;
    if (win <= 0) continue;
    winningLines.push({
      lineIndex: li,
      symbol: hit.symbol,
      count: hit.count,
      win,
      positions: hit.positions,
    });
    lineWinTotal += win;
  }

  const scatter = countScatters(grid);
  const scatterMulti = SCATTER_PAYS[Math.min(scatter.count, SCATTER_PAYS.length - 1)] ?? 0;
  const scatterWin = scatterMulti * bet;
  const isFreeSpinTriggered = scatter.count >= SCATTER_FS_THRESHOLD;
  const freeSpinsAwarded = isFreeSpinTriggered ? FREE_SPINS_AWARD : 0;

  // Scatter positions are useful for highlight even without line wins
  if (scatterWin > 0) {
    winningLines.push({
      lineIndex: -1,
      symbol: 'SCATTER',
      count: scatter.count,
      win: scatterWin,
      positions: scatter.positions,
    });
  }

  let totalWin = lineWinTotal + scatterWin;
  let winCapped = false;
  if (totalWin > maxWin) {
    totalWin = maxWin;
    winCapped = true;
  }

  totalWin = Math.round(totalWin * 100) / 100;
  for (let i = 0; i < winningLines.length; i++) {
    winningLines[i].win = Math.round(winningLines[i].win * 100) / 100;
  }

  return {
    grid,
    totalWin,
    winningLines,
    isFreeSpinTriggered,
    freeSpinsAwarded,
    scatterCount: scatter.count,
    scatterWin: Math.round(scatterWin * 100) / 100,
    betAmount: bet,
    seed: seed >>> 0,
    winCapped,
  };
}

/**
 * Deterministic spin evaluation.
 * Same (betAmount, seed) pair always yields the same result.
 *
 * @param {number} betAmount
 * @param {number} seed  unsigned 32-bit integer
 * @returns {SpinResult}
 */
export function evaluateSpin(betAmount, seed) {
  const s = seed >>> 0;
  const rng = createRng(s);
  const grid = generateGrid(rng);
  return evaluateGrid(grid, betAmount, s);
}

/**
 * Derive a child seed for free-spin index `i` from a parent seed (deterministic).
 * @param {number} parentSeed
 * @param {number} index
 */
export function freeSpinSeed(parentSeed, index) {
  return (parentSeed ^ Math.imul(index + 1, 0x27d4eb2d) ^ 0x165667b1) >>> 0;
}

/** Design metadata — no Monte-Carlo loop. */
export function getDesignParams() {
  return {
    targetRtp: TARGET_RTP,
    lineCount: LINE_COUNT,
    maxWinMult: MAX_WIN_MULT,
    freeSpinsAward: FREE_SPINS_AWARD,
    scatterFsThreshold: SCATTER_FS_THRESHOLD,
  };
}

/** @deprecated Use evaluateSpin — kept for older call sites. */
export function spin(opts = {}) {
  const bet = opts.bet ?? 1;
  const seed =
    opts.seed ??
    (typeof opts.rng === 'function'
      ? (opts.rng() * 0xffffffff) >>> 0
      : (Date.now() ^ 0xdeadbeef) >>> 0);
  return evaluateSpin(bet, seed);
}

/** @deprecated Prefer evaluateGrid / evaluateSpin. */
export function evaluateWins(grid, bet) {
  const result = evaluateGrid(grid, bet);
  return {
    grid: result.grid,
    lineWins: result.winningLines,
    totalWin: result.totalWin,
    scatterCount: result.scatterCount,
  };
}

export const MathEngine = Object.freeze({
  REEL_COUNT,
  ROW_COUNT,
  TARGET_RTP,
  MAX_WIN_MULT,
  SCATTER_FS_THRESHOLD,
  FREE_SPINS_AWARD,
  SYMBOL_IDS,
  PAYTABLE,
  SCATTER_PAYS,
  PAYLINES,
  LINE_COUNT,
  STRIP_WEIGHTS,
  createRng,
  buildWeightTable,
  generateGrid,
  evaluateGrid,
  evaluateSpin,
  freeSpinSeed,
  getDesignParams,
  spin,
  evaluateWins,
});

export default MathEngine;
