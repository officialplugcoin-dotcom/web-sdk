/**
 * game.js — Main application bootstrap
 *
 * Responsibilities:
 *  - Create the Pixi Application (WebGL, capped resolution for low-end Android)
 *  - Responsive letterbox resize (portrait mobile + landscape desktop)
 *  - Asset loader placeholder
 *  - Shared ticker loop (delta-time driven, no per-frame allocations)
 *  - Wire reels + math engine for a demo spin cycle
 */

import { MathEngine } from './math.js';
import { ReelGridController } from './reels.js';

/** Logical design resolution — canvas CSS size letterboxes around this. */
const DESIGN_WIDTH = 900;
const DESIGN_HEIGHT = 1600; // portrait-first; landscape still letterboxes cleanly

/** Cap devicePixelRatio to reduce fill-rate cost on high-DPI phones. */
const MAX_DPR = 2;

/**
 * @returns {typeof PIXI}
 */
function getPIXI() {
  const P = /** @type {typeof PIXI | undefined} */ (globalThis.PIXI);
  if (!P) {
    throw new Error('PIXI global missing — check the CDN script tag in index.html');
  }
  return P;
}

/**
 * Update the boot progress bar (DOM only during load — fine to allocate once).
 * @param {number} ratio 0..1
 * @param {string} [label]
 */
function setBootProgress(ratio, label) {
  const bar = document.getElementById('boot-progress');
  const boot = document.getElementById('boot');
  if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  if (boot && label) {
    const text = boot.querySelector('span');
    if (text) text.textContent = label;
  }
}

function hideBoot() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('is-hidden');
  // Remove after fade to free the node
  window.setTimeout(() => boot.remove(), 300);
}

/**
 * Asset loader placeholder.
 * Swap the empty manifest for real atlas / audio URLs when art is ready.
 * Uses Pixi Assets so texture uploads stay batched and cacheable.
 *
 * @param {typeof PIXI} PIXI
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadAssets(PIXI) {
  setBootProgress(0.1, 'Preparing assets…');

  // Example manifest shape — intentionally empty for this architecture stub.
  // When ready:
  //   PIXI.Assets.add({ alias: 'symbols', src: 'assets/symbols.json' });
  //   await PIXI.Assets.load(['symbols']);
  const manifest = {
    bundles: [
      {
        name: 'game',
        assets: [
          // { alias: 'symbols', src: './assets/symbols.webp' },
        ],
      },
    ],
  };

  // Init Assets with an empty bundle so the pipeline is wired for later use.
  try {
    if (manifest.bundles[0].assets.length > 0) {
      PIXI.Assets.addBundle('game', manifest.bundles[0].assets);
      setBootProgress(0.4, 'Loading textures…');
      await PIXI.Assets.loadBundle('game', (progress) => {
        setBootProgress(0.4 + progress * 0.5, 'Loading textures…');
      });
    } else {
      // Simulate a tiny async gate so the boot UI is exercisable without assets.
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (err) {
    console.warn('[assets] load skipped / failed — continuing with placeholders', err);
  }

  setBootProgress(0.95, 'Building stage…');
  return {};
}

/**
 * Fit the canvas into the viewport while preserving DESIGN aspect ratio
 * (letterbox / pillarbox — never stretch).
 *
 * @param {PIXI.Application} app
 */
function resizeToView(app) {
  const root = document.getElementById('game-root');
  if (!root) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const designRatio = DESIGN_WIDTH / DESIGN_HEIGHT;
  const viewRatio = vw / vh;

  let cssW;
  let cssH;
  if (viewRatio > designRatio) {
    // Viewport wider than design → pillarbox (fit height)
    cssH = vh;
    cssW = vh * designRatio;
  } else {
    // Viewport taller / narrower → letterbox (fit width) — typical mobile portrait
    cssW = vw;
    cssH = vw / designRatio;
  }

  const canvas = app.canvas;
  canvas.style.width = `${Math.floor(cssW)}px`;
  canvas.style.height = `${Math.floor(cssH)}px`;

  // Keep the renderer resolution in sync with CSS size × capped DPR
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  app.renderer.resolution = dpr;
  app.renderer.resize(DESIGN_WIDTH, DESIGN_HEIGHT);
}

/**
 * Build a lightweight HUD (bet / spin) using Pixi Text — no DOM overlay cost.
 * @param {typeof PIXI} PIXI
 * @param {PIXI.Container} parent
 * @param {{ onSpin: () => void, getBet: () => number, getLastWin: () => number }} api
 */
function createHud(PIXI, parent, api) {
  const hud = new PIXI.Container();
  hud.eventMode = 'static';
  hud.label = 'HUD';

  const info = new PIXI.Text({
    text: '',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 28,
      fill: 0xc8d4e8,
      align: 'center',
    },
  });
  info.anchor.set(0.5, 0);
  info.eventMode = 'none';

  const btn = new PIXI.Container();
  btn.eventMode = 'static';
  btn.cursor = 'pointer';

  const btnBg = new PIXI.Graphics();
  btnBg.roundRect(-110, -40, 220, 80, 14);
  btnBg.fill({ color: 0x5b9dff });
  btnBg.eventMode = 'none';

  const btnLabel = new PIXI.Text({
    text: 'SPIN',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 36,
      fontWeight: '700',
      fill: 0x0b1220,
    },
  });
  btnLabel.anchor.set(0.5);
  btnLabel.eventMode = 'none';

  btn.addChild(btnBg, btnLabel);

  let busy = false;
  btn.on('pointertap', () => {
    if (busy) return;
    busy = true;
    btnBg.tint = 0x88b8ff;
    api.onSpin();
  });

  hud.addChild(info, btn);
  parent.addChild(hud);

  return {
    /**
     * @param {number} stageW
     * @param {number} stageH
     */
    layout(stageW, stageH) {
      info.position.set(stageW * 0.5, stageH - 280);
      btn.position.set(stageW * 0.5, stageH - 160);
    },
    refresh() {
      info.text = `Bet ${api.getBet().toFixed(2)}   ·   Win ${api.getLastWin().toFixed(2)}`;
    },
    setBusy(v) {
      busy = v;
      btnBg.tint = v ? 0x88b8ff : 0xffffff;
    },
  };
}

/**
 * Application entry.
 */
async function main() {
  const PIXI = getPIXI();
  const mount = document.getElementById('game-root');
  if (!mount) throw new Error('#game-root missing');

  setBootProgress(0.05, 'Starting renderer…');

  const app = new PIXI.Application();
  await app.init({
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    background: 0x0b1220,
    antialias: false, // cheaper on Mali / PowerVR GPUs
    preference: 'webgl',
    powerPreference: 'high-performance',
    resolution: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    autoDensity: true,
    // Avoid roundPixels churn unless pixel-art assets demand it
    roundPixels: false,
  });

  mount.appendChild(app.canvas);

  await loadAssets(PIXI);

  // --- Stage graph ------------------------------------------------------------
  const stageRoot = new PIXI.Container();
  stageRoot.eventMode = 'passive';
  stageRoot.label = 'StageRoot';
  app.stage.addChild(stageRoot);

  // Soft vignette / atmosphere without filters (single Graphics fill)
  const atmosphere = new PIXI.Graphics();
  atmosphere.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  atmosphere.fill({ color: 0x101a2e });
  // Subtle radial feel via overlapping cheap rects — no shaders
  atmosphere.rect(0, 0, DESIGN_WIDTH, 180);
  atmosphere.fill({ color: 0x0b1220, alpha: 0.55 });
  atmosphere.rect(0, DESIGN_HEIGHT - 320, DESIGN_WIDTH, 320);
  atmosphere.fill({ color: 0x0b1220, alpha: 0.65 });
  stageRoot.addChild(atmosphere);

  const title = new PIXI.Text({
    text: 'LIGHTWEIGHT SLOT',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 42,
      fontWeight: '700',
      fill: 0xe8eef8,
      letterSpacing: 4,
    },
  });
  title.anchor.set(0.5, 0);
  title.position.set(DESIGN_WIDTH * 0.5, 72);
  title.eventMode = 'none';
  stageRoot.addChild(title);

  const reels = new ReelGridController({ PIXI, parent: stageRoot });
  reels.centerIn(DESIGN_WIDTH, DESIGN_HEIGHT - 80);

  // --- Game state (mutable scalars only — avoid object churn) -----------------
  let bet = 1;
  let lastWin = 0;
  const rng = MathEngine.createRng((Date.now() ^ 0x9e3779b9) >>> 0);

  const hud = createHud(PIXI, stageRoot, {
    getBet: () => bet,
    getLastWin: () => lastWin,
    onSpin: () => {
      if (reels.isSpinning) return;
      const result = MathEngine.spin({ bet, rng });
      lastWin = 0;
      hud.refresh();
      hud.setBusy(true);

      reels.spinTo(result.grid, {
        onComplete: () => {
          lastWin = result.totalWin;
          hud.refresh();
          hud.setBusy(false);
          if (result.totalWin > 0) {
            console.info(
              '[math] win',
              result.totalWin,
              result.lineWins.map((w) => `L${w.lineIndex}:${w.symbol}x${w.count}`).join(', '),
            );
          }
        },
      });
    },
  });
  hud.layout(DESIGN_WIDTH, DESIGN_HEIGHT);
  hud.refresh();

  // --- Resize -----------------------------------------------------------------
  const onResize = () => resizeToView(app);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  onResize();

  // --- Ticker: single shared loop, deltaMS for frame-rate independence --------
  // Pixi ticker already supplies deltaMS / deltaTime — do not nest rAF loops.
  app.ticker.maxFPS = 60;
  app.ticker.minFPS = 30;
  app.ticker.add((ticker) => {
    // deltaMS is ms since last frame — keeps spin speed stable at 30–60 FPS
    const deltaMS = ticker.deltaMS;
    reels.update(deltaMS);
  });

  setBootProgress(1, 'Ready');
  hideBoot();

  // Expose a tiny debug handle for QA (optional)
  /** @type {any} */
  globalThis.__SLOT__ = {
    app,
    reels,
    math: MathEngine,
    spin: () => hud /* trigger via UI */,
  };

  console.info(
    '[game] ready — design %dx%d, dpr capped at %d, reels %dx%d',
    DESIGN_WIDTH,
    DESIGN_HEIGHT,
    MAX_DPR,
    MathEngine.REEL_COUNT,
    MathEngine.ROW_COUNT,
  );
}

main().catch((err) => {
  console.error('[game] fatal', err);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.remove('is-hidden');
    const text = boot.querySelector('span');
    if (text) text.textContent = 'Failed to start — see console';
  }
});
