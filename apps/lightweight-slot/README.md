# Cyber Reels — Lightweight Slot

5×3 robotic / cyberpunk slot built on the `apps/lightweight-slot` Pixi.js template.

| Spec | Value |
|------|-------|
| Grid | 5 reels × 3 rows |
| Paylines | 20 fixed |
| Target RTP | **96%** (`TARGET_RTP = 0.96`) |
| Max win | **5000×** bet (`MAX_WIN_MULT = 5000`) |
| Renderer | Pixi.js v8 (CDN), WebGL, 60 FPS cap, DPR ≤ 1.5 |

## Run locally

From this folder:

```bash
npx serve
# or
npm run serve
```

Then open the URL printed by `serve` (default port **5179** via `npm run serve`).

Fallback without `npx`:

```bash
npm run serve:python
```

## Layout

```
apps/lightweight-slot/
  index.html              # boot shell + Pixi CDN
  package.json            # serve scripts
  assets/symbols/*.png    # lightweight robotic 2D symbols (~0.6–0.9 KB each)
  src/
    game.js               # bootstrap, HUD, spin loop
    reels.js              # 5×3 reel engine (pooled sprites)
    math.js               # RTP / paytable / evaluateSpin
    assets.js             # symbol loader + fallbacks
```

Math is pure JS — open the browser console and call `__SLOT__.evaluateSpin(1, 12345)` or `__SLOT__.getDesignParams()`.
