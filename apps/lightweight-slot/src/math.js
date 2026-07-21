/**
 * math.js — Math Engine
 *
 * Target parameters:
 *  - Overall RTP ≈ 96% (base game + free-spin value, long-run sim)
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

/** Target long-run return to player (base + free spins). */
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
 * Line-bet multipliers for [3-of-kind, 4-of-kind, 5-of-kind].
 * Line bet = totalBet / PAYLINES.length.
 * Tuned with STRIP_WEIGHTS so overall RTP (incl. free spins) ≈ 96%.
 */
export const PAYTABLE = Object.freeze({
  // High symbols
  H1: Object.freeze([64, 256, 1280]), // Robot Head
  H2: Object.freeze([51, 192, 960]), // Plasma Core
  H3: Object.freeze([38, 128, 640]), // Cyber Heart
  H4: Object.freeze([32, 102, 512]), // Battery
  // Low symbols — Energy Chips
  L1: Object.freeze([13, 38, 128]),
  L2: Object.freeze([10, 32, 102]),
  L3: Object.freeze([6, 26, 77]),
  L4: Object.freeze([6, 19, 64]),
  // All-wild lines pay as Robot Head
  WILD: Object.freeze([64, 256, 1280]),
  SCATTER: Object.freeze([0, 0, 0]),
});

/**
 * Scatter pays as a multiple of TOTAL bet (anywhere on the grid).
 * Index by scatter count 0..5.
 */
export const SCATTER_PAYS = Object.freeze([0, 0, 0, 3, 13, 64]);

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
 * Per-symbol strip weights — paired with PAYTABLE for ~96% overall RTP.
 */
export const STRIP_WEIGHTS = Object.freeze({
  H1: 4,
  H2: 5,
  H3: 6,
  H4: 7,
  L1: 11,
  L2: 11,
  L3: 12,
  L4: 12,
  WILD: 3,
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

/**
 * Long-run RTP estimate including free-spin playthrough (with retriggers).
 * @param {number} [spins]
 * @param {number} [bet]
 * @param {number} [seed]
 */
export function estimateRtp(spins = 100000, bet = 1, seed = 1) {
  let totalWon = 0;
  let totalWagered = 0;
  let baseWon = 0;
  let freeSpinTriggers = 0;
  let freeSpinsPlayed = 0;
  let maxSeen = 0;
  let wins = 0;

  for (let i = 0; i < spins; i++) {
    const spinSeed = (Math.imul(seed ^ 0x9e3779b9, i + 1) ^ (i * 0x85ebca6b)) >>> 0;
    const result = evaluateSpin(bet, spinSeed);
    totalWagered += bet;
    totalWon += result.totalWin;
    baseWon += result.totalWin;
    if (result.totalWin > 0) wins++;
    if (result.totalWin > maxSeen) maxSeen = result.totalWin;

    if (result.isFreeSpinTriggered) {
      freeSpinTriggers++;
      let remaining = result.freeSpinsAwarded;
      let fsIndex = 0;
      let guard = 0;
      while (remaining > 0 && guard++ < 500) {
        remaining--;
        freeSpinsPlayed++;
        const fsResult = evaluateSpin(bet, freeSpinSeed(spinSeed, fsIndex++));
        totalWon += fsResult.totalWin;
        if (fsResult.totalWin > maxSeen) maxSeen = fsResult.totalWin;
        if (fsResult.isFreeSpinTriggered) remaining += fsResult.freeSpinsAwarded;
      }
    }
  }

  return {
    spins,
    totalWagered,
    totalWon,
    rtp: totalWagered > 0 ? totalWon / totalWagered : 0,
    rtpBase: totalWagered > 0 ? baseWon / totalWagered : 0,
    hitRate: spins > 0 ? wins / spins : 0,
    freeSpinRate: spins > 0 ? freeSpinTriggers / spins : 0,
    freeSpinsPerPaidSpin: spins > 0 ? freeSpinsPlayed / spins : 0,
    maxWinSeen: maxSeen,
    targetRtp: TARGET_RTP,
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
  estimateRtp,
  spin,
  evaluateWins,
});

export default MathEngine;
