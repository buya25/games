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

### Maze Run

The second mode (🌀 MAZE RUN on the menu). The runner jogs through a randomly generated neon maze:

| Action | Phone | Keyboard |
|---|---|---|
| Turn at the next junction | Swipe left / right | ← → |
| Turn back | Swipe down | ↓ |
| Jump (barriers from maze 2) | Tap / swipe up | Space |

Corners with only one way turn by themselves; dead ends turn you round. At a T-junction the runner waits
(jogging on the spot, clock ticking) until you pick a way. Find the gold exit beam before time runs out;
the minimap fills in as you explore. Each cleared maze pays a coin bonus and the next one is bigger.
Coins, outfits and continues (+20 seconds) are shared with the endless mode. Maze code lives in
`runner/maze.js` (generation) and the Maze Run section of `runner/game.js`.

### Neon City

Coins from every run are saved in your wallet. Spend them in **Neon City** (menu button) to build and
upgrade an apartment, house, garage, night club, skyscraper and a billboard with your name. Everything
you build appears in the skyline behind the road while you run. Buildings and costs live in
`runner/city.js`.

### Outfits & trails

The shop also sells runner **outfits** (Hot Pink, Sunset Punk, DJ, Cyber Ninja, Golden King, Hologram)
and **trails** (Neon Streak, Fire Feet, Rainbow, Stardust, Lightning), with a live preview of your
runner. Definitions and drawing live in `runner/looks.js`.

### Power-ups & continues

Power-ups appear on the road between obstacles: **🧲 Magnet** (pulls in coins), **🛡️ Shield** (survive one
crash) and **×2 Double Coins**. Each can be upgraded in the shop's ⚡ Power tab to last longer.
After a crash you can pay coins to keep running (25, then 50, 100, … within the same run).
Coins go into your wallet the moment you collect them.

Progress (wallet, city, owned items) is stored on the device (`localStorage`).

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
