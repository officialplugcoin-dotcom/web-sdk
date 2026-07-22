/**
 * assets.js — Symbol asset manager (robotic 2D set)
 *
 * Loads textures for high / low / special symbols. If an image URL is missing
 * or fails, generates a cached coloured placeholder texture (Graphics → canvas)
 * so the game runs immediately for testing without art.
 *
 * Low-end notes:
 *  - All placeholders are baked once into Texture objects (GPU upload once).
 *  - Runtime only swaps `sprite.texture` — no per-frame Graphics redraw.
 *  - Shared textures across pooled sprites → texture batching friendly.
 *  - Symbol PNGs are ~96×96 and under 1 KB each for mobile bandwidth.
 */

/** @typedef {'H1'|'H2'|'H3'|'H4'|'L1'|'L2'|'L3'|'L4'|'WILD'|'SCATTER'} SymbolId */

/**
 * Canonical symbol catalogue — robotic / cyberpunk 2D set.
 * Art lives under `assets/symbols/` (lightweight procedural PNGs).
 */
export const SYMBOL_DEFS = Object.freeze({
  // High symbols
  H1: Object.freeze({
    id: 'H1',
    tier: 'high',
    name: 'Robot Head',
    label: 'HEAD',
    color: 0x2e86ab,
    accent: 0x00d4ff,
    src: './assets/symbols/robot-head.png',
  }),
  H2: Object.freeze({
    id: 'H2',
    tier: 'high',
    name: 'Plasma Core',
    label: 'CORE',
    color: 0x6c3483,
    accent: 0xdc82ff,
    src: './assets/symbols/plasma-core.png',
  }),
  H3: Object.freeze({
    id: 'H3',
    tier: 'high',
    name: 'Cyber Heart',
    label: 'HEART',
    color: 0xa93226,
    accent: 0xff5078,
    src: './assets/symbols/cyber-heart.png',
  }),
  H4: Object.freeze({
    id: 'H4',
    tier: 'high',
    name: 'Battery',
    label: 'BATT',
    color: 0x1e8449,
    accent: 0x50ff9a,
    src: './assets/symbols/battery.png',
  }),
  // Low symbols — Energy Chips
  L1: Object.freeze({
    id: 'L1',
    tier: 'low',
    name: 'Energy Chip Red',
    label: 'CHIP',
    color: 0xc0392b,
    accent: 0xff5050,
    src: './assets/symbols/chip-red.png',
  }),
  L2: Object.freeze({
    id: 'L2',
    tier: 'low',
    name: 'Energy Chip Blue',
    label: 'CHIP',
    color: 0x1a5276,
    accent: 0x50b4ff,
    src: './assets/symbols/chip-blue.png',
  }),
  L3: Object.freeze({
    id: 'L3',
    tier: 'low',
    name: 'Energy Chip Green',
    label: 'CHIP',
    color: 0x196f3d,
    accent: 0x50ff8c,
    src: './assets/symbols/chip-green.png',
  }),
  L4: Object.freeze({
    id: 'L4',
    tier: 'low',
    name: 'Energy Chip Yellow',
    label: 'CHIP',
    color: 0x9a7d0a,
    accent: 0xffdc3c,
    src: './assets/symbols/chip-yellow.png',
  }),
  // Specials
  WILD: Object.freeze({
    id: 'WILD',
    tier: 'special',
    name: 'Wild',
    label: 'WILD',
    color: 0x566573,
    accent: 0xe8f0ff,
    src: './assets/symbols/wild.png',
  }),
  SCATTER: Object.freeze({
    id: 'SCATTER',
    tier: 'special',
    name: 'Scatter',
    label: 'SCAT',
    color: 0x7d2948,
    accent: 0xff64b4,
    src: './assets/symbols/scatter.png',
  }),
});

/** Ordered id list — keep in sync with math engine. */
export const SYMBOL_IDS = Object.freeze(/** @type {SymbolId[]} */ (Object.keys(SYMBOL_DEFS)));

/** Default cell size used when baking placeholder textures (matches PNG assets). */
export const ASSET_SYMBOL_SIZE = 96;

/**
 * @param {number} color  0xRRGGBB
 * @returns {string} css hex
 */
function toCssHex(color) {
  return `#${(color >>> 0).toString(16).padStart(6, '0')}`;
}

/**
 * Bake a labelled rounded-rect placeholder into a CanvasTexture.
 * Done once per symbol at load — never inside the ticker.
 *
 * @param {typeof PIXI} PIXI
 * @param {typeof SYMBOL_DEFS[SymbolId]} def
 * @param {number} size
 * @returns {PIXI.Texture}
 */
function createFallbackTexture(PIXI, def, size = ASSET_SYMBOL_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return PIXI.Texture.WHITE;
  }

  const pad = 4;
  const radius = 10;

  // Transparent plate + neon body
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = toCssHex(def.color);
  roundRectPath(ctx, pad, pad, size - pad * 2, size - pad * 2, radius);
  ctx.fill();

  // Inner bevel (cyber panel)
  ctx.strokeStyle = toCssHex(def.accent);
  ctx.lineWidth = 2;
  roundRectPath(ctx, pad + 4, pad + 4, size - (pad + 4) * 2, size - (pad + 4) * 2, radius - 3);
  ctx.stroke();

  // Corner tech ticks
  ctx.strokeStyle = toCssHex(def.accent);
  ctx.lineWidth = 1.5;
  const t = pad + 8;
  ctx.beginPath();
  ctx.moveTo(t, t + 8);
  ctx.lineTo(t, t);
  ctx.lineTo(t + 8, t);
  ctx.moveTo(size - t, t + 8);
  ctx.lineTo(size - t, t);
  ctx.lineTo(size - t - 8, t);
  ctx.stroke();

  // Labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8fbff';
  ctx.font = '700 16px Orbitron, system-ui, sans-serif';
  ctx.fillText(def.label, size * 0.5, size * 0.46);

  ctx.font = '600 9px Orbitron, system-ui, sans-serif';
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = toCssHex(def.accent);
  ctx.fillText(def.id, size * 0.5, size * 0.66);
  ctx.globalAlpha = 1;

  const texture = PIXI.Texture.from(canvas);
  texture.label = `fallback:${def.id}`;
  return texture;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
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

/**
 * Try to load an image URL; resolve null on any failure (404 / CORS / network).
 * @param {typeof PIXI} PIXI
 * @param {string} alias
 * @param {string} src
 * @returns {Promise<PIXI.Texture|null>}
 */
async function tryLoadTexture(PIXI, alias, src) {
  try {
    const texture = await PIXI.Assets.load({ alias, src });
    if (texture && texture !== PIXI.Texture.EMPTY) {
      return /** @type {PIXI.Texture} */ (texture);
    }
  } catch {
    // Expected when art files are not present yet.
  }
  return null;
}

/**
 * AssetManager — singleton-style loader used by the reel engine.
 */
export class AssetManager {
  constructor() {
    /** @type {Map<SymbolId, PIXI.Texture>} */
    this.textures = new Map();
    /** @type {Set<SymbolId>} */
    this.fallbackIds = new Set();
    this.loaded = false;
    /** @type {typeof PIXI|null} */
    this._PIXI = null;
  }

  /**
   * Load all symbol textures (image → fallback).
   * @param {typeof PIXI} PIXI
   * @param {{ onProgress?: (ratio: number, label: string) => void, symbolSize?: number }} [opts]
   */
  async load(PIXI, opts = {}) {
    this._PIXI = PIXI;
    const onProgress = opts.onProgress ?? (() => {});
    const size = opts.symbolSize ?? ASSET_SYMBOL_SIZE;
    const ids = /** @type {SymbolId[]} */ (Object.keys(SYMBOL_DEFS));
    const total = ids.length;

    onProgress(0.05, 'Loading symbols…');

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const def = SYMBOL_DEFS[id];
      onProgress(0.05 + (i / total) * 0.85, `Loading ${def.name}…`);

      let texture = await tryLoadTexture(PIXI, `sym:${id}`, def.src);
      if (!texture) {
        texture = createFallbackTexture(PIXI, def, size);
        this.fallbackIds.add(id);
      }
      this.textures.set(id, texture);
    }

    this.loaded = true;
    onProgress(1, this.fallbackIds.size === total ? 'Using placeholder art' : 'Assets ready');
    console.info(
      '[assets] loaded %d symbols (%d fallback placeholders)',
      this.textures.size,
      this.fallbackIds.size,
    );
    return this;
  }

  /**
   * @param {SymbolId|string} id
   * @returns {PIXI.Texture}
   */
  getTexture(id) {
    const tex = this.textures.get(/** @type {SymbolId} */ (id));
    if (tex) return tex;
    // Last-resort white pixel — should not happen after load()
    return this._PIXI?.Texture.WHITE ?? /** @type {any} */ (null);
  }

  /** @param {SymbolId|string} id */
  getDef(id) {
    return SYMBOL_DEFS[/** @type {SymbolId} */ (id)] ?? null;
  }

  /** @returns {SymbolId} */
  randomId() {
    return SYMBOL_IDS[(Math.random() * SYMBOL_IDS.length) | 0];
  }

  /** True when every symbol is a generated placeholder. */
  get usingFallbacksOnly() {
    return this.fallbackIds.size === SYMBOL_IDS.length;
  }
}

/** Shared instance — import this from game / reels. */
export const assets = new AssetManager();

export default assets;
