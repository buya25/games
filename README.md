# Games

Small browser games you can install on your phone as apps (PWAs).

## Neon Dash (`runner/`)

An endless runner on a neon highway. The game runs forward on its own; you steer and jump.

| Action | Phone | Keyboard |
|---|---|---|
| Steer | Drag your finger left / right | ← → or A / D |
| Jump | Tap, swipe up, or tap with a second finger | Space / ↑ / W |
| Pause | ❚❚ button | P / Esc |

Obstacles: pink **walls** (steer around them), yellow **barriers** (jump over them), gates, slaloms and,
further in, yellow **moving walls**. Coins are worth 10 points each, and speed keeps rising.

### Play locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/runner/
```

### Install on your phone

1. Open the GitHub Pages URL (`https://buya25.github.io/games/runner/`) on your phone.
2. **Android (Chrome):** tap *Install app* in the menu (or ⋮ → *Install app*).
   **iPhone (Safari):** tap Share → *Add to Home Screen*.
3. The game then opens full-screen from your home screen and works offline.

### Deploying

`.github/workflows/pages.yml` publishes the repo to GitHub Pages on every push.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

When you change game files, bump `VERSION` in `runner/sw.js` so installed copies refresh.
Icons are generated with `python3 runner/make_icons.py`.
