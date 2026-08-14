# Overnight Report

> **Status: IN PROGRESS — Phase 1 done, Phase 2 running.** Last updated **2026-08-14 09:12 CDT**.
> Rewritten at the end of every phase, so it is always true as of the timestamp above.

## TL;DR

1. **The concurrency bug was worse than either of us thought. It is not a stats bug, it is a
   crash.** When one room starts a game, `startGame` deletes every other room's players from
   the global `playerStats`. The next room to finish a round throws
   `TypeError: Cannot read properties of undefined (reading 'totalDrinks')` inside a
   `setInterval` callback — which is uncaught, so **the entire Node process dies and every
   game on the server ends at once.** Two groups on a Sunday afternoon was enough to do it.
   Fixed and covered by a test.
2. **There is now a real integration test suite** where there was none: it boots the actual
   `server.js` in a child process and drives it with real `socket.io-client` players.
   **10/10 green.**
3. **Phase 1 is complete** — all four requested fixes plus one more in the same family
   (cross-room scoreboard leakage). Tagged `phase-1-server`.
4. **One thing needs your review: item 1 in "Needs my approval"** — the fifth fix, which you
   did not explicitly ask for.
5. **Time budget was cut to 4 hours mid-session, so Phase 3 (UI) and Phase 4 (screenshots)
   are cut entirely.** Per your instruction: Phase 2 thoroughly rather than both badly.
   `client/` is completely untouched.

## Needs my approval

### 1. Cross-room scoreboard leakage fix (Tier B — I made this change; please review it)

**Current behaviour before my change:** `finalizeRound` and `firstDownEvent` built the
`updatePlayerStats.players` payload by iterating **all** of `playerStats`, which is keyed by
socket id across every room on the server. So every scoreboard broadcast shipped every other
room's socket ids and drink totals to every client.

**Why you might not want my fix:** it is the one Phase 1 change you did not ask for, and it
touches the payload the client's reconnect-merge heuristic reads.

**What I changed it to:** extracted `buildRoomStats(room)` and used it at both sites. It
includes players currently in the room **plus** stale entries whose `name` matches a current
member — deliberately, because the client looks players up by name after a reconnect and
would break if those vanished. `name`/`disconnected` are computed exactly as before.

**Cost / risk:** low. Pure filter, no shape change; for a single-room server the payload is
byte-identical. Covered by
`concurrency.test.js > does not leak one room's players into another room's scoreboard`.
**To revert:** restore the two inline `Object.keys(playerStats).forEach` blocks.

*(Phase 2 Tier B items will be appended here as they are found.)*

## Phase 1 — Server concurrency ✅

Tagged **`phase-1-server`** (commit `5d0a8ef`). Review with
`git diff 49cd749..phase-1-server -- server.js`.

### Failing test output, before the fix

```
× keeps Room A's stats and round intact when Room B starts a game  29805ms
  → Ava: timed out after 29000ms waiting for "updatePlayerStats"
× lets Room B declare while Room A has a round open                 4207ms
  → expected 'busy' to be 'declared'
× leaves no phantom round behind when nobody holds the declared card 1963ms
  → expected [ 'Safety' ] to deeply equal []
× does not leak one room's players into another room's scoreboard   14170ms
  → Ava: timed out after 14000ms waiting for "updatePlayerStats"

Tests  4 failed (4)
```

The two timeouts were the server process being dead. Captured from its stderr:

```
TypeError: Cannot read properties of undefined (reading 'totalDrinks')
    at finalizeRound (/Users/tommypritchett/UI-Rebuild/server.js:88:18)
    at Timeout.<anonymous> (/Users/tommypritchett/UI-Rebuild/server.js:227:11)
```

### Passing test output, after the fix

```
✓ keeps Room A's stats and round intact when Room B starts a game  22302ms
✓ lets Room B declare while Room A has a round open
✓ leaves no phantom round behind when nobody holds the declared card 708ms
✓ does not leak one room's players into another room's scoreboard   7139ms
✓ harness — 6 smoke tests

Test Files  2 passed (2)
     Tests  10 passed (10)
```

### The fixes

| # | Bug | Before | After |
|---|---|---|---|
| 1 | `startGame` wiped global `playerStats` | `:721` `Object.keys(playerStats).forEach(id => delete …)` | `:745` `room.players.forEach(player => delete playerStats[player.id])` |
| 2 | `isActionInProgress` global | `rooms.isActionInProgress` at 10 sites (`:197, :858, :862, :919, :926, :927, :949, :1019, :1033, :1042`) | `room.isActionInProgress` at all 10. `room` was already in scope everywhere; `createRoom` already initialised the field on the room object. |
| 3 | Stale `activeRounds` on `noCard` | set at `:930`, *before* the `anyPlayerHasCard` check at `:946`, never cleared on the early return at `:956` | moved to `:961`, after the check, so it is only set once the round really starts |
| 4 | Timer duration duplication | `startTimer` used 6 / 21 / 11 but `activeRounds.timeRemaining` claimed 8 / 30 / 30 | one `ROUND_DURATIONS = { standard: 21, wild: 11, firstDown: 6 }` at `:44` feeds all 6 sites. **Actual durations unchanged.** |
| + | Cross-room scoreboard leak (extra — see approval item 1) | two inline `Object.keys(playerStats)` loops | `buildRoomStats(room)` |

Fix 4 also closes **DISCREPANCY 3** in `docs/SPEC.md`: a reconnecting player is no longer
told they have 30s left of a 21s round.

### Out of scope, as instructed — not touched

- Stable player UUIDs / `socketIdMappings` refactor.
- The dead `roundState` and `wildCardSelection` emits. **Note for a future session:**
  `roundState` is now correct on the wire (fix 4 makes its `timeRemaining` truthful), so
  adding the missing `socket.on('roundState')` to the client is a small change that would
  finally make mid-round reconnection show the right timer. That is the fix, not deletion.
- No client changes, no logging cleanup, no reformatting.

## Phase 2 — Gameplay and reconnection findings

**Status: in progress.** Nothing to report yet.

## Phase 3 — UI

**Status: CUT** when the budget was reduced to 4 hours at 08:21 CDT. `client/` is untouched;
`docs/DESIGN.md`, `cards.js` and `CardIcon.jsx` are exactly as you left them. Phase 3 can
start from a clean base.

## Phase 4 — Screenshots

**Status: CUT.** First thing dropped, per your instruction.

## Decisions I made without you

See `DECISIONS.md` — D1 (Vitest, root dev-dep only), D2 (harness spawns `server.js` rather
than requiring it), D3 (assert on observable socket behaviour, not internals), D4 (root
`npm test` runs the suite), D5 (the extra fix — approval item 1), D6 (`Safety` as the
card-nobody-holds).

## Blocked / abandoned

See `BLOCKED.md` — currently only the deliberate Phase 3/4 cut.

## What I'd do next

*(Filled in at the end.)*

## Confidence check

*(Filled in at the end.)*
