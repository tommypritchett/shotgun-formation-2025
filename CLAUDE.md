# CLAUDE.md — Shotgun Formation

Real-time multiplayer NFL drinking game. Live at https://shotgunformation.onrender.com.
It **works**; this branch (`ui-rebuild`) is a **visual rebuild only**.

## Stack
- **Server:** `server.js` — Node + Express + Socket.IO 4.8, ~3,040 lines, one file. In-memory state, no DB. The live-game feed lives in `server/feed/*` as separate modules.
- **Client:** `client/src/App.js` — one React 18 component (~2,740 lines), CRA, plus `components/`, `screens/`, `lib/` and `data/`. Styling is `client/src/styles/game.css` + `tokens.css`; `client/src/App.css` (~1,000 lines) is **dead**, kept only for diffing against the old UI.
- **Deploy:** client builds to `client/build`, served statically by Express on Render. `main` auto-deploys.
- **Tests: ~613 across 58 files.** Root `npm test` runs Vitest and takes about 5.5 minutes — the socket tests boot a real `server.js` child process and a Standard round genuinely lasts 21 seconds. Vitest is a **root** devDependency only; Render never installs it. Root `test-*.js` files are ad-hoc manual scripts, not part of the suite.

## Canonical spec
Read **`docs/SPEC.md`** before touching anything. It documents the real game loop, the full deck, every socket event (both directions), the `gameState` machine, all modals, and the known bugs. It is derived from the code, not from memory.

## Hard rules (do not violate)

> **Rules 1 and 3 were lifted by the owner on 2026-09-03, and rule 2 was
> narrowed.** They were written when this was a `ui-rebuild` branch doing a
> visual port only. That stopped being true at Session 15: the live-game feed
> added ~1,100 lines to `server.js` and a set of new socket events, with the
> owner's approval, and has shipped to production. Do not refuse a server-side
> change by quoting the old wording — it was stale, and it has already blocked
> one session.

1. ~~Do not edit `server.js`.~~ **Lifted.** You may edit `server.js`. It is
   still ~3,000 lines in one file with all state in memory, so change it
   deliberately and keep new logic in `server/feed/*`-style modules where it
   fits, but it is no longer off limits.
2. **Do not rename or repurpose an EXISTING socket event, and never change an
   existing payload shape.** That is the client/server contract and it still
   holds absolutely. **Adding** a new event, or adding a field to a payload, is
   allowed — `gameStarted` gained `hostId` and the feed added `attachGame`,
   `detachGame`, `gameFeedUpdate`, `playSuggested` and `playAutoCalled` this
   way. Old clients must keep working.
3. ~~No new gameplay features.~~ **Lifted.** The live-game feed is itself a
   gameplay feature. New behaviour is fine when the owner has asked for it.
4. **No dependency upgrades.** Never run `npm audit fix --force` (it breaks
   `react-scripts`). This one is unchanged and still bites.
5. **Card values live in ONE data file.** Never hardcode card names/values in a
   component. Unchanged.
6. **Write the failing test first.** Not originally listed, but it is the habit
   that has caught a wrong premise in most sessions — several "bugs" came back
   green, which is what a wrong diagnosis looks like. See
   `docs/HISTORY_SESSIONS_1_14.md`.

**The deny rules in `.claude/settings.local.json` still constrain the assistant,
not you.** `git push`, `git checkout main`, `git switch main`, `npm audit fix`
and `rm -rf` are blocked. If a session needs to push, it should remove exactly
the entries it needs, push, and put all five back.

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
