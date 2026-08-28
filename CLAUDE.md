# CLAUDE.md — Shotgun Formation

Real-time multiplayer NFL drinking game. Live at https://shotgunformation.onrender.com.
It **works**; this branch (`ui-rebuild`) is a **visual rebuild only**.

## Stack
- **Server:** `server.js` — Node + Express + Socket.IO 4.8, ~1,890 lines, one file. In-memory state, no DB.
- **Client:** `client/src/App.js` — one React 18 component (~2,480 lines), CRA. `client/src/App.css` (~1,000 lines, hand-written, no framework).
- **Deploy:** client builds to `client/build`, served statically by Express on Render.
- **Tests:** none. Root `npm test` exits 1. Root `test-*.js` files are ad-hoc manual scripts, not a suite.

## Canonical spec
Read **`docs/SPEC.md`** before touching anything. It documents the real game loop, the full deck, every socket event (both directions), the `gameState` machine, all modals, and the known bugs. It is derived from the code, not from memory.

## Hard rules for this branch (do not violate)
1. **Do not edit `server.js`.** If a change seems to require it, STOP and explain why instead.
2. **Do not rename a socket event or change a payload shape.** Ever. It is the client/server contract.
3. **No new gameplay features.** Visual layer only.
4. **No dependency upgrades.** Never run `npm audit fix --force` (it breaks `react-scripts`).
5. **Card values live in ONE data file.** Never hardcode card names/values in a component.

## Design direction — "Playbook Chalk"
- Chalkboard near-black base.
- Stadium amber `#FFB020` — Standard deck.
- Neon green `#8AFF3D` — Wild deck (canon: in-app text says "Select your Neon Green Wild Card").
- Red `#FF4A33` — reserved for the four 40-drink shotgun cards.
- Type: Oswald (condensed athletic display) + Inter (body).
- App cards should render identically to the physical printed cards (same icon, value chip, layout).

## Commands
```bash
# Server (from repo root)
npm start                 # node server.js, port 3001 (or $PORT)

# Client (from client/)
cd client && npm start    # CRA dev server, proxies to REACT_APP_API_URL
npm run build             # production build → client/build

# Full build (what Render runs)
npm run build             # root script: cd client && npm install && npm run build
```
The client `socket` connects to `REACT_APP_API_URL` or falls back to the live Render URL — set `REACT_APP_API_URL=http://localhost:3001` for local dev.
