# Robo 5000 — Limitless Studio

Production-ready **5×5 high-volatility** cyberpunk slot built on the lightweight Pixi.js template.

| Spec | Value |
|------|-------|
| Grid | **5 reels × 5 rows** |
| Paylines | 20 fixed (L→R) |
| Volatility | High |
| RTP | **96%** |
| Max win | **5000×** bet |
| Studio | Limitless Studio |

## Features

- Animated **Limitless Studio** splash + neon load bar
- Demo balance **$1,000.00** with live debit/credit
- Bet ladder **$0.20 – $100.00** (`+` / `−`)
- **Ante (3×)** — boosted scatter rates
- **Buy Bonus (100×)** — 10 Free Spins
- **Super Buy (300×)** — Super Free Spins with **sticky wild multipliers** (2×–100×)
- Functional spin with stagger stop, SFX cues, win highlights
- Royalty-free procedural cyberpunk symbols (compact PNGs)

## Run locally

```bash
cd apps/lightweight-slot
npx serve
# or
npm run serve   # http://localhost:5179
```

## Layout

```
apps/lightweight-slot/
  index.html
  package.json
  assets/
    brand/limitless-studio.png
    symbols/*.png
  src/
    game.js      # splash handoff, HUD, balance, buys
    reels.js     # 5×5 reel engine
    math.js      # high-vol math + ante/buy/super
    assets.js    # texture loader
    audio.js     # Web Audio cues
```

Debug API (browser console): `__SLOT__.getDesignParams()`, `__SLOT__.evaluateSpin(1, 42)`.
