/**
 * assets.js — Robo 5000 symbol + brand loader (Limitless Studio)
 *
 * Loads crisp 2D cyberpunk textures. Missing files fall back to baked
 * neon placeholders so `npx serve` always boots.
 */

/** @typedef {'L1'|'L2'|'L3'|'L4'|'H1'|'H2'|'H3'|'WILD'|'SCATTER'} SymbolId */

export const SYMBOL_DEFS = Object.freeze({
  L1: Object.freeze({
    id: 'L1',
    tier: 'low',
    name: 'Circuit Board',
    label: 'CIRC',
    color: 0x084055,
    accent: 0x00e6ff,
    src: './assets/symbols/circuit.png',
  }),
  L2: Object.freeze({
    id: 'L2',
    tier: 'low',
    name: 'Microchip',
    label: 'CHIP',
    color: 0x0a321c,
    accent: 0x28ff78,
    src: './assets/symbols/microchip.png',
  }),
  L3: Object.freeze({
    id: 'L3',
    tier: 'low',
    name: 'Quantum Core',
    label: 'QBIT',
    color: 0x370c32,
    accent: 0xff3cc8,
    src: './assets/symbols/quantum-core.png',
  }),
  L4: Object.freeze({
    id: 'L4',
    tier: 'low',
    name: 'Plasma Cell',
    label: 'CELL',
    color: 0x372a08,
    accent: 0xffd228,
    src: './assets/symbols/plasma-cell.png',
  }),
  H1: Object.freeze({
    id: 'H1',
    tier: 'high',
    name: 'Mecha Sentinel',
    label: 'MECH',
    color: 0x1c2230,
    accent: 0x00dcff,
    src: './assets/symbols/mecha-sentinel.png',
  }),
  H2: Object.freeze({
    id: 'H2',
    tier: 'high',
    name: 'Android Visor',
    label: 'VISR',
    color: 0x1a2820,
    accent: 0x50ff8c,
    src: './assets/symbols/android-visor.png',
  }),
  H3: Object.freeze({
    id: 'H3',
    tier: 'high',
    name: 'Cyber Omega',
    label: 'OMEG',
    color: 0x2a1830,
    accent: 0xff50c8,
    src: './assets/symbols/cyber-omega.png',
  }),
  WILD: Object.freeze({
    id: 'WILD',
    tier: 'special',
    name: 'Neon Wild',
    label: 'WILD',
    color: 0x283040,
    accent: 0xe6f5ff,
    src: './assets/symbols/wild.png',
  }),
  SCATTER: Object.freeze({
    id: 'SCATTER',
    tier: 'special',
    name: 'Energy Core',
    label: 'SCAT',
    color: 0x281237,
    accent: 0xff78ff,
    src: './assets/symbols/scatter.png',
  }),
});

export const SYMBOL_IDS = Object.freeze(/** @type {SymbolId[]} */ (Object.keys(SYMBOL_DEFS)));
export const ASSET_SYMBOL_SIZE = 128;
export const BRAND_LOGO_SRC = './assets/brand/limitless-studio.png';

function toCssHex(color) {
  return `#${(color >>> 0).toString(16).padStart(6, '0')}`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function createFallbackTexture(PIXI, def, size = ASSET_SYMBOL_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return PIXI.Texture.WHITE;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#0c121c';
  roundRectPath(ctx, 4, 4, size - 8, size - 8, 14);
  ctx.fill();
  ctx.fillStyle = toCssHex(def.color);
  roundRectPath(ctx, 10, 10, size - 20, size - 20, 10);
  ctx.fill();
  ctx.strokeStyle = toCssHex(def.accent);
  ctx.lineWidth = 3;
  roundRectPath(ctx, 8, 8, size - 16, size - 16, 12);
  ctx.stroke();
  ctx.fillStyle = '#e8fbff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 18px Orbitron, system-ui, sans-serif';
  ctx.fillText(def.label, size * 0.5, size * 0.48);
  ctx.fillStyle = toCssHex(def.accent);
  ctx.font = '600 11px Orbitron, system-ui, sans-serif';
  ctx.fillText(def.id, size * 0.5, size * 0.68);

  const texture = PIXI.Texture.from(canvas);
  texture.label = `fallback:${def.id}`;
  return texture;
}

async function tryLoadTexture(PIXI, alias, src) {
  try {
    const texture = await PIXI.Assets.load({ alias, src });
    if (texture && texture !== PIXI.Texture.EMPTY) {
      return /** @type {PIXI.Texture} */ (texture);
    }
  } catch {
    /* missing art → fallback */
  }
  return null;
}

export class AssetManager {
  constructor() {
    /** @type {Map<SymbolId, PIXI.Texture>} */
    this.textures = new Map();
    /** @type {Set<SymbolId>} */
    this.fallbackIds = new Set();
    /** @type {PIXI.Texture|null} */
    this.brandLogo = null;
    this.loaded = false;
    /** @type {typeof PIXI|null} */
    this._PIXI = null;
  }

  /**
   * @param {typeof PIXI} PIXI
   * @param {{ onProgress?: (ratio: number, label: string) => void, symbolSize?: number }} [opts]
   */
  async load(PIXI, opts = {}) {
    this._PIXI = PIXI;
    const onProgress = opts.onProgress ?? (() => {});
    const size = opts.symbolSize ?? ASSET_SYMBOL_SIZE;
    const ids = /** @type {SymbolId[]} */ (Object.keys(SYMBOL_DEFS));
    const total = ids.length + 1;

    onProgress(0.04, 'Initializing Robo 5000…');

    this.brandLogo = await tryLoadTexture(PIXI, 'brand:limitless', BRAND_LOGO_SRC);
    onProgress(1 / total, 'Limitless Studio brand loaded');

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const def = SYMBOL_DEFS[id];
      onProgress((i + 1) / total, `Loading ${def.name}…`);
      let texture = await tryLoadTexture(PIXI, `sym:${id}`, def.src);
      if (!texture) {
        texture = createFallbackTexture(PIXI, def, size);
        this.fallbackIds.add(id);
      }
      this.textures.set(id, texture);
    }

    this.loaded = true;
    onProgress(1, 'Systems online');
    console.info(
      '[assets] Robo 5000 — %d symbols (%d fallbacks), brand=%s',
      this.textures.size,
      this.fallbackIds.size,
      this.brandLogo ? 'ok' : 'missing',
    );
    return this;
  }

  /** @param {SymbolId|string} id */
  getTexture(id) {
    return this.textures.get(/** @type {SymbolId} */ (id)) ?? this._PIXI?.Texture.WHITE;
  }

  /** @param {SymbolId|string} id */
  getDef(id) {
    return SYMBOL_DEFS[/** @type {SymbolId} */ (id)] ?? null;
  }

  /** @returns {SymbolId} */
  randomId() {
    return SYMBOL_IDS[(Math.random() * SYMBOL_IDS.length) | 0];
  }
}

export const assets = new AssetManager();
export default assets;
