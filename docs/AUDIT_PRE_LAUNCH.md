# Pre-launch audit — findings, ranked

Five independent read-only audits of `server.js`, `client/src/`, `package.json` and `DEPLOY.md`,
run at `398b477`. Every finding below was then **re-verified by hand against the source** before
being written down; where I could not confirm something I say so.

Nothing here is a regression from the rebuild. **All of it is equally true of what is running on
production today**, which is why it does not block the deploy — see "On deploying" at the end.

Severity is calibrated to what this actually is: a drinking game played by friends who know each
other. "A player could cheat" is not a finding. "The game breaks for everyone else" is.

---

## TIER 1 — will happen on a real game night. Fix before Week 1.

### T1.1 — A reconnecting player is silently cut off from the room, permanently

**CONFIRMED.** `server.js` — the only three `socket.join()` calls are at `:498` (`createRoom`),
`:705` and `:797` (both in `handleJoinRoom`). The `requestGameState` handler at `:1575` — 240
lines of careful reconnect handling — **never calls `socket.join(roomCode)`.**

Socket.IO room membership belongs to a *connection*, not a player. A reconnect is a brand-new
socket with a new id and zero room memberships. So the player must be re-joined explicitly, and
on this path nobody does it.

**Why every test passed anyway.** There are two different reconnect paths in the client:

| What the user does | Client emits | Rejoins the socket.io room? |
|---|---|---|
| **Refreshes the page** | `validateAndJoinRoom` (`App.js:747, 754, 814, 819`) | ✅ yes — `handleJoinRoom` → `socket.join` |
| **Backgrounds the phone / locks the screen / loses wifi** | `requestGameState` (`App.js:904, 1014, 1044, 1152, 1177`) | ❌ **no** |

Every reconnect test to date has used **refresh**, which takes the healthy path. Backgrounding a
phone is a different code path entirely — and it is the single most common thing that happens to
a phone at a party.

**What the player sees.** Direct emits still reach them, because a socket always belongs to a room
named after its own id — so `roundState` and the `distributeDrinks` replay arrive and the screen
looks correct for a moment. Then everything broadcast with `io.to(roomCode)` stops: no
`updateTimer`, no `declaredCard`, no `updatePlayerStats`, no `roundFinalized`, no `updatePlayers`.
Their clock freezes on the number it had. Because `assignerOpen = timeRemaining > 0 && !!declaredCard`
(`App.js:2038`) never goes false, their drink assigner **stays open forever** and every tap emits
`assignDrinks` into whatever round happens to be live.

**Fix:** `socket.join(roomCode)` in `requestGameState`, on every path that resolves a player.
One line. Add a test that asserts a socket reconnecting via `requestGameState` receives the next
`io.to(roomCode)` broadcast — that is the assertion that was missing, not the line.

### T1.2 — A card worth 10+ drinks loses its remainder; the player cannot pour it

**CONFIRMED**, and reachable in ordinary play with a normal 5-card hand.

Server, `:1164-1179`:
```js
let shotguns        = Math.floor(totalDrinksForPlayer / 10);
let remainingDrinks = totalDrinksForPlayer % 10;
io.to(player.id).emit('distributeDrinks', { ..., drinkCount: remainingDrinks, shotguns });
```
It sends **both buckets**. Client, `App.js:2034-2035`:
```js
const isShotgunRound = shotgunsToGive > 0;
const pool = isShotgunRound ? shotgunsToGive : drinksToGive;
```
There is only **one** pool and no way to switch. `shotgunsToGive` is never decremented, so
`isShotgunRound` stays true for the whole round.

**Concrete case:** a player holding 4× Turnover (4 drinks each) owes 16 → the server sends
`{shotguns: 1, drinkCount: 6}`. They pour the shotgun, `pourCount >= pool`, and every further tap
is refused. **The 6 drinks can never be assigned.**

The perverse part: `settlePendingPour` correctly leaves `{drinkCount: 6, shotguns: 0}` outstanding,
so `pendingPourFor` still returns it — meaning **the only way to pour those 6 drinks is to
disconnect and come back.**

**Fix:** the assigner needs two phases, or one pool that spends shotguns first and then drinks.
Failing test first: a player owed `{shotguns: 1, drinkCount: 6}` can assign all seven units.

### T1.3 — Any client can kill the entire server with one malformed message

**CONFIRMED.** There is no `process.on('uncaughtException')`, no `process.on('unhandledRejection')`,
and no `try`/`catch` in any socket handler anywhere in `server.js`. The only `try` is `bootCommit()`
at `:2116`.

This is a **single process hosting every concurrent game.** Any throw in any handler ends all of
them — the same blast radius as the `startGame` crash this whole branch exists to fix.

Confirmed unguarded dereferences of client-controlled payloads:

| Site | Code | Trigger |
|---|---|---|
| `:1335` | `selectedPlayerIds.map(id => id.slice(-4))` | `assignDrinks` with the array missing, or containing a number. This is a **debug log line**, and it runs before every guard. |
| `:1009` | `playerHand.wild.findIndex(c => c.card === discardedCard.card ...)` | `wildCardSwap` with no `discardedCard`. The room, player and allowance guards above it all pass first. |
| 11 handlers | `socket.on('nextQuarter', ({ roomCode }) => {` | Emitting the event with **no payload** throws on the destructure, before `if (!room) return` is ever reached. |

**Fix, in order of value for effort:**
1. `process.on('uncaughtException')` that logs and keeps running — turns "every game dies" into
   "one action failed." Also wrap the `setInterval` callback in `startTimer:399`, because several
   of these detonate on the timer seconds later where nothing connects them to the emit.
2. Guard the two dereferences above.
3. Default the destructures: `({ roomCode } = {})`.

### T1.4 — Two sleeping phones swap identities

**CONFIRMED.** `server.js:1624-1641`. The `requestGameState` payload is `{ roomCode }` — no name,
no token. When the sender's socket id isn't in the room, the server hands them
**`possibleFormerPlayers[0]`**: whichever disconnected player `Object.values` happens to list first.

It then binds that person's roster seat to this socket (`:1634`), gives them their stats (`:1713`),
replays their outstanding pour (`:1734`), and deletes their `formerPlayers` entry (`:1779`).

**Sequence, no DevTools required:** Alice and Bob both let their phones lock during a round. Bob's
phone wakes first and fires `requestGameState`. Bob is issued Alice's name, hand and drink total.
When Alice's phone wakes, her `formerPlayers` entry is gone and her seat is held by Bob marked
`disconnected: false` — so she hits *"Player name Alice is already taken"* and **is locked out of
her own game.**

**Fix:** send the player's name in the payload and match on it. The client already has it.

---

## TIER 2 — worth doing before Week 1, but the night survives without them

### T2.1 — `gameStarted` broadcasts every room's player stats, and the map never shrinks
**CONFIRMED.** Already logged as `FOLLOW_UPS.md` F1 — this audit adds the part that makes it
urgent. Four sites (`:722, 813, 918, 1604`) emit the **module-global** `playerStats`, not
`buildRoomStats(room)`. No room-deletion path ever removes entries from it, so it is monotonic for
the life of the process.

Two consequences, and the second is the new one:
- Another game's players land in your client's state, where the scoreboard's name resolution reads
  them (F2 — this is also what keeps the elimination fallback reachable).
- The payload grows forever. At roughly 450 bytes of JSON per stale entry, a few hundred game-nights
  of accumulation makes every join and every reconnect carry a payload large enough to fail the
  handshake on a phone — which then retries, which re-sends it. It presents as *"joining hangs"*
  and will be misdiagnosed as a network problem.

`buildRoomStats(room)` already exists, is already tested, and is already the shape the client
expects. Point all four sites at it.

### T2.2 — `formerPlayers` is keyed by name across all rooms
**CONFIRMED.** `:1856`. Three of the four name lookups were hardened with `roomEntriesForName`;
the disconnect handler was missed and still scans the whole global map (`:1841-1843`).

Two concurrent games both containing a "Mike": the second Mike to drop overwrites the first Mike's
saved state, and can be dealt the other Mike's cards on return. Two Sunday parties is exactly the
scenario this branch was built for.

**Fix:** key on `roomCode + name`, and narrow the disconnect filter with the existing helper.

### T2.3 — The log will be useless the morning after
**CONFIRMED.** `assignDrinks` emits ~8 lines per call (`:1333-1339`) and the client flushes every
700ms per pouring player. Six players through one 21-second round is on the order of a thousand
lines. `:443` logs a heartbeat **every 10 seconds per connected socket**, forever, even in an idle
lobby.

Render's log buffer is bounded and not searchable. When a friend says "it broke around 11," 11pm
will be forty thousand lines of heartbeat spam. Deleting `:443` and the debug block at `:1333-1339`
costs nothing and is the highest-value production change in this document.

Keep the boot line at `:2127` printing the running commit SHA. That one is genuinely good.

### T2.4 — Two config values that are one character each
- `server.js:25` — `maxHttpBufferSize: 1e8` is **100 MB per message**, 100× the Socket.IO default.
  On a 512 MB instance, a couple of those are an out-of-memory kill. `1e6` is ample.
- `App.js:125` — `transports: ['websocket', 'polling']`. socket.io-client is pinned at **4.8.1**
  (verified), where `tryAllTransports` defaults to **false**: if the first transport fails to open,
  the client does **not** fall back to the next. WebSocket-first therefore means a phone on a
  network that blocks WebSocket upgrades fails to connect at all instead of degrading to polling.
  The server's own order (`:21`) is polling-first and correct. Drop the option or reverse it.

### T2.5 — Two client dead-ends with no way out
> **FIXED — do not quote the text below as current.** Both halves were resolved before
> 2026-09-03 and the fix is verified by `tests/ui/rejoin-deadend.test.jsx`. This entry was
> read as live in a later session and sent that session looking for a bug that was no
> longer there. The original wording is kept below for the record only.
>
> - The bail-out now tests `gameStateRef.current` (a ref kept in sync by an effect), not a
>   `[]`-deps closure, so it fires. `roomNotFound` is deliberately **left registered** — it
>   is a `once`, so it cleans itself up, and tearing it down used to leave a late answer
>   from the server with nobody listening.
> - `abandonRejoin` calls `forgetSavedGame()`, which is the one place that does
>   `localStorage.removeItem(SAVED_GAME_KEY)`.
> - Added 2026-09-03: every bail-out now passes a reason that the join screen displays.
>   Landing on a blank form with no explanation is only marginally better than a spinner.
>
> Separately fixed the same day, and **not** part of this entry: an invited player arriving
> on a share link got an empty room-code field that was also `readOnly`. See
> `client/src/lib/share-link.js` and `tests/ui/join-via-share-link.test.jsx`.

**[HISTORICAL] CONFIRMED.** `App.js:790` — the auto-rejoin bail-out compares `gameState` captured in a `[]`-deps
closure, so it is frozen at `'initial'` and **the comparison is always false. It is dead code.**
The same timeout removes the only `roomNotFound` listener (`:786-787`).

Separately, `shotgunFormation_gameState` is written (`:668`) and **never removed** — no `removeItem`
anywhere. `leaveLobby`, `handleLeaveGame`, `gameOver` and `hostLeft` all clear the URL and none
clear storage.

Together: a player finishes a game, leaves, reopens the app later, is auto-rejoined into a room that
no longer exists, and sits on *"Rejoining your game…"* forever with no button. On Render's free tier
a cold start regularly exceeds the 10-second timeout, so this fires on the first load of the evening.

**Fix:** clear localStorage on every leave path, and give the connecting screen a visible way back.

---

## TIER 3 — real, but they can wait

- **No handler checks the sender is in the room, and no Ref-only action checks the Ref.**
  `startGame` (`:876`) has no host check and re-zeroes every player's totals — anyone in the room
  can wipe the scoreboard mid-game. `nextQuarter` (`:958`) has no host check and increments the
  quarter, which also hands everyone a fresh wild-card swap. Those two are worth a guard; the rest
  is cheating at a drinking game.
- **Drink amounts are never validated against what you were told.** Unbounded, and a **string**
  value survives: `0 + "abc"` → `"0abc"`, which then poisons `totalDrinks` for the rest of the game.
  The cheating is low-stakes; the type coercion breaking the scoreboard for everyone is not.
- **Abandoned rooms are never reclaimed.** `:1881` deliberately keeps them for reconnections and
  `disconnectedAt` is stamped at `:1869` but **never read anywhere**. The normal end of a game night
  is everyone closing their tab, which is exactly this path. Invisible on the free tier because
  spin-down clears it; a real leak the moment the instance is always-on.
- **A late `assignDrinks` is applied to the *next* round.** `finalizeRound` clears the bucket at
  `:378` and `assignDrinks` re-creates it at `:1328` with no round-liveness check, so a pour landing
  in the ~50ms after the timer fires shows up on the following round's results under the wrong card.
- **Round length is counted in ticks, reconnect state is computed from the wall clock.** `startTimer`
  never reads `Date.now()`; `:613-614` subtracts real seconds from the nominal duration. With the
  ~320ms/tick drift already measured, a player reconnecting late in a round can be told the round is
  over while the server still has seconds left — they get the pour prompt with no way to pour.
- **`nextQuarter` has no round guard**, so a swap emitted just before the break is stamped with the
  *new* quarter and silently burns the next quarter's allowance.
- **The client goes dead one full tick before the server finalizes** — `App.js:1365` locks the grid
  when `timeRemaining` hits 0, but the server accepts pours for one more tick.
- **Four remaining optimistic-success emits** (`playStandardCard`, `wildCardSwap`, `handleLockIn`,
  `createRoom`) close their sheet or set local state with no server confirmation and no rollback —
  the same class as the host-handoff bug fixed in Session 11.
- **`newHost` fires a blocking native `alert()` on every phone in the room**, including mid-round.
  On iOS Safari that blocks the main thread and freezes the timer until dismissed.
- **`wildCardSelected` is stored under key `player` (`App.js:1294`) and read as `playerId`
  (`:2310`)**, so the Ref's confirmation prompt always says "A player" instead of the name.

---

## Checked and found correct

Worth recording so nobody re-opens them:

- `isActionInProgress` is **per-room**, not global, and check-then-set is synchronous — two
  declarations in one room cannot both pass, and one room cannot block another.
- `finalizeRound` has exactly one caller (the timer), so the double-finalize race does not exist.
- `settlePendingPour` settles from the **raw** giver payload, not the post-fold recipient copy —
  the subtle part of the Session 11 fix is right.
- `sentPoursRef` is written **before** the emit, so a flush racing a tap cannot double-send.
- `finalizeRound` emits `declaredCard: null` before the next declaration, so back-to-back
  declarations of the same card still reset the client's pour ledger.
- `allocateRoomCode` is bounded at 50 attempts. The event-loop pin is gone.
- Both transitive socket-id resolution loops carry a `visited` set — no infinite loop.
- `usedCards` is cleaned at all five room-deletion sites — the one global with complete coverage.
- The per-round timer and the per-socket heartbeat are both cleared on every exit path.
- **`react-scripts` is in `client/package.json` `dependencies`, not `devDependencies`** — so the
  Render build will not break under `NODE_ENV=production`. This was flagged as a possible blocker
  and it is not one.
- **No hardcoded LAN or localhost address in any tracked file.** The only localhost reference is
  commented out.
- **No XSS.** No `dangerouslySetInnerHTML` or `innerHTML` anywhere under `client/src`.
- `document.body.style.zoom` is gone; only comments remain. Viewport handling uses `100dvh` with a
  `100vh` fallback and safe-area insets on every fixed dock. No hover-only affordances.
- Room codes: 90,000 values from `Math.random`, enumerable in principle. **Not worth changing** for
  this threat model.

---

## On deploying

**Push anyway.** Every finding above is equally present in `e994b5f`, which is what is serving
players today — and that build additionally takes the whole server down when a second room starts a
game, which is guaranteed rather than probable. The branch is strictly better on every axis. A fresh
list of pre-existing bugs is not a reason to keep a known outage in production.

Then Tier 1 as its own session, before Week 1. T1.1 is the one to lead with: it is one line of code,
it explains a class of "it just stopped working" reports that testing by refresh cannot reproduce,
and it needs a test that asserts room membership after reconnect rather than a test that asserts the
line exists.
