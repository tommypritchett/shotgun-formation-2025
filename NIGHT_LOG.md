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
| 09:49 | 3a (test only) | Wrote `tests/card-data.test.js` — lifts `generateDecks()` and `ROUND_DURATIONS` out of `server.js` source and evaluates them standalone, then asserts every id / drink value / copy count matches `cards.js`. **`cards.js` is already a perfect match for the wire.** 33/33. |
| 09:52 | 3a | Mutation-tested the guard so it isn't vacuous: renaming `Sacks`→`Sack` and changing Touchdown 7→6 copies produced 7 distinct failures. `cards.js` restored clean. |
| 10:00 | 2 (extra) | Wrote `tests/protocol.test.js` — the socket events no other suite reached: `assignNewHost`, `hostLeft`, mid-round `wildCardSelected` rejection, timer tick sequence, `distributeDrinks` privacy, `requestGameState` resync, `forceRefresh` cooldown, `heartbeat`, `gameOver`. 11/11 first run. |
| 10:02 | 1 (extra) | Added the real product scenario to `concurrency.test.js`: **six games running at once**, each pouring a different amount, asserting no scoreboard sees a stranger. Plus a drop in one room not disturbing another room's open round. 6/6. |
| 10:04 | — | **Full suite: 83 passed, 7 files, 159s.** Committed. |
| 10:15 | docs | Updated `docs/SPEC.md` — every state bug now marked ✅ FIXED or ⚠️ STILL OPEN, timer table rewritten around `ROUND_DURATIONS`, DISCREPANCY 3 closed. It's the file `CLAUDE.md` says to read first, so leaving it describing fixed bugs was worse than not updating it. Added `tests/README.md`. |
| 10:20 | 4a | `cd client && npx react-scripts build` → **exit 0**. All ESLint warnings pre-existing; no new ones (nothing in `client/src` was modified). |
| 10:25 | verify | Second full-suite run for flakiness: **83/83, 137s** (overlapping the client build competing for CPU). No flaky tests across two runs. |
| 10:40 | Tier B | Prototyped approval item 2 (move the `socketIdMappings` merge above the stat-summing loop in `finalizeRound`), flipped 9a/9b to real `it`, ran **full suite 83/83 green**. Captured the diff to `docs/proposed/fix-2-mid-round-drink-loss.patch` and **reverted `server.js`**. Fix verified without changing behaviour overnight. |
| 11:00 | Tier B | Same for item 4 (room code collision retry loop): sanity-checked 13/13, captured `docs/proposed/fix-4-room-code-collision.patch`, reverted. **Not** test-verified — the bug itself can't be honestly tested. |
| 11:08 | docs | Committed `docs/proposed/` with a README explaining what is verified and what isn't. Repo is in its **unfixed** state; patches are not applied. |
