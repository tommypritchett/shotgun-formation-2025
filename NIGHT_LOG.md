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
| 09:11 | 2b | Wrote `tests/reconnection.test.js`, all 12 scenarios. 10 pass. Two real failures. |
| 09:13 | 2b | **Major finding.** Scenario 9 failed: a mid-round reconnect loses every drink assigned that round. Root cause confirmed by line ordering in `finalizeRound` — totals summed at `:128`, broadcast at `:142`, `socketIdMappings` merge doesn't run until `:159`, merged result discarded at `:219`. The whole remapping mechanism is dead code for the round it exists to fix. **Tier B (reconnection identity machinery) — documented, not fixed.** Split into 9a (single hop) + 9b (chained) as `it.fails`. |
| 09:15 | 2b | Scenario 7 failed on the same root cause; narrowed it to the rejoin path so it tests one thing. Scenario 11 (`it.fails`) confirmed: a player away at quarter change never receives `quarterUpdated`, so they silently lose their wild-card swap. 13/13. |
| 09:18 | 2a | Wrote `tests/gameplay.test.js`. Two failures — both my harness bug: `gameStarted` carries every player's hand keyed by socket id and `fake-player` was reading `Object.values(hands)[0]`, so guests saw the host's hand. Fixed to index by own socket id. 7/7. |
| 09:24 | 2c | Wrote `tests/edge-cases.test.js`. 7/7 first run. Verified the deck-replenishment test was not passing vacuously: `Wild deck low (12 cards). Shuffling 111 used cards back in.` |
| 09:43 | 2 ✅ | **Phase 2 complete. Full suite 37/37 green in 161s.** Committed `33a9b07`, tagged `phase-2-tests`. |
| 09:50 | 2 | Rewrote `OVERNIGHT_REPORT.md` in full: 4 approval items, all 12 reconnection results, 4 observations, and an explicit list of what I could not test. |
