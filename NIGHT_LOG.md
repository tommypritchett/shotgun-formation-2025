# Night Log — 2026-08-13 → 2026-08-14

Append-only. Newest at the bottom.

| Time (CDT) | Phase | What happened |
|---|---|---|
| 22:18 | setup | Read `OVERNIGHT_PROMPT.md`, `docs/SPEC.md`, `server.js` (state, timers, round handlers, decks). Wrote `.claude/settings.local.json` with a command allowlist + deny-list for `git push` / `main` checkout / `npm audit fix`. |
| 22:20 | 1a | Installed `vitest@2.1.9` + `socket.io-client@4.8.1` as **root devDependencies only**. Client `package.json` untouched. |
| 22:21 | 1a | Built harness: `tests/helpers/server-process.js` (spawns real `server.js` on a free port), `fake-player.js` (records every socket event, derives the client view-model), `game-actions.js` (client-identical payloads), `harness.js` (composition). |
| 22:22 | 1a | Harness smoke tests failed 1/6 — my bug, not the server's: `joinRoom` acked the joiner before the other members' `updatePlayers` broadcast landed. Fixed by settling every member's roster before returning. 6/6 green. |
