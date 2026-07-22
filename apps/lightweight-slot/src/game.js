/**
 * game.js — Main application bootstrap
 *
 * Wires AssetManager → MathEngine.evaluateSpin → ReelGridController
 * with a bottom-center SPIN button and on-screen win display.
 *
 * Theme: robotic / cyberpunk 2D — neon HUD on dark chassis.
 * Perf: WebGL, antialias off, DPR capped, ticker capped at 60 FPS.
 */

import { assets } from './assets.js';
import { MathEngine } from './math.js';
import { ReelGridController } from './reels.js';

const DESIGN_WIDTH = 900;
const DESIGN_HEIGHT = 1600;
/** Cap device pixel ratio for low-end mobile GPUs. */
const MAX_DPR = 1.5;
const FONT = 'Orbitron, system-ui, sans-serif';

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
  const status = document.getElementById('boot-status');
  if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  if (status && label) status.textContent = label;
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
 * Bottom-center SPIN button + bet / win / free-spin readout.
 * @param {typeof PIXI} PIXI
 * @param {PIXI.Container} parent
 * @param {{
 *   onSpin: () => void,
 *   getBet: () => number,
 *   getLastWin: () => number,
 *   getFreeSpins: () => number,
 * }} api
 */
function createSpinButton(PIXI, parent, api) {
  const hud = new PIXI.Container();
  hud.eventMode = 'static';
  hud.label = 'HUD';

  const info = new PIXI.Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: 22,
      fill: 0x7ee8ff,
      align: 'center',
      letterSpacing: 1,
    },
  });
  info.anchor.set(0.5, 0);
  info.eventMode = 'none';

  const winBanner = new PIXI.Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: 34,
      fontWeight: '800',
      fill: 0xffe566,
      align: 'center',
      letterSpacing: 2,
    },
  });
  winBanner.anchor.set(0.5, 0);
  winBanner.eventMode = 'none';
  winBanner.visible = false;

  const btn = new PIXI.Container();
  btn.eventMode = 'static';
  btn.cursor = 'pointer';
  btn.label = 'SpinButton';

  const btnBg = new PIXI.Graphics();
  btnBg.roundRect(-130, -44, 260, 88, 10);
  btnBg.fill({ color: 0x067a96 });
  btnBg.stroke({ width: 3, color: 0x00d4ff, alpha: 0.85 });
  // Corner tech notches (cheap cyber chrome)
  btnBg.moveTo(-118, -44);
  btnBg.lineTo(-130, -32);
  btnBg.stroke({ width: 2, color: 0x7ee8ff, alpha: 0.9 });
  btnBg.moveTo(118, 44);
  btnBg.lineTo(130, 32);
  btnBg.stroke({ width: 2, color: 0x7ee8ff, alpha: 0.9 });
  btnBg.eventMode = 'none';

  const btnLabel = new PIXI.Text({
    text: 'SPIN',
    style: {
      fontFamily: FONT,
      fontSize: 36,
      fontWeight: '800',
      fill: 0xe8fbff,
      letterSpacing: 8,
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

  hud.addChild(info, winBanner, btn);
  parent.addChild(hud);

  return {
    /**
     * @param {number} stageW
     * @param {number} stageH
     */
    layout(stageW, stageH) {
      winBanner.position.set(stageW * 0.5, stageH - 360);
      info.position.set(stageW * 0.5, stageH - 290);
      btn.position.set(stageW * 0.5, stageH - 160);
    },
    refresh() {
      const fs = api.getFreeSpins();
      const fsPart = fs > 0 ? `   ·   FS ${fs}` : '';
      info.text = `Bet ${api.getBet().toFixed(2)}   ·   Win ${api.getLastWin().toFixed(2)}${fsPart}`;
    },
    /**
     * @param {number} amount
     * @param {{ freeSpins?: boolean, capped?: boolean }} [opts]
     */
    showWin(amount, opts = {}) {
      if (amount > 0) {
        let msg = `WIN ${amount.toFixed(2)}`;
        if (opts.capped) msg += ' (CAP)';
        if (opts.freeSpins) msg += '  ·  FREE SPINS!';
        winBanner.text = msg;
        winBanner.visible = true;
      } else if (opts.freeSpins) {
        winBanner.text = 'FREE SPINS TRIGGERED!';
        winBanner.visible = true;
      } else {
        winBanner.visible = false;
      }
    },
    hideWin() {
      winBanner.visible = false;
    },
    setBusy: setVisualBusy,
    /** @param {string} label */
    setButtonLabel(label) {
      btnLabel.text = label;
    },
  };
}

/**
 * Advance a mutable seed for the next paid spin (deterministic stream).
 * @param {number} seed
 */
function nextSeed(seed) {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + 0x7f4a7c15) >>> 0;
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
    background: 0x050b14,
    antialias: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    resolution: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    autoDensity: true,
    roundPixels: true,
  });

  mount.appendChild(app.canvas);

  await assets.load(PIXI, {
    onProgress: (ratio, label) => setBootProgress(0.1 + ratio * 0.75, label),
  });

  setBootProgress(0.9, 'Building stage…');

  const stageRoot = new PIXI.Container();
  stageRoot.eventMode = 'passive';
  stageRoot.label = 'StageRoot';
  app.stage.addChild(stageRoot);

  // Chassis atmosphere — few Graphics fills, no filters / particles
  const atmosphere = new PIXI.Graphics();
  atmosphere.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  atmosphere.fill({ color: 0x0a1624 });
  // Top / bottom vignette panels
  atmosphere.rect(0, 0, DESIGN_WIDTH, 200);
  atmosphere.fill({ color: 0x050b14, alpha: 0.72 });
  atmosphere.rect(0, DESIGN_HEIGHT - 340, DESIGN_WIDTH, 340);
  atmosphere.fill({ color: 0x050b14, alpha: 0.78 });
  // Soft neon rail under title
  atmosphere.rect(DESIGN_WIDTH * 0.18, 156, DESIGN_WIDTH * 0.64, 2);
  atmosphere.fill({ color: 0x00d4ff, alpha: 0.55 });
  atmosphere.rect(DESIGN_WIDTH * 0.28, 160, DESIGN_WIDTH * 0.44, 1);
  atmosphere.fill({ color: 0x7ee8ff, alpha: 0.35 });
  stageRoot.addChild(atmosphere);

  const title = new PIXI.Text({
    text: 'CYBER REELS',
    style: {
      fontFamily: FONT,
      fontSize: 46,
      fontWeight: '800',
      fill: 0xe8fbff,
      letterSpacing: 8,
    },
  });
  title.anchor.set(0.5, 0);
  title.position.set(DESIGN_WIDTH * 0.5, 58);
  title.eventMode = 'none';
  stageRoot.addChild(title);

  const subtitle = new PIXI.Text({
    text: `20 LINES  ·  RTP ${Math.round(MathEngine.TARGET_RTP * 100)}%  ·  MAX ${MathEngine.MAX_WIN_MULT}×`,
    style: {
      fontFamily: FONT,
      fontSize: 15,
      fill: 0x5aa8c0,
      letterSpacing: 1,
    },
  });
  subtitle.anchor.set(0.5, 0);
  subtitle.position.set(DESIGN_WIDTH * 0.5, 118);
  subtitle.eventMode = 'none';
  stageRoot.addChild(subtitle);

  const reels = new ReelGridController({ PIXI, parent: stageRoot });
  reels.centerIn(DESIGN_WIDTH, DESIGN_HEIGHT - 80);

  // --- Session state ----------------------------------------------------------
  let bet = 1;
  let lastWin = 0;
  let freeSpinsRemaining = 0;
  let freeSpinParentSeed = 0;
  let freeSpinIndex = 0;
  let spinSeed = (Date.now() ^ 0x9e3779b9) >>> 0;

  /** @type {ReturnType<typeof createSpinButton>} */
  let hud;

  /**
   * Run one resolved spin through the reel engine.
   * @param {ReturnType<typeof MathEngine.evaluateSpin>} result
   * @param {boolean} isFree
   */
  function playResolvedSpin(result, isFree) {
    lastWin = 0;
    hud.hideWin();
    reels.clearHighlights();
    hud.refresh();
    hud.setBusy(true);
    hud.setButtonLabel(isFree ? 'FREE' : 'SPIN');

    reels.spin({
      staggerMs: 100,
      onComplete: () => {
        lastWin = result.totalWin;
        hud.refresh();
        hud.showWin(result.totalWin, {
          freeSpins: result.isFreeSpinTriggered,
          capped: result.winCapped,
        });
        reels.highlightWins(result.winningLines);
        hud.setBusy(false);
        hud.setButtonLabel(freeSpinsRemaining > 0 ? 'FREE' : 'SPIN');

        if (result.winningLines.length > 0) {
          console.info(
            '[math] win',
            result.totalWin,
            result.winningLines
              .filter((w) => w.lineIndex >= 0)
              .map((w) => `L${w.lineIndex}:${w.symbol}x${w.count}`)
              .join(', '),
            result.isFreeSpinTriggered ? `+${result.freeSpinsAwarded} FS` : '',
          );
        }

        // Auto-continue free spins after a short beat
        if (freeSpinsRemaining > 0) {
          window.setTimeout(() => {
            if (!reels.isSpinning) triggerSpin();
          }, 650);
        }
      },
    });

    reels.stop(result.grid, {
      baseDelayMs: 550,
      staggerMs: 140,
    });
  }

  function triggerSpin() {
    if (reels.isSpinning) return;

    const inFreeSpin = freeSpinsRemaining > 0;
    let result;

    if (inFreeSpin) {
      freeSpinsRemaining -= 1;
      const seed = MathEngine.freeSpinSeed(freeSpinParentSeed, freeSpinIndex++);
      // Free spins use the same bet for paytable scaling (no extra wager)
      result = MathEngine.evaluateSpin(bet, seed);
    } else {
      spinSeed = nextSeed(spinSeed);
      result = MathEngine.evaluateSpin(bet, spinSeed);
    }

    if (result.isFreeSpinTriggered) {
      if (!inFreeSpin) {
        freeSpinParentSeed = result.seed;
        freeSpinIndex = 0;
      }
      freeSpinsRemaining += result.freeSpinsAwarded;
    }

    hud.refresh();
    playResolvedSpin(result, inFreeSpin);
  }

  hud = createSpinButton(PIXI, stageRoot, {
    getBet: () => bet,
    getLastWin: () => lastWin,
    getFreeSpins: () => freeSpinsRemaining,
    onSpin: () => {
      // During free spins the auto-loop drives play; manual press is ignored while busy
      if (freeSpinsRemaining > 0 && reels.isSpinning) return;
      if (freeSpinsRemaining > 0) return; // wait for auto-continue
      triggerSpin();
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
  globalThis.__SLOT__ = {
    app,
    reels,
    math: MathEngine,
    assets,
    evaluateSpin: MathEngine.evaluateSpin,
    getDesignParams: MathEngine.getDesignParams,
  };

  console.info(
    '[game] ready — %d lines, max %dx, target RTP %s%%',
    MathEngine.LINE_COUNT,
    MathEngine.MAX_WIN_MULT,
    Math.round(MathEngine.TARGET_RTP * 100),
  );
}

main().catch((err) => {
  console.error('[game] fatal', err);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.remove('is-hidden');
    const status = document.getElementById('boot-status');
    if (status) status.textContent = 'Failed to start — see console';
  }
});
