# Night Log — 2026-08-13 → 2026-08-14

Append-only. Newest at the bottom.

## Time budget (revised mid-session by owner at 08:21 CDT 2026-08-14)

| Marker | Time |
|---|---|
| Budget start | 2026-08-14 **08:21 CDT** |
| Stop all feature work | 2026-08-14 **11:51 CDT** |
| Hard limit | 2026-08-14 **12:21 CDT** |

Re-prioritised: **Phase 1 and Phase 2 only.** Phase 3 (UI) is cut unless Phase 2 finishes
early; Phase 4 screenshots are cut outright. `OVERNIGHT_REPORT.md`, `NIGHT_LOG.md`,
`DECISIONS.md` and `BLOCKED.md` are written incrementally from here on — the report is
always true as of right now, never batched at the end.

| Time (CDT) | Phase | What happened |
|---|---|---|
| 22:18 | setup | Read `OVERNIGHT_PROMPT.md`, `docs/SPEC.md`, `server.js` (state, timers, round handlers, decks). Wrote `.claude/settings.local.json` with a command allowlist + deny-list for `git push` / `main` checkout / `npm audit fix`. |
| 22:20 | 1a | Installed `vitest@2.1.9` + `socket.io-client@4.8.1` as **root devDependencies only**. Client `package.json` untouched. |
| 22:21 | 1a | Built harness: `tests/helpers/server-process.js` (spawns real `server.js` on a free port), `fake-player.js` (records every socket event, derives the client view-model), `game-actions.js` (client-identical payloads), `harness.js` (composition). |
| 22:22 | 1a | Harness smoke tests failed 1/6 — my bug, not the server's: `joinRoom` acked the joiner before the other members' `updatePlayers` broadcast landed. Fixed by settling every member's roster before returning. 6/6 green. |
| 08:22 | 1b | Wrote `tests/concurrency.test.js` — 4 tests, all failing as designed. Committed red. |
| 08:35 | 1b | Confirmed the root cause of the two timeouts: **the server process crashes.** `TypeError: Cannot read properties of undefined (reading 'totalDrinks')` at `finalizeRound (server.js:88)` from `Timeout (server.js:227)`. Added crash detection to the harness so a dead server can never read as a passing test. |
| 08:45 | 1c | Applied the four fixes + one same-family fix (`buildRoomStats`). `node -c server.js` clean. |
| 09:07 | 1c | 9/10 green. Last failure was my test racing a per-socket broadcast again, not a server bug — switched to `waitFor`. |
| 09:09 | 1 ✅ | **Phase 1 complete. 10/10 green.** Committed `5d0a8ef`, tagged `phase-1-server`. |
