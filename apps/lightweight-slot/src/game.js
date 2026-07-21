/**
 * game.js — Main application bootstrap
 *
 * Wires AssetManager → ReelGridController → MathEngine with a SPIN button.
 */

import { assets } from './assets.js';
import { MathEngine } from './math.js';
import { ReelGridController } from './reels.js';

const DESIGN_WIDTH = 900;
const DESIGN_HEIGHT = 1600;
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
 * @param {number} ratio
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
  window.setTimeout(() => boot.remove(), 300);
}

/**
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
    cssH = vh;
    cssW = vh * designRatio;
  } else {
    cssW = vw;
    cssH = vw / designRatio;
  }

  const canvas = app.canvas;
  canvas.style.width = `${Math.floor(cssW)}px`;
  canvas.style.height = `${Math.floor(cssH)}px`;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  app.renderer.resolution = dpr;
  app.renderer.resize(DESIGN_WIDTH, DESIGN_HEIGHT);
}

/**
 * Bottom-center SPIN button + bet/win readout.
 * @param {typeof PIXI} PIXI
 * @param {PIXI.Container} parent
 * @param {{ onSpin: () => void, getBet: () => number, getLastWin: () => number }} api
 */
function createSpinButton(PIXI, parent, api) {
  const hud = new PIXI.Container();
  hud.eventMode = 'static';
  hud.label = 'HUD';

  const info = new PIXI.Text({
    text: '',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 26,
      fill: 0xc8d4e8,
      align: 'center',
    },
  });
  info.anchor.set(0.5, 0);
  info.eventMode = 'none';

  const btn = new PIXI.Container();
  btn.eventMode = 'static';
  btn.cursor = 'pointer';
  btn.label = 'SpinButton';

  const btnBg = new PIXI.Graphics();
  btnBg.roundRect(-130, -44, 260, 88, 16);
  btnBg.fill({ color: 0x3d8bfd });
  btnBg.stroke({ width: 3, color: 0xa8d0ff, alpha: 0.7 });
  btnBg.eventMode = 'none';

  const btnLabel = new PIXI.Text({
    text: 'SPIN',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 40,
      fontWeight: '800',
      fill: 0xffffff,
      letterSpacing: 6,
    },
  });
  btnLabel.anchor.set(0.5);
  btnLabel.eventMode = 'none';

  btn.addChild(btnBg, btnLabel);

  let busy = false;

  const setVisualBusy = (v) => {
    busy = v;
    btnBg.tint = v ? 0x7aa8d8 : 0xffffff;
    btnLabel.alpha = v ? 0.7 : 1;
  };

  btn.on('pointerdown', () => {
    if (!busy) btn.scale.set(0.96);
  });
  btn.on('pointerup', () => btn.scale.set(1));
  btn.on('pointerupoutside', () => btn.scale.set(1));
  btn.on('pointertap', () => {
    btn.scale.set(1);
    if (busy) return;
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
      info.position.set(stageW * 0.5, stageH - 290);
      btn.position.set(stageW * 0.5, stageH - 160);
    },
    refresh() {
      info.text = `Bet ${api.getBet().toFixed(2)}   ·   Win ${api.getLastWin().toFixed(2)}`;
    },
    setBusy: setVisualBusy,
  };
}

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
    antialias: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    resolution: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    autoDensity: true,
    roundPixels: false,
  });

  mount.appendChild(app.canvas);

  // --- Assets (images or coloured fallbacks) ---------------------------------
  await assets.load(PIXI, {
    onProgress: (ratio, label) => setBootProgress(0.1 + ratio * 0.75, label),
  });

  setBootProgress(0.9, 'Building stage…');

  const stageRoot = new PIXI.Container();
  stageRoot.eventMode = 'passive';
  stageRoot.label = 'StageRoot';
  app.stage.addChild(stageRoot);

  const atmosphere = new PIXI.Graphics();
  atmosphere.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  atmosphere.fill({ color: 0x101a2e });
  atmosphere.rect(0, 0, DESIGN_WIDTH, 180);
  atmosphere.fill({ color: 0x0b1220, alpha: 0.55 });
  atmosphere.rect(0, DESIGN_HEIGHT - 320, DESIGN_WIDTH, 320);
  atmosphere.fill({ color: 0x0b1220, alpha: 0.65 });
  stageRoot.addChild(atmosphere);

  const title = new PIXI.Text({
    text: 'CYBER REELS',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 44,
      fontWeight: '800',
      fill: 0xe8eef8,
      letterSpacing: 6,
    },
  });
  title.anchor.set(0.5, 0);
  title.position.set(DESIGN_WIDTH * 0.5, 64);
  title.eventMode = 'none';
  stageRoot.addChild(title);

  const subtitle = new PIXI.Text({
    text: assets.usingFallbacksOnly ? 'placeholder art · ready for textures' : 'assets loaded',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 18,
      fill: 0x7f92b0,
    },
  });
  subtitle.anchor.set(0.5, 0);
  subtitle.position.set(DESIGN_WIDTH * 0.5, 118);
  subtitle.eventMode = 'none';
  stageRoot.addChild(subtitle);

  const reels = new ReelGridController({ PIXI, parent: stageRoot });
  reels.centerIn(DESIGN_WIDTH, DESIGN_HEIGHT - 80);

  let bet = 1;
  let lastWin = 0;
  const rng = MathEngine.createRng((Date.now() ^ 0x9e3779b9) >>> 0);

  const hud = createSpinButton(PIXI, stageRoot, {
    getBet: () => bet,
    getLastWin: () => lastWin,
    onSpin: () => {
      if (reels.isSpinning) return;

      // 1) Resolve outcome from math engine (replace with RGS in production)
      const result = MathEngine.spin({ bet, rng });
      lastWin = 0;
      hud.refresh();
      hud.setBusy(true);

      // 2) Start staggered spin (reels 1→5), then stop on the target grid
      reels.spin({
        staggerMs: 100,
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

      // 3) Arm staggered stop onto the resolved symbol grid
      reels.stop(result.grid, {
        baseDelayMs: 550,
        staggerMs: 140,
      });
    },
  });
  hud.layout(DESIGN_WIDTH, DESIGN_HEIGHT);
  hud.refresh();

  const onResize = () => resizeToView(app);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  onResize();

  app.ticker.maxFPS = 60;
  app.ticker.minFPS = 30;
  app.ticker.add((ticker) => {
    reels.update(ticker.deltaMS);
  });

  setBootProgress(1, 'Ready');
  hideBoot();

  /** @type {any} */
  globalThis.__SLOT__ = { app, reels, math: MathEngine, assets };

  console.info(
    '[game] ready — %dx%d grid, fallbacks=%s',
    MathEngine.REEL_COUNT,
    MathEngine.ROW_COUNT,
    assets.usingFallbacksOnly,
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
