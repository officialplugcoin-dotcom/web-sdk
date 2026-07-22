/**
 * math.js — Robo 5000 Math Engine (Limitless Studio)
 *
 * 5×5 · 20 fixed paylines · High volatility
 * Target RTP: 96%  |  Max win: 5000× total bet
 *
 * Modes:
 *  - base          standard strip weights
 *  - ante          3× bet, boosted scatter rates
 *  - free          10 free spins (from scatter / buy)
 *  - super         free spins with sticky wild multipliers
 *
 * Pure JS — no Pixi / DOM dependencies.
 */

/** @typedef {'L1'|'L2'|'L3'|'L4'|'H1'|'H2'|'H3'|'WILD'|'SCATTER'} SymbolId */

/** @typedef {{ reel: number, row: number }} CellPos */

/**
 * @typedef {object} WinningLine
 * @property {number} lineIndex
 * @property {SymbolId} symbol
 * @property {number} count
 * @property {number} win
 * @property {number} multiplier
 * @property {CellPos[]} positions
 */

/**
 * @typedef {object} SpinResult
 * @property {SymbolId[][]} grid
 * @property {number[][]} wildMults  parallel 5×5 — multiplier if WILD else 1
 * @property {number} totalWin
 * @property {WinningLine[]} winningLines
 * @property {boolean} isFreeSpinTriggered
 * @property {number} freeSpinsAwarded
 * @property {number} scatterCount
 * @property {number} scatterWin
 * @property {number} betAmount
 * @property {number} cost  amount charged this spin (bet / ante / buy)
 * @property {number} seed
 * @property {boolean} winCapped
 * @property {'base'|'ante'|'free'|'super'} mode
 * @property {Array<{ reel: number, row: number, mult: number }>} stickyWilds
 */

export const REEL_COUNT = 5;
export const ROW_COUNT = 5;

export const TARGET_RTP = 0.96;
export const MAX_WIN_MULT = 5000;

export const SCATTER_FS_THRESHOLD = 3;
export const FREE_SPINS_AWARD = 10;
export const SUPER_FREE_SPINS_AWARD = 10;

/** Stake-style bet ladder ($). */
export const BET_STEPS = Object.freeze([
  0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100,
]);

export const ANTE_MULT = 3;
export const BUY_BONUS_MULT = 100;
export const SUPER_BUY_MULT = 300;

/** Wild multiplier weights (high-vol: mostly low, rare huge). */
export const WILD_MULT_TABLE = Object.freeze([
  { mult: 2, w: 38 },
  { mult: 3, w: 22 },
  { mult: 5, w: 16 },
  { mult: 10, w: 10 },
  { mult: 15, w: 6 },
  { mult: 25, w: 4 },
  { mult: 50, w: 2.5 },
  { mult: 100, w: 1.5 },
]);

export const SYMBOL_IDS = Object.freeze([
  'L1', // Circuit Board — Neon Cyan
  'L2', // Microchip — Neon Green
  'L3', // Quantum Core — Magenta
  'L4', // Plasma Cell — Gold
  'H1', // Mecha Sentinel
  'H2', // Android Visor
  'H3', // Cyber Omega
  'WILD',
  'SCATTER',
]);

/**
 * High-volatility paytable (multipliers of LINE bet).
 * Index 0 = 3-oak, 1 = 4-oak, 2 = 5-oak.
 */
export const PAYTABLE = Object.freeze({
  H3: Object.freeze([40, 200, 1000]), // Cyber Omega
  H2: Object.freeze([30, 120, 600]), // Android Visor
  H1: Object.freeze([20, 80, 400]), // Mecha Sentinel
  L4: Object.freeze([10, 40, 150]),
  L3: Object.freeze([8, 30, 120]),
  L2: Object.freeze([6, 25, 100]),
  L1: Object.freeze([5, 20, 80]),
  WILD: Object.freeze([40, 200, 1000]),
  SCATTER: Object.freeze([0, 0, 0]),
});

/** Scatter pays as × TOTAL bet (anywhere). Index = scatter count 0..5. */
export const SCATTER_PAYS = Object.freeze([0, 0, 0, 2, 10, 50]);

/**
 * 20 fixed L→R paylines on a 5×5 grid (row index 0=top … 4=bot).
 */
export const PAYLINES = Object.freeze([
  Object.freeze([2, 2, 2, 2, 2]), // mid
  Object.freeze([1, 1, 1, 1, 1]),
  Object.freeze([3, 3, 3, 3, 3]),
  Object.freeze([0, 0, 0, 0, 0]),
  Object.freeze([4, 4, 4, 4, 4]),
  Object.freeze([0, 1, 2, 3, 4]), // diag \
  Object.freeze([4, 3, 2, 1, 0]), // diag /
  Object.freeze([1, 2, 3, 2, 1]), // V
  Object.freeze([3, 2, 1, 2, 3]), // ^
  Object.freeze([0, 1, 1, 1, 0]),
  Object.freeze([4, 3, 3, 3, 4]),
  Object.freeze([2, 1, 0, 1, 2]),
  Object.freeze([2, 3, 4, 3, 2]),
  Object.freeze([1, 1, 2, 3, 3]),
  Object.freeze([3, 3, 2, 1, 1]),
  Object.freeze([0, 0, 2, 4, 4]),
  Object.freeze([4, 4, 2, 0, 0]),
  Object.freeze([1, 2, 2, 2, 1]),
  Object.freeze([3, 2, 2, 2, 3]),
  Object.freeze([0, 2, 4, 2, 0]),
]);

export const LINE_COUNT = PAYLINES.length;

/** Base strip — lows dominate, features scarce (high vol). */
export const STRIP_WEIGHTS_BASE = Object.freeze({
  L1: 14,
  L2: 13,
  L3: 12,
  L4: 11,
  H1: 5,
  H2: 4,
  H3: 3,
  WILD: 2,
  SCATTER: 1.2,
});

/** Ante — same highs, ~2.2× scatter weight. */
export const STRIP_WEIGHTS_ANTE = Object.freeze({
  L1: 13,
  L2: 12,
  L3: 11,
  L4: 10,
  H1: 5,
  H2: 4,
  H3: 3,
  WILD: 2,
  SCATTER: 2.7,
});

/** Free spins — more wilds, modest scatter. */
export const STRIP_WEIGHTS_FREE = Object.freeze({
  L1: 11,
  L2: 10,
  L3: 10,
  L4: 9,
  H1: 6,
  H2: 5,
  H3: 4,
  WILD: 4,
  SCATTER: 1.6,
});

/** Super free — wild-heavy for sticky multipliers. */
export const STRIP_WEIGHTS_SUPER = Object.freeze({
  L1: 9,
  L2: 9,
  L3: 8,
  L4: 8,
  H1: 6,
  H2: 5,
  H3: 4,
  WILD: 7,
  SCATTER: 1.4,
});

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
    const copies = Math.max(1, Math.round(w * 10));
    for (let i = 0; i < copies; i++) table.push(/** @type {SymbolId} */ (id));
  }
  return table;
}

const TABLES = {
  base: buildWeightTable(STRIP_WEIGHTS_BASE),
  ante: buildWeightTable(STRIP_WEIGHTS_ANTE),
  free: buildWeightTable(STRIP_WEIGHTS_FREE),
  super: buildWeightTable(STRIP_WEIGHTS_SUPER),
};

const WILD_WEIGHT_SUM = WILD_MULT_TABLE.reduce((s, e) => s + e.w, 0);

/**
 * @param {() => number} rng
 * @returns {number}
 */
export function rollWildMultiplier(rng) {
  let roll = rng() * WILD_WEIGHT_SUM;
  for (const entry of WILD_MULT_TABLE) {
    roll -= entry.w;
    if (roll <= 0) return entry.mult;
  }
  return 2;
}

/**
 * @param {'base'|'ante'|'free'|'super'} mode
 */
function weightsFor(mode) {
  return TABLES[mode] ?? TABLES.base;
}

/**
 * @param {() => number} rng
 * @param {'base'|'ante'|'free'|'super'} mode
 * @param {Array<{ reel: number, row: number, mult: number }>} [sticky]
 * @returns {{ grid: SymbolId[][], wildMults: number[][] }}
 */
export function generateGrid(rng, mode = 'base', sticky = []) {
  const weightTable = weightsFor(mode);
  const len = weightTable.length;
  /** @type {SymbolId[][]} */
  const grid = new Array(REEL_COUNT);
  /** @type {number[][]} */
  const wildMults = new Array(REEL_COUNT);

  /** @type {Map<string, number>} */
  const stickyMap = new Map();
  for (const s of sticky) stickyMap.set(`${s.reel},${s.row}`, s.mult);

  for (let r = 0; r < REEL_COUNT; r++) {
    /** @type {SymbolId[]} */
    const col = new Array(ROW_COUNT);
    /** @type {number[]} */
    const mcol = new Array(ROW_COUNT);
    for (let row = 0; row < ROW_COUNT; row++) {
      const key = `${r},${row}`;
      if (stickyMap.has(key)) {
        col[row] = 'WILD';
        mcol[row] = stickyMap.get(key) ?? 2;
        continue;
      }
      const sym = weightTable[(rng() * len) | 0];
      col[row] = sym;
      mcol[row] = sym === 'WILD' ? rollWildMultiplier(rng) : 1;
    }
    grid[r] = col;
    wildMults[r] = mcol;
  }
  return { grid, wildMults };
}

/**
 * @param {SymbolId[][]} grid
 * @param {number[][]} wildMults
 * @param {readonly number[]} line
 */
function evaluateLine(grid, wildMults, line) {
  /** @type {SymbolId|null} */
  let paySymbol = null;
  let count = 0;
  let multiplier = 1;
  /** @type {CellPos[]} */
  const positions = [];

  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const row = line[reel];
    const sym = grid[reel][row];
    if (sym === 'SCATTER') break;

    if (sym === 'WILD') {
      multiplier *= wildMults[reel][row] || 1;
      count++;
      positions.push({ reel, row });
      continue;
    }

    if (paySymbol === null) {
      paySymbol = sym;
      count++;
      positions.push({ reel, row });
      continue;
    }

    if (sym === paySymbol || sym === 'WILD') {
      if (sym === 'WILD') multiplier *= wildMults[reel][row] || 1;
      count++;
      positions.push({ reel, row });
    } else {
      break;
    }
  }

  // Leading wilds with no paying symbol → treat as WILD line
  if (count < 3) return null;
  const symbol = /** @type {SymbolId} */ (paySymbol ?? 'WILD');
  const pays = PAYTABLE[symbol];
  if (!pays || (pays[count - 3] ?? 0) <= 0) return null;
  return { symbol, count, positions, multiplier };
}

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
 * Collect sticky wild cells from a grid (for super mode persistence).
 * @param {SymbolId[][]} grid
 * @param {number[][]} wildMults
 * @param {Array<{ reel: number, row: number, mult: number }>} prev
 */
export function collectStickyWilds(grid, wildMults, prev = []) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const s of prev) map.set(`${s.reel},${s.row}`, s.mult);
  for (let r = 0; r < REEL_COUNT; r++) {
    for (let row = 0; row < ROW_COUNT; row++) {
      if (grid[r][row] === 'WILD') {
        map.set(`${r},${row}`, wildMults[r][row] || 2);
      }
    }
  }
  return [...map.entries()].map(([k, mult]) => {
    const [reel, row] = k.split(',').map(Number);
    return { reel, row, mult };
  });
}

/**
 * @param {SymbolId[][]} grid
 * @param {number[][]} wildMults
 * @param {number} betAmount
 * @param {object} [meta]
 * @returns {SpinResult}
 */
export function evaluateGrid(grid, wildMults, betAmount, meta = {}) {
  const bet = Math.max(0, Number(betAmount) || 0);
  const lineBet = LINE_COUNT > 0 ? bet / LINE_COUNT : 0;
  const maxWin = bet * MAX_WIN_MULT;
  const mode = meta.mode ?? 'base';
  const seed = meta.seed ?? 0;
  const cost = meta.cost ?? bet;

  /** @type {WinningLine[]} */
  const winningLines = [];
  let lineWinTotal = 0;

  for (let li = 0; li < LINE_COUNT; li++) {
    const hit = evaluateLine(grid, wildMults, PAYLINES[li]);
    if (!hit) continue;
    const multi = PAYTABLE[hit.symbol][hit.count - 3] ?? 0;
    const win = multi * lineBet * hit.multiplier;
    if (win <= 0) continue;
    winningLines.push({
      lineIndex: li,
      symbol: hit.symbol,
      count: hit.count,
      win,
      multiplier: hit.multiplier,
      positions: hit.positions,
    });
    lineWinTotal += win;
  }

  const scatter = countScatters(grid);
  const scatterMulti = SCATTER_PAYS[Math.min(scatter.count, SCATTER_PAYS.length - 1)] ?? 0;
  const scatterWin = scatterMulti * bet;
  const isFreeSpinTriggered = scatter.count >= SCATTER_FS_THRESHOLD;
  const freeSpinsAwarded = isFreeSpinTriggered
    ? mode === 'super'
      ? SUPER_FREE_SPINS_AWARD
      : FREE_SPINS_AWARD
    : 0;

  if (scatterWin > 0) {
    winningLines.push({
      lineIndex: -1,
      symbol: 'SCATTER',
      count: scatter.count,
      win: scatterWin,
      multiplier: 1,
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

  const stickyWilds =
    mode === 'super'
      ? collectStickyWilds(grid, wildMults, meta.stickyWilds ?? [])
      : [];

  return {
    grid,
    wildMults,
    totalWin,
    winningLines,
    isFreeSpinTriggered,
    freeSpinsAwarded,
    scatterCount: scatter.count,
    scatterWin: Math.round(scatterWin * 100) / 100,
    betAmount: bet,
    cost,
    seed: seed >>> 0,
    winCapped,
    mode,
    stickyWilds,
  };
}

/**
 * @param {number} betAmount
 * @param {number} seed
 * @param {{ mode?: 'base'|'ante'|'free'|'super', stickyWilds?: Array<{reel:number,row:number,mult:number}>, cost?: number }} [opts]
 */
export function evaluateSpin(betAmount, seed, opts = {}) {
  const s = seed >>> 0;
  const rng = createRng(s);
  const mode = opts.mode ?? 'base';
  const sticky = opts.stickyWilds ?? [];
  const { grid, wildMults } = generateGrid(rng, mode, sticky);
  const cost =
    opts.cost ??
    (mode === 'ante' ? betAmount * ANTE_MULT : betAmount);
  return evaluateGrid(grid, wildMults, betAmount, {
    mode,
    seed: s,
    cost,
    stickyWilds: sticky,
  });
}

/**
 * Force a free-spin trigger grid (for buy-bonus entry spin presentation).
 * @param {number} betAmount
 * @param {number} seed
 * @param {'free'|'super'} mode
 */
export function evaluateBonusPurchase(betAmount, seed, mode = 'free') {
  const costMult = mode === 'super' ? SUPER_BUY_MULT : BUY_BONUS_MULT;
  const cost = betAmount * costMult;
  // Deterministic "purchase" seed stream — guarantee ≥3 scatters then evaluate
  const s = seed >>> 0;
  const rng = createRng(s ^ 0xb00f00d);
  const baseMode = mode === 'super' ? 'super' : 'free';
  let { grid, wildMults } = generateGrid(rng, baseMode, []);

  // Ensure 3 scatters on distinct reels for trigger clarity
  const scatterReels = [0, 2, 4];
  for (const r of scatterReels) {
    const row = (rng() * ROW_COUNT) | 0;
    grid[r][row] = 'SCATTER';
    wildMults[r][row] = 1;
  }

  const result = evaluateGrid(grid, wildMults, betAmount, {
    mode: baseMode,
    seed: s,
    cost,
    stickyWilds: [],
  });
  // Award FS even if evaluate already did via scatter count
  if (!result.isFreeSpinTriggered) {
    result.isFreeSpinTriggered = true;
    result.freeSpinsAwarded =
      mode === 'super' ? SUPER_FREE_SPINS_AWARD : FREE_SPINS_AWARD;
  }
  return result;
}

export function freeSpinSeed(parentSeed, index) {
  return (parentSeed ^ Math.imul(index + 1, 0x27d4eb2d) ^ 0x165667b1) >>> 0;
}

export function getDesignParams() {
  return {
    title: 'Robo 5000',
    studio: 'Limitless Studio',
    targetRtp: TARGET_RTP,
    volatility: 'high',
    reelCount: REEL_COUNT,
    rowCount: ROW_COUNT,
    lineCount: LINE_COUNT,
    maxWinMult: MAX_WIN_MULT,
    freeSpinsAward: FREE_SPINS_AWARD,
    anteMult: ANTE_MULT,
    buyBonusMult: BUY_BONUS_MULT,
    superBuyMult: SUPER_BUY_MULT,
  };
}

export function nextBet(current, dir) {
  const i = BET_STEPS.findIndex((b) => Math.abs(b - current) < 1e-9);
  const idx = i < 0 ? 4 : i;
  const next = Math.min(BET_STEPS.length - 1, Math.max(0, idx + dir));
  return BET_STEPS[next];
}

export const MathEngine = Object.freeze({
  REEL_COUNT,
  ROW_COUNT,
  TARGET_RTP,
  MAX_WIN_MULT,
  SCATTER_FS_THRESHOLD,
  FREE_SPINS_AWARD,
  SUPER_FREE_SPINS_AWARD,
  BET_STEPS,
  ANTE_MULT,
  BUY_BONUS_MULT,
  SUPER_BUY_MULT,
  SYMBOL_IDS,
  PAYTABLE,
  SCATTER_PAYS,
  PAYLINES,
  LINE_COUNT,
  createRng,
  buildWeightTable,
  generateGrid,
  rollWildMultiplier,
  evaluateGrid,
  evaluateSpin,
  evaluateBonusPurchase,
  collectStickyWilds,
  freeSpinSeed,
  getDesignParams,
  nextBet,
});

export default MathEngine;
