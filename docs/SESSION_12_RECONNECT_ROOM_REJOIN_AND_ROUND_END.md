# Session 12 — reconnect room-rejoin, split pours, and ending a round early

Six items. Two are structural defects found by audit and confirmed by hand; three are owner
requests from live play; one is a cheap blast-radius fix. Then hand back.

Rules unchanged: **no push, no merge, never touch `main`.** All tests stay green. Commit and
tag per item. Leave `.claude/settings.local.json` alone.

Full audit context: `docs/AUDIT_PRE_LAUNCH.md`.

---

## 1. `requestGameState` never re-joins the socket.io room, and guesses who you are

Two defects, one handler, one fix. **Do both together — they share a test.**

### The room-join

The only three `socket.join()` calls in `server.js` are `:498` (`createRoom`) and `:705` / `:797`
(`handleJoinRoom`). The `requestGameState` handler at `:1575` never calls it.

Socket.IO room membership belongs to a *connection*. A reconnect is a new socket with a new id and
zero rooms, so it must be re-joined explicitly.

**Why this has never shown up in testing, and why it is still real.** There are two reconnect paths:

| Trigger | Client emits | Rejoins the room? |
|---|---|---|
| Page **reload** (URL carries room + name) | `validateAndJoinRoom` — `App.js:747, 754, 814, 819` | ✅ via `handleJoinRoom` |
| Socket reconnects while the **page survives** | `requestGameState` — `App.js:904, 1014, 1044, 1152, 1177` | ❌ **no** |

All testing to date has used refresh, which takes the first path. A phone locked briefly, a laptop
sleeping, or wifi dropping while the screen is on takes the second: the page is still in memory, the
socket reconnects on its own, and `requestGameState` fires with no `validateAndJoinRoom` anywhere
near it.

The player still receives direct emits — a socket always belongs to a room named after its own id —
so `roundState` and the `distributeDrinks` replay arrive and the screen looks briefly correct. Then
everything sent with `io.to(roomCode)` stops: no `updateTimer`, no `declaredCard`, no
`updatePlayerStats`, no `roundFinalized`, no `updatePlayers`. Their clock freezes, and because
`assignerOpen = timeRemaining > 0 && !!declaredCard` (`App.js:2038`) never goes false, their
assigner stays open for the rest of the game and every tap pours into whatever round is live.

**Fix:** `socket.join(roomCode)` on every path in `requestGameState` that resolves a player.

### The identity guess

`server.js:1624-1641`. The payload is `{ roomCode }` — no name. When the caller's socket id isn't in
the room, the server adopts **`possibleFormerPlayers[0]`**: whichever disconnected player
`Object.values` lists first. It then binds that seat to this socket (`:1634`), hands over their stats
(`:1713`), replays their outstanding pour (`:1734`), and deletes their `formerPlayers` entry (`:1779`).

With one person dropped, index 0 *is* them and it resolves correctly — which is why this has not
been seen. With **two or more from the same room in `formerPlayers` at once**, the second person
back finds their seat taken and their `formerPlayers` entry gone, and is refused with *"name already
taken."*

**Fix:** send `playerName` in the `requestGameState` payload — the client already has it in state —
and match on it. Fall back to the current behaviour only when no name is supplied, so an old cached
bundle still limps rather than breaking.

### Tests

- A socket that reconnects via `requestGameState` **receives the next `io.to(roomCode)` broadcast.**
  Assert on the broadcast being received, not on the line existing.
- Two players from one room both in `formerPlayers`; each reconnects via `requestGameState` with
  their own name; each gets their own seat, hand and totals, and neither is locked out.
- Regression: the page-reload path through `validateAndJoinRoom` still works unchanged.

Tag `phase-12-reconnect-rejoin`.

---

## 2. A card worth 10+ drinks loses its remainder — confirmed by the owner in live play

**Owner reproduced this: holding four Turnovers, you are given the shotgun to assign and the six
drinks are unreachable.**

Server `:1164-1179` sends **both** buckets:
```js
let shotguns        = Math.floor(totalDrinksForPlayer / 10);
let remainingDrinks = totalDrinksForPlayer % 10;
io.to(player.id).emit('distributeDrinks', { ..., drinkCount: remainingDrinks, shotguns });
```
Client `App.js:2034-2035` has one pool and no way to switch:
```js
const isShotgunRound = shotgunsToGive > 0;
const pool = isShotgunRound ? shotgunsToGive : drinksToGive;
```
`shotgunsToGive` is never decremented, so `isShotgunRound` stays true all round. Once the shotgun is
poured, `pourCount >= pool` refuses every further tap.

`settlePendingPour` correctly leaves `{drinkCount: 6, shotguns: 0}` outstanding, so `pendingPourFor`
still returns it — meaning **the only way to pour the remainder today is to disconnect and come
back.** That is the tell that the server is right and the client is wrong.

**What the owner wants:** shotguns first, then the assigner rolls over to the drinks.
*"Give out the shotgun, then it says: now your N drinks."*

Sequential phases, not two grids. When the shotgun pool is exhausted and drinks remain, the assigner
switches to the drink phase with a clear transition — the pool count, the glyph and the header copy
all change, so nobody thinks they are pouring the same thing twice. Undo must be able to walk back
across the phase boundary, since the debt is one debt.

**Failing test first:** a player owed `{shotguns: 1, drinkCount: 6}` can assign all seven units in
one round, `pending` reaches zero, and Round Results shows the recipients correctly.

Tag `phase-12-shotgun-then-drinks`.

---

## 3. End the round early when everyone is done

**Owner request:** if everyone has locked in — or has nothing to give — the round should end without
waiting out the clock.

Today this is impossible. `finalizeRound` has **exactly one caller**: the `else` branch of
`startTimer`'s interval at `:410`. `handleLockIn` (`App.js:2141`) only calls `flushPours()` and sets
local `pourSent`; **there is no `lockIn` socket event at all.**

### ⚠️ Read this before writing code

The audit found that the double-finalize race *does not currently exist*, purely because there is one
caller. `finalizeRound` (`:269-392`) has **no idempotency guard and no round token.** Adding a second
caller creates that race: the last player locks in at t=20.9 while the timer fires at t=21.0, and the
round finalizes twice — doubling totals and broadcasting two results screens.

**So the guard comes first, as its own commit, before the early-end path exists.** A round token or
a `finalized` flag on `activeRounds[roomCode]`, checked and set synchronously at the top of
`finalizeRound`. Test it by calling `finalizeRound` twice directly and asserting the second is a
no-op.

### Then the early end

The server already has the data — `activeRounds[roomCode].pending[playerName]` is what each player
still owes, and Session 11 made it mean *remaining*.

Round is over when **every player who owes something has zero pending, or has explicitly locked in.**

- A player who holds no copy of the declared card owes nothing and is trivially done — they must not
  block the round, and they must not need to press anything.
- **Disconnected players must not block the round.** Someone whose phone died must not hold nine
  people hostage for the full 21 seconds. Skip them, and let their debt lapse as it does today.
- Add a `lockIn` socket event so an explicit lock-in reaches the server. It should settle whatever
  the player has poured and mark them done for this round; it must not clear a debt they have not
  poured. A player who locks in with drinks outstanding is choosing to forfeit them — keep that
  behaviour, just make it end their participation.
- **First Down is the exception.** Nobody owes anything, so a naive rule ends it instantly. It is a
  six-second "everyone drinks" beat and needs its display time. Either exclude it from early-end or
  give it a floor; say which you chose and why.

Clear the interval when ending early — do not leave an orphaned timer that fires into the next round.

**Tests:** three players hold the card, all pour out → round ends before the clock. One is
disconnected → the other two finishing still ends it. One locks in with drinks outstanding → round
ends, their debt lapses, nobody else is charged. First Down still runs its full duration.

Tag `phase-12-early-round-end`.

---

## 4. There is always a Ref — including after everyone has left

`server.js:1900-1910`. When the host disconnects, an active player is promoted:
```js
const activePlayersForHost = players.filter(p => !p.disconnected);
if (activePlayersForHost.length > 0) {
  room.host = activePlayersForHost[0].id;
  io.to(roomCode).emit('newHost', { newHostId: room.host, ... });
} else {
  io.to(roomCode).emit('gameOver', 'All players have disconnected. Game will remain open for reconnections.');
}
```
The `else` branch **never reassigns `room.host`.** It keeps pointing at a dead socket id, and nothing
on the rejoin paths fixes it. The first person back to a still-live game has no Ref and no way to
declare — the game is stuck.

**Owner's rule: if the game is still active, the first player to rejoin becomes the Ref.**

Apply it on **both** rejoin paths — `handleJoinRoom` and `requestGameState` — since item 1 makes
clear those are genuinely different routes. Condition: the room exists, `gameStarted` is true, and
`room.host` does not resolve to a currently-connected player in this room. Emit `newHost` so the
client actually updates.

Check the same hole in `leaveGame`: if the last active player *leaves* rather than dropping, does
`room.host` end up dangling the same way?

**Tests:** four-player game, everyone disconnects, one rejoins → they are Ref and can declare. Two
rejoin in sequence → the first is Ref, the second is not, and the whistle does not bounce.

Tag `phase-12-ref-recovery`.

---

## 5. The passive screen tells people to watch for a finger

`client/src/components/DrinkAssigner.jsx:113`:
```jsx
<p>Nothing to do. Keep your eyes on the TV — someone is about to point at you.</p>
```
**Owner:** it should say to watch your phone to see whether you received any drinks. Nobody points —
the game is anonymous by design (`FOLLOW_UPS.md` P1), so copy that describes pointing contradicts the
product.

Something like *"Nothing to give. Keep an eye on your phone — you'll see if you picked up any
drinks."* Match the voice of the rest of the UI. Fix the doc comment at `:9-10` too, which describes
the same fiction.

While you are there, check for other copy describing a mechanic instead of an outcome — the First
Down fix in Session 10 was the same class.

---

## 6. Stop one bad message from killing every game

There is **no `process.on('uncaughtException')`, no `process.on('unhandledRejection')`, and no
try/catch in any socket handler.** The only `try` in `server.js` is `bootCommit()` at `:2116`.

One process hosts every concurrent game, so any throw ends all of them — the same blast radius as the
`startGame` crash this whole branch exists to fix.

Confirmed unguarded dereferences of client-controlled payloads:

| Site | Code | Trigger |
|---|---|---|
| `:1335` | `selectedPlayerIds.map(id => id.slice(-4))` | `assignDrinks` with the array missing or holding a number. It is a **debug log line**, and it runs before every guard. |
| `:1009` | `playerHand.wild.findIndex(c => c.card === discardedCard.card ...)` | `wildCardSwap` with no `discardedCard`. The room, player and allowance guards all pass first. |
| 11 handlers | `socket.on('nextQuarter', ({ roomCode }) => {` | Emitting with **no payload** throws on the destructure, before `if (!room) return` is reached. |

**Do, in this order:**
1. `process.on('uncaughtException')` — log loudly with the room code if it can be determined, and
   stay up. Turns "every game dies" into "one action failed." **Also wrap the `setInterval` callback
   in `startTimer:399`**, because several of these detonate on the timer seconds later, where nothing
   in the log connects them to the emit that caused them.
2. Guard the two dereferences above.
3. Default the destructures: `({ roomCode } = {})`.

Do **not** add a validation framework or rate limiting. This is a party game among friends; the goal
is that a malformed message fails one action instead of ending everyone's night.

**Test:** emit each of `assignDrinks` with no `selectedPlayerIds`, `wildCardSwap` with no
`discardedCard`, and `nextQuarter` with no payload. Assert the process is still alive and other rooms
still play.

Tag `phase-12-crash-guards`.

---

## Answered, so nobody re-derives it

**Nothing ends a game from inactivity.** `disconnectedAt` is written at `:1869` and **read nowhere.**
There are two `setInterval`s in the file — the round timer and the heartbeat — and no sweeper. `:1881`
deliberately keeps abandoned rooms for reconnections and nothing revisits it. A room dies only when
the host leaves in the lobby, everyone taps Leave Game, or the process restarts. On Render's free tier
the service spins down after ~15 minutes idle, and *that* is what currently ends games.

**Not in scope this session.** Item 4 makes stale rooms more visible, not more harmful. If you have a
view on what a reaper should key off — `disconnectedAt` is already stamped and ready — put it in the
report as a recommendation. Do not build it.

---

## Then

Short report: what each defect actually was, what the early-end rule ended up being for First Down and
disconnected players, test counts, and anything that turned out differently from the account above —
including where this prompt was wrong. Nothing pushed. The merge and deploy stay the owner's to run.
