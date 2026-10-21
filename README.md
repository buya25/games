# Games

Small browser games you can install on your phone as one app, **Neon Arcade** (a PWA).

## Neon Arcade (launcher)

The first page (`index.html`, `arcade.css`, `arcade.js`) lists the games as cards and greets you with your
own runner, your coins and your best scores. Each card opens a game straight into its mode
(`runner/?play=endless|maze|race`). The installed app opens on this launcher; one service worker
(`sw.js`) caches the launcher and every game for offline play. To add a game, put it in its own folder,
add a card to `index.html`, and add its files to `FILES` in `sw.js`.

## Neon Tycoon (`market/`)

A market and business sim over a 120-day season, saved on the phone so you can play it over many
sessions. Trade goods across five districts (prices react to your own big trades), build stalls,
shops and megastores that sell for you every day, and workshops, factories and plants that make goods
at 40% of their price (pair one with a stall on the same product in the same district and it keeps the
stall stocked). Play the Neon Exchange, manage savings and a loan, and react to daily news. Your final
net worth sets your rank and pays arcade coins into the shared wallet.

Challenges: after a season, share a link; your friend plays the same seed (same prices, news and share
moves) and sees your net worth next to theirs all season.

- `market/engine.js`: the rules (no screen code). Each day's market dice come from the seed and the day,
  so a challenge is fair whatever each player does.
- `market/ui.js`, `market/index.html`, `market/style.css`: the screens.

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
the minimap fills in as you explore. Purple 👁 **Map Reveal** orbs (maze only, upgradeable in the shop)
show the whole map with the route to the exit and light gold arrows on the floor for a few seconds. Each cleared maze pays a coin bonus and the next one is bigger.
Coins, outfits and continues (+20 seconds) are shared with the endless mode. Maze code lives in
`runner/maze.js` (generation) and the Maze Run section of `runner/game.js`.

### Ghost challenges

After a run, tap **👻 Challenge a friend** to share a link (phone share sheet, or the link is copied).
The link carries the track seed and your run; your friend races your see-through ghost on exactly the
same obstacles, sees the gap at the top of the screen, and can **challenge back**. No account or server
needed: everything is in the link (`runner/ghost.js`). The game runs on a fixed 1/60 s step so the same
seed always builds the same track.

### Race Friends (live, 2-4 players)

**🏁 RACE FRIENDS** on the menu. Create a room (Sprint: first to 1,000 m · Survival: last runner standing ·
Maze race: first out of the same maze), share the 4-letter code or the invite link (`?room=CODE`), and the
host starts the race. Everyone gets the same seeded track or maze; each phone sends its runner's position
about 8 times a second and shows the others as see-through runners with name tags. During a race you
can send 😂 🔥 👏 reactions. Results pay 50 / 25 / 10 coins and the host can start a rematch.

It runs on Firebase Realtime Database (free tier). One-time setup:

1. [Firebase console](https://console.firebase.google.com) → **Add project**.
2. **Build → Realtime Database → Create database** (locked mode). Open the **Rules** tab, paste the
   contents of [`firebase/database.rules.json`](firebase/database.rules.json) and **Publish**.
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
4. **Project settings → Your apps → Web app**, then copy its `firebaseConfig` into
   [`runner/firebase-config.js`](runner/firebase-config.js) (`window.NEON_FIREBASE = { ... };`).

The config values are not secret; the rules only let signed-in players change their own name and
position, and only a room's host can start or restart it. Code: `runner/net.js` (Firebase) and the
"Race Friends" section of `runner/game.js`. Local testing uses the Firebase emulator with
`firebase/firebase.json`.

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

1. Open the GitHub Pages URL (`https://buya25.github.io/games/`) on your phone.
2. **Android (Chrome):** tap *Install app* in the menu (or ⋮ → *Install app*).
   **iPhone (Safari):** tap Share → *Add to Home Screen*.
3. The game then opens full-screen from your home screen and works offline.

### Deploying

`.github/workflows/pages.yml` publishes the repo to GitHub Pages on every push.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

When you change game files, bump `VERSION` in `sw.js` (at the top level) so installed copies refresh.
Icons are generated with `python3 runner/make_icons.py`.
