/**
 * game.js — Robo 5000 by Limitless Studio
 *
 * Splash → Asset load → 5×5 high-vol slot with Stake-style controls:
 * bet ±, ante (3×), buy bonus (100×), super buy (300×), demo balance.
 */

import { assets } from './assets.js';
import { MathEngine } from './math.js';
import { ReelGridController } from './reels.js';
import { sfx } from './audio.js';

const DESIGN_WIDTH = 900;
const DESIGN_HEIGHT = 1600;
const MAX_DPR = 1.5;
const FONT = 'Orbitron, system-ui, sans-serif';
const START_BALANCE = 1000;

function getPIXI() {
  const P = /** @type {typeof PIXI | undefined} */ (globalThis.PIXI);
  if (!P) throw new Error('PIXI global missing — check CDN script in index.html');
  return P;
}

function setSplashProgress(ratio, label) {
  const bar = document.getElementById('splash-progress');
  const status = document.getElementById('splash-status');
  if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  if (status && label) status.textContent = label;
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('is-hidden');
  window.setTimeout(() => splash.remove(), 450);
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

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

function nextSeed(seed) {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + 0x7f4a7c15) >>> 0;
}

/**
 * Build interactive HUD (header + controls).
 * @param {typeof PIXI} PIXI
 * @param {PIXI.Container} parent
 * @param {object} api
 */
function createHUD(PIXI, parent, api) {
  const root = new PIXI.Container();
  root.eventMode = 'static';
  root.label = 'HUD';
  parent.addChild(root);

  // --- Header plate ---------------------------------------------------------
  const headerBg = new PIXI.Graphics();
  headerBg.roundRect(24, 28, DESIGN_WIDTH - 48, 148, 14);
  headerBg.fill({ color: 0x071018, alpha: 0.92 });
  headerBg.stroke({ width: 2, color: 0x00d4ff, alpha: 0.55 });
  headerBg.eventMode = 'none';
  root.addChild(headerBg);

  /** @type {PIXI.Sprite|null} */
  let logoSprite = null;
  if (assets.brandLogo) {
    logoSprite = new PIXI.Sprite(assets.brandLogo);
    logoSprite.anchor.set(0, 0.5);
    logoSprite.position.set(44, 78);
    logoSprite.width = 200;
    logoSprite.height = 60;
    logoSprite.eventMode = 'none';
    root.addChild(logoSprite);
  } else {
    const studio = new PIXI.Text({
      text: 'LIMITLESS STUDIO',
      style: { fontFamily: FONT, fontSize: 16, fill: 0x7ee8ff, letterSpacing: 2 },
    });
    studio.position.set(48, 48);
    studio.eventMode = 'none';
    root.addChild(studio);
  }

  const title = new PIXI.Text({
    text: 'ROBO 5000',
    style: {
      fontFamily: FONT,
      fontSize: 42,
      fontWeight: '800',
      fill: 0xe8fbff,
      letterSpacing: 4,
    },
  });
  title.anchor.set(1, 0);
  title.position.set(DESIGN_WIDTH - 48, 44);
  title.eventMode = 'none';
  root.addChild(title);

  const meta = new PIXI.Text({
    text: `RTP ${Math.round(MathEngine.TARGET_RTP * 100)}%  ·  MAX WIN ${MathEngine.MAX_WIN_MULT}×  ·  HIGH VOL`,
    style: { fontFamily: FONT, fontSize: 13, fill: 0x5aa8c0, letterSpacing: 1 },
  });
  meta.anchor.set(1, 0);
  meta.position.set(DESIGN_WIDTH - 48, 96);
  meta.eventMode = 'none';
  root.addChild(meta);

  const balanceText = new PIXI.Text({
    text: '',
    style: { fontFamily: FONT, fontSize: 18, fill: 0xffe566, letterSpacing: 1 },
  });
  balanceText.position.set(48, 128);
  balanceText.eventMode = 'none';
  root.addChild(balanceText);

  // --- Win banner -----------------------------------------------------------
  const winBanner = new PIXI.Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: 32,
      fontWeight: '800',
      fill: 0xffe566,
      align: 'center',
      letterSpacing: 2,
    },
  });
  winBanner.anchor.set(0.5, 0);
  winBanner.position.set(DESIGN_WIDTH * 0.5, 1180);
  winBanner.eventMode = 'none';
  winBanner.visible = false;
  root.addChild(winBanner);

  // --- Control dock ---------------------------------------------------------
  const dockY = 1260;
  const dock = new PIXI.Graphics();
  dock.roundRect(24, dockY, DESIGN_WIDTH - 48, 300, 16);
  dock.fill({ color: 0x071018, alpha: 0.94 });
  dock.stroke({ width: 2, color: 0x00d4ff, alpha: 0.4 });
  dock.eventMode = 'none';
  root.addChild(dock);

  const infoLine = new PIXI.Text({
    text: '',
    style: { fontFamily: FONT, fontSize: 16, fill: 0x7ee8ff, align: 'center' },
  });
  infoLine.anchor.set(0.5, 0);
  infoLine.position.set(DESIGN_WIDTH * 0.5, dockY + 18);
  infoLine.eventMode = 'none';
  root.addChild(infoLine);

  /**
   * @param {string} label
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number} fill
   * @param {number} stroke
   * @param {() => void} onTap
   */
  function makeButton(label, x, y, w, h, fill, stroke, onTap) {
    const btn = new PIXI.Container();
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.position.set(x, y);

    const bg = new PIXI.Graphics();
    bg.roundRect(-w / 2, -h / 2, w, h, 10);
    bg.fill({ color: fill });
    bg.stroke({ width: 2, color: stroke, alpha: 0.85 });
    bg.eventMode = 'none';

    const text = new PIXI.Text({
      text: label,
      style: {
        fontFamily: FONT,
        fontSize: Math.min(22, Math.floor(w / (label.length * 0.55))),
        fontWeight: '800',
        fill: 0xe8fbff,
        align: 'center',
      },
    });
    text.anchor.set(0.5);
    text.eventMode = 'none';

    btn.addChild(bg, text);
    let disabled = false;

    btn.on('pointerdown', () => {
      if (!disabled) btn.scale.set(0.96);
    });
    btn.on('pointerup', () => btn.scale.set(1));
    btn.on('pointerupoutside', () => btn.scale.set(1));
    btn.on('pointertap', () => {
      btn.scale.set(1);
      if (disabled) return;
      sfx.click();
      onTap();
    });

    root.addChild(btn);
    return {
      setLabel(v) {
        text.text = v;
      },
      setDisabled(v) {
        disabled = v;
        bg.tint = v ? 0x667788 : 0xffffff;
        text.alpha = v ? 0.55 : 1;
        btn.cursor = v ? 'default' : 'pointer';
      },
      setActive(v) {
        bg.tint = v ? 0xa0ffe0 : 0xffffff;
      },
      bg,
      text,
    };
  }

  const cy = dockY + 100;
  const betMinus = makeButton('−', 90, cy, 64, 56, 0x0a3040, 0x00d4ff, () => api.adjustBet(-1));
  const betPlus = makeButton('+', 310, cy, 64, 56, 0x0a3040, 0x00d4ff, () => api.adjustBet(1));

  const betLabel = new PIXI.Text({
    text: '',
    style: { fontFamily: FONT, fontSize: 20, fill: 0xe8fbff, align: 'center' },
  });
  betLabel.anchor.set(0.5);
  betLabel.position.set(200, cy);
  betLabel.eventMode = 'none';
  root.addChild(betLabel);

  const anteBtn = makeButton('ANTE\n3×', 430, cy, 100, 64, 0x2a1030, 0xff3cc8, () =>
    api.toggleAnte(),
  );
  const buyBtn = makeButton('BUY\n100×', 560, cy, 100, 64, 0x103020, 0x28ff78, () =>
    api.buyBonus('free'),
  );
  const superBtn = makeButton('SUPER\n300×', 700, cy, 110, 64, 0x302010, 0xffd228, () =>
    api.buyBonus('super'),
  );
  const spinBtn = makeButton('SPIN', DESIGN_WIDTH * 0.5, dockY + 210, 280, 88, 0x067a96, 0x00d4ff, () =>
    api.onSpin(),
  );

  let busy = false;

  return {
    refresh() {
      balanceText.text = `DEMO  ${money(api.getBalance())}`;
      betLabel.text = money(api.getBet());
      const fs = api.getFreeSpins();
      const mode = api.getModeLabel();
      const cost = api.getSpinCost();
      infoLine.text =
        fs > 0
          ? `${mode}  ·  FREE SPINS ${fs}  ·  LAST WIN ${money(api.getLastWin())}`
          : `${mode}  ·  COST ${money(cost)}  ·  WIN ${money(api.getLastWin())}`;
      anteBtn.setActive(api.isAnte());
      anteBtn.setLabel(api.isAnte() ? 'ANTE\nON' : 'ANTE\n3×');
    },
    showWin(amount, opts = {}) {
      if (amount > 0) {
        let msg = `WIN ${money(amount)}`;
        if (opts.capped) msg += '  CAP';
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
    setBusy(v) {
      busy = v;
      spinBtn.setDisabled(v);
      betMinus.setDisabled(v || api.getFreeSpins() > 0);
      betPlus.setDisabled(v || api.getFreeSpins() > 0);
      anteBtn.setDisabled(v || api.getFreeSpins() > 0);
      buyBtn.setDisabled(v || api.getFreeSpins() > 0);
      superBtn.setDisabled(v || api.getFreeSpins() > 0);
      spinBtn.setLabel(api.getFreeSpins() > 0 ? 'FREE' : 'SPIN');
      spinBtn.bg.tint = v ? 0x7aa8d8 : 0xffffff;
    },
    isBusy: () => busy,
  };
}

async function main() {
  const PIXI = getPIXI();
  const mount = document.getElementById('game-root');
  if (!mount) throw new Error('#game-root missing');

  setSplashProgress(0.06, 'Booting renderer…');

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
    onProgress: (ratio, label) => setSplashProgress(0.08 + ratio * 0.82, label),
  });

  setSplashProgress(0.94, 'Assembling Robo 5000…');

  const stageRoot = new PIXI.Container();
  stageRoot.eventMode = 'passive';
  stageRoot.label = 'StageRoot';
  app.stage.addChild(stageRoot);

  const atmosphere = new PIXI.Graphics();
  atmosphere.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  atmosphere.fill({ color: 0x081420 });
  // subtle neon rails
  atmosphere.rect(0, 190, DESIGN_WIDTH, 2);
  atmosphere.fill({ color: 0x00d4ff, alpha: 0.25 });
  atmosphere.rect(0, 1168, DESIGN_WIDTH, 2);
  atmosphere.fill({ color: 0xff3cc8, alpha: 0.2 });
  stageRoot.addChild(atmosphere);

  // --- Session state --------------------------------------------------------
  let balance = START_BALANCE;
  let bet = 1;
  let ante = false;
  let lastWin = 0;
  let freeSpinsRemaining = 0;
  /** @type {'free'|'super'|null} */
  let freeMode = null;
  /** @type {Array<{ reel: number, row: number, mult: number }>} */
  let stickyWilds = [];
  let freeSpinParentSeed = 0;
  let freeSpinIndex = 0;
  let spinSeed = (Date.now() ^ 0x9e3779b9) >>> 0;
  /** @type {ReturnType<typeof createHUD>} */
  let hud;

  const reels = new ReelGridController({
    PIXI,
    parent: stageRoot,
    onReelLand: (i) => sfx.reelStop(i),
  });
  reels.centerIn(DESIGN_WIDTH, 1280);
  // Nudge board under header
  reels.root.y = Math.round((1100 - reels.height) * 0.5 + 40);

  function spinCost() {
    if (freeSpinsRemaining > 0) return 0;
    return ante ? bet * MathEngine.ANTE_MULT : bet;
  }

  function modeLabel() {
    if (freeSpinsRemaining > 0) {
      return freeMode === 'super' ? 'SUPER FS' : 'FREE SPINS';
    }
    return ante ? 'ANTE BET' : 'BASE';
  }

  /**
   * @param {ReturnType<typeof MathEngine.evaluateSpin>} result
   * @param {boolean} isFree
   */
  function playResolvedSpin(result, isFree) {
    lastWin = 0;
    hud.hideWin();
    reels.clearHighlights();
    hud.refresh();
    hud.setBusy(true);
    sfx.spinStart();

    reels.spin({
      staggerMs: 90,
      onComplete: () => {
        lastWin = result.totalWin;
        if (result.totalWin > 0) {
          balance = Math.round((balance + result.totalWin) * 100) / 100;
          sfx.win(result.totalWin >= bet * 20);
        }
        if (result.isFreeSpinTriggered) sfx.bonus();

        hud.refresh();
        hud.showWin(result.totalWin, {
          freeSpins: result.isFreeSpinTriggered,
          capped: result.winCapped,
        });
        reels.highlightWins(result.winningLines);
        hud.setBusy(false);

        if (result.winningLines.length) {
          console.info(
            '[robo5000]',
            result.mode,
            'win',
            result.totalWin,
            result.winningLines
              .filter((w) => w.lineIndex >= 0)
              .map((w) => `L${w.lineIndex}:${w.symbol}x${w.count}${w.multiplier > 1 ? `@${w.multiplier}` : ''}`)
              .join(', '),
          );
        }

        if (freeSpinsRemaining > 0) {
          window.setTimeout(() => {
            if (!reels.isSpinning) triggerSpin();
          }, 700);
        }
      },
    });

    reels.stop(result.grid, result.wildMults, {
      baseDelayMs: 520,
      staggerMs: 130,
    });
  }

  function triggerSpin() {
    if (reels.isSpinning || hud.isBusy()) return;

    const inFree = freeSpinsRemaining > 0;
    /** @type {ReturnType<typeof MathEngine.evaluateSpin>} */
    let result;

    if (inFree) {
      freeSpinsRemaining -= 1;
      const seed = MathEngine.freeSpinSeed(freeSpinParentSeed, freeSpinIndex++);
      const mode = freeMode === 'super' ? 'super' : 'free';
      result = MathEngine.evaluateSpin(bet, seed, {
        mode,
        stickyWilds: mode === 'super' ? stickyWilds : [],
        cost: 0,
      });
      if (mode === 'super') stickyWilds = result.stickyWilds;
    } else {
      const cost = spinCost();
      if (balance < cost) {
        hud.showWin(0);
        console.warn('[robo5000] insufficient demo balance');
        return;
      }
      balance = Math.round((balance - cost) * 100) / 100;
      spinSeed = nextSeed(spinSeed);
      result = MathEngine.evaluateSpin(bet, spinSeed, {
        mode: ante ? 'ante' : 'base',
        cost,
      });
    }

    if (result.isFreeSpinTriggered) {
      if (!inFree) {
        freeSpinParentSeed = result.seed;
        freeSpinIndex = 0;
        freeMode = 'free';
        stickyWilds = [];
      }
      freeSpinsRemaining += result.freeSpinsAwarded;
    }

    hud.refresh();
    playResolvedSpin(result, inFree);
  }

  /**
   * @param {'free'|'super'} kind
   */
  function buyBonus(kind) {
    if (reels.isSpinning || hud.isBusy() || freeSpinsRemaining > 0) return;
    const mult = kind === 'super' ? MathEngine.SUPER_BUY_MULT : MathEngine.BUY_BONUS_MULT;
    const cost = bet * mult;
    if (balance < cost) {
      console.warn('[robo5000] cannot afford bonus buy', money(cost));
      return;
    }
    balance = Math.round((balance - cost) * 100) / 100;
    spinSeed = nextSeed(spinSeed);
    const result = MathEngine.evaluateBonusPurchase(bet, spinSeed, kind);
    freeSpinParentSeed = result.seed;
    freeSpinIndex = 0;
    freeMode = kind;
    stickyWilds = [];
    freeSpinsRemaining += result.freeSpinsAwarded;
    ante = false;
    hud.refresh();
    sfx.bonus();
    playResolvedSpin(result, false);
  }

  hud = createHUD(PIXI, stageRoot, {
    getBalance: () => balance,
    getBet: () => bet,
    getLastWin: () => lastWin,
    getFreeSpins: () => freeSpinsRemaining,
    getSpinCost: () => spinCost(),
    getModeLabel: () => modeLabel(),
    isAnte: () => ante,
    adjustBet: (dir) => {
      if (hud.isBusy() || freeSpinsRemaining > 0) return;
      bet = MathEngine.nextBet(bet, dir);
      hud.refresh();
    },
    toggleAnte: () => {
      if (hud.isBusy() || freeSpinsRemaining > 0) return;
      ante = !ante;
      hud.refresh();
    },
    buyBonus,
    onSpin: () => {
      sfx.unlock();
      if (freeSpinsRemaining > 0) return;
      triggerSpin();
    },
  });
  hud.refresh();
  hud.setBusy(false);

  const onResize = () => resizeToView(app);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  onResize();

  // Unlock audio on first pointer
  window.addEventListener(
    'pointerdown',
    () => {
      sfx.unlock();
    },
    { once: true },
  );

  app.ticker.maxFPS = 60;
  app.ticker.minFPS = 30;
  app.ticker.add((ticker) => {
    reels.update(ticker.deltaMS);
  });

  setSplashProgress(1, 'Ready');
  hideSplash();

  /** @type {any} */
  globalThis.__SLOT__ = {
    app,
    reels,
    math: MathEngine,
    assets,
    evaluateSpin: MathEngine.evaluateSpin,
    getDesignParams: MathEngine.getDesignParams,
    getBalance: () => balance,
  };

  console.info(
    '[robo5000] ready — %s by %s · %dx%d · RTP %s%% · max %dx',
    MathEngine.getDesignParams().title,
    MathEngine.getDesignParams().studio,
    MathEngine.REEL_COUNT,
    MathEngine.ROW_COUNT,
    Math.round(MathEngine.TARGET_RTP * 100),
    MathEngine.MAX_WIN_MULT,
  );
}

main().catch((err) => {
  console.error('[robo5000] fatal', err);
  const status = document.getElementById('splash-status');
  if (status) status.textContent = 'Failed to start — see console';
});
