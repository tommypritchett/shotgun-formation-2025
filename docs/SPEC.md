# Shotgun Formation — Canonical Spec

> Derived from the actual code (`server.js`, `client/src/App.js`) as of the `ui-rebuild` branch.
> Where the code contradicts the owner's verbal description, it is flagged with **⚠️ DISCREPANCY**.
> This document describes *what the code does*, which is the contract the UI rebuild must preserve.
>
> **Updated 2026-08-14 for the Phase 1 concurrency fixes** (tag `phase-1-server`). Items that
> were bugs and are now fixed are marked **✅ FIXED**; items still open are marked
> **⚠️ STILL OPEN** and cross-referenced to `OVERNIGHT_REPORT.md`. Server behaviour is now
> covered by 83 tests in `tests/` — run `npm test`.

---

## 1. Overview

Real-time multiplayer drinking game played in one room while watching an NFL game on TV.
- **Server:** `server.js` — Node + Express + Socket.IO 4.8. All state in-memory, module-level objects keyed by room code. No database.
- **Client:** `client/src/App.js` — single React 18 component (~2,480 lines). One `socket` singleton created at module load.
- **Transport contract:** identity is the **Socket.IO `socket.id`**, which changes on every reconnect. Almost all reconnection complexity exists to paper over this.

---

## 2. Game Loop

1. **Create:** A player emits `createRoom`. Server generates a 5-digit numeric code (`10000`–`99999`), makes the creator the **host** (the "Ref"), returns `roomCreated`.
2. **Join:** Others emit `joinRoom` (or `validateAndJoinRoom` for auto-rejoin) with the code. **Minimum 3 players** to start.
3. **Start:** Host emits `startGame`. Server builds a deck of `78 × playerCount` cards, deals **5 Standard + 2 Wild** per player, sets `gameStarted = true`, `quarter = 1`, and resets `playerStats` **for this room's players only**. Emits `gameStarted`.
   > **✅ FIXED 2026-08-14.** This used to wipe `playerStats` globally, deleting every other
   > room's players mid-game. The next room to finalize a round then threw an uncaught
   > `TypeError` inside a `setInterval`, killing the whole server process.
4. **Standard event (host-driven):** Host emits `playStandardCard { cardType }`. Server finds every player holding that card, computes drinks (with 10→shotgun folding), emits `distributeDrinks` to each holder, opens a **21-second** distribution window (`startTimer(roomCode, 21)`). If nobody holds the card, emits `noCard` for 5s and aborts.
5. **Wild event (player-driven):** A player taps a wild card → `wildCardSelected` → server relays to host → host confirms → `wildCardConfirmed` → server computes drinks and opens an **11-second** window (`startTimer(roomCode, 11)`).
6. **First Down (global, no card):** Host emits `firstDownEvent`. Everyone's round drinks += 1. **6-second** window (`startTimer(roomCode, 6)`).
7. **Distribute:** A holder taps target players (one tap = one drink/shotgun). The client **batches** all taps locally and emits a single `assignDrinks` **only when the timer reaches 0** (the per-tap emit is commented out).
8. **Finalize:** When the timer hits 0, `finalizeRound` folds `roundResults` into `totalDrinks`/`totalShotguns`, emits `updatePlayerStats { roundFinalized: true }`, resets `declaredCard` to `null`, clears `activeRounds`/`socketIdMappings`, clears `roundResults`, replenishes hands, deals players back up.
9. **Next quarter:** Host emits `nextQuarter`. `quarter += 1`, emits `quarterUpdated`. Each player may swap **one** wild card (client opens swap modal on `quarterUpdated > 1`).

### Core rules
- **10 drinks = 1 shotgun**, applied in two places:
  - When a played card (or set of copies of a card) totals ≥10 drinks: `shotguns = floor(total/10)`, `remainder = total%10` (server `playStandardCard` / `wildCardConfirmed`).
  - When a player *receives* ≥10 drinks in one round: `assignDrinks` folds every 10 received into a shotgun.
- Wild cards worth ≥10 render as **shotguns** on the card face (client: `card.drinks >= 10 ? floor/10 Shotguns : drinks`).

---

## 3. The Deck (source of truth: `server.js` `generateDecks`)

Deck size = **78 × playerCount** (35 standard + 43 wild).

### Standard — 35 × playerCount (host declares)
| Card | Drinks | Copies/player |
|------|--------|---------------|
| Touchdown | 3 | 7 |
| Field Goal | 2 | 6 |
| Turnover | 4 | 5 |
| Sacks | 2 | 8 |
| Penalty | 1 | 9 |

Plus **First Down** — not a card, a global event, everyone drinks 1.

### Wild — 43 × playerCount (player declares, host confirms)
| Card | Drinks | Copies/player |
|------|--------|---------------|
| 3 n Out | 4 | 6 |
| Big Play 20+ | 5 | 5 |
| Turnover on Downs | 10 | 5 |
| Missed FG | 5 | 4 |
| Big Play 50+ | 10 | 3 |
| Onside Attempt | 10 | 3 |
| Fake Punt/FG | 10 | 3 |
| 2 PT Conversion | 5 | 3 |
| Doink | 40 | 2 |
| Blocked Kicks | 10 | 1 |
| Missed PAT | 6 | 1 |
| Penalty Calls TD Back | 10 | 1 |
| Special Teams TD | 20 | 1 |
| Disqualified | 20 | 1 |
| Defensive TD | 20 | 1 |
| Onside Recovered | 40 | 1 |
| Record Broken | 40 | 1 |
| **Safety** | **20** | **1** |

> **⚠️ DISCREPANCY 1:** The owner's card list omits **Safety** (20 drinks, 1 copy). The code has it (`server.js:1856`). This is the 43rd wild card — the owner's list only totals 42 but is labeled "43 × playerCount." Safety is the missing card.
>
> **⚠️ DISCREPANCY 2:** The owner spells it **"Disqualiffety"**; the code card name is **`"Disqualified"`**. The socket contract uses `"Disqualified"` — the printed physical card art must match that exact string or the app won't recognize the card.

### 3.1 The printed deck is not the app deck

Two different things, easy to confuse, so both are written down.

**The app deck** is generated per game: `78 × playerCount` (35 Standard + 43 Wild
per player), built by `generateDecks()` and reshuffled from the discard pile as it
runs down. It has no fixed size and no First Down card — First Down is a Ref-only
global action (`firstDownEvent`).

**The printed deck is 160 cards, and the box is canon.** Its back-panel breakdown:

| Line | Count | In `cards.js`? |
|---|---|---|
| Standard | 105 | ✅ yes, as `printCopies` |
| Wild | 45 | ✅ yes, as `printCopies` |
| **First Down** | **5** | ❌ no — see the flag below |
| Ref | 1 | ❌ not an event card |
| Rules | 2 | ❌ |
| Blank House Rule | 2 | ❌ |
| **Total** | **160** | 150 of them are event cards |

`cards.js` `printCopies` sums to exactly 105 + 45 = **150**, which agrees with the box
on every line it covers. It simply never mentioned the other ten.

> **⚠️ DISCREPANCY 4 — five First Down cards is a RULES CHANGE, not a typo.**
>
> The app has no First Down card. It is a global action only the Ref can call, and
> everybody drinks one. **Five printed copies implies players hold them**, which is a
> different game: it would make First Down a card you can be dealt, hold, and play —
> and it raises questions the app has no answer for. Who plays it? Does holding one
> let a non-Ref trigger the round? Does it follow the Standard "everyone holding it
> pours" rule, or stay a global?
>
> **Nothing has been implemented.** `cards.js` and `generateDecks()` are unchanged.
> This needs an owner decision before either the deck or the app moves.

### Deck replenishment
`checkAndReplenishDecks` reshuffles used cards back in when a deck drops to **≤12** cards (`server.js:1796`). Used cards are tracked per-room in `usedCards[roomCode]`.

---

## 4. Timer Durations

Both the countdown and the reconnection math now read one constant,
`ROUND_DURATIONS` (`server.js:44`):

| Event | Duration | Constant |
|-------|----------|----------|
| Standard card | **21s** | `ROUND_DURATIONS.standard` |
| Wild card | **11s** | `ROUND_DURATIONS.wild` |
| First Down | **6s** | `ROUND_DURATIONS.firstDown` |

> **✅ DISCREPANCY 3 FIXED 2026-08-14.** `activeRounds.timeRemaining` used to be hardcoded to
> 30 / 30 / 8 against real timers of 21 / 11 / 6, so a reconnecting player was told they had
> far more time than they did. One constant now feeds both. **The durations themselves are
> unchanged.** Asserted by `tests/reconnection.test.js` scenario 6 and
> `tests/card-data.test.js`, which also pins the client's copy in `cards.js` to the server's.
>
> The timer emits `updateTimer` starting at `duration - 1`, so a 21s timer displays a max of
> 20 and a 6s timer a max of 5. Asserted by `tests/protocol.test.js`.

---

## 5. Client `gameState` Machine

`gameState` ∈ `{ 'initial', 'connecting', 'lobby', 'game' }`

```
                 createRoom → roomCreated
   initial ─────────────────────────────────→ lobby ── startGame/gameStarted ──→ game
      │  joinRoom → joinedRoom ────────────────↑                                    │
      │                                                                             │
      │  (URL/localStorage auto-rejoin on mount)                                    │
      └────────────→ connecting ──┬── gameStarted ───────────────────────────────→ game
                                  ├── joinedRoom ──────────────────────────────→ lobby
                                  └── roomNotFound/error/timeout ──────────────→ initial
```

- On mount, an effect checks **URL params first**, then **localStorage** (`shotgunFormation_gameState`, 30-min TTL), and auto-rejoins via `validateAndJoinRoom`.
- `hostLeft`, `gameOver`, invalid state → back to `initial` (+ `clearURL()`).
- There is an `ErrorBoundary` wrapper and an "emergency recovery" render path if `gameState` is ever falsy (the render never returns `null` on purpose).

---

## 6. Socket Event Contract

### Client → Server
| Event | Payload | Notes |
|-------|---------|-------|
| `createRoom` | `playerName: string` | |
| `joinRoom` | `(roomCode, playerName)` | positional args, not an object |
| `validateAndJoinRoom` | `(roomCode, playerName)` | auto-rejoin; checks room exists then calls join logic |
| `leaveRoom` | `roomCode: string` | lobby leave |
| `startGame` | `roomCode: string` | requires ≥3 players |
| `assignNewHost` | `{ roomCode, newHostId }` | |
| `nextQuarter` | `{ roomCode }` | |
| `wildCardSwap` | `{ roomCode, discardedCard }` | `discardedCard` is a full card object `{ card, drinks, type }` |
| `firstDownEvent` | `{ roomCode }` | |
| `playStandardCard` | `{ roomCode, cardType }` | |
| `wildCardSelected` | `{ roomCode, playerId, wildcardtype }` | |
| `wildCardConfirmed` | `{ roomCode, wildcardtype, player }` | |
| `assignDrinks` | `{ roomCode, selectedPlayerIds, drinksToGive, shotgunsToGive }` | `drinksToGive`/`shotgunsToGive` are `{ [playerId]: count }` maps |
| `leaveGame` | `{ roomCode }` | in-game leave; saves to `formerPlayers` |
| `requestGameState` | `{ roomCode }` | reconnection resync |
| `requestRefresh` | `{ roomCode, playerName, reason }` | server replies `forceRefresh` (5s cooldown) |
| `heartbeat-ack` | `{ timestamp }` | |

### Server → Client
| Event | Payload | Notes |
|-------|---------|-------|
| `roomCreated` | `roomCode: string` | |
| `roomNotFound` | `{ roomCode, message }` | |
| `error` | `string` | |
| `joinedRoom` | `roomCode: string` | lobby entry |
| `updatePlayers` | `players: [{ id, name, disconnected? }]` | |
| `gameStarted` | `{ hands, playerStats }` | `hands = { [socketId]: { standard, wild } }` |
| `updatePlayerHand` | `{ standard, wild }` | per-player hand refresh |
| `declaredCard` | `cardType: string \| null` | `null` resets on finalize |
| `noCard` | `message: string` | `''` clears after 5s |
| `firstDownMessage` | `message: string` | |
| `updateTimer` | `secondsRemaining: number` | every second to the room |
| `updatePlayerStats` | `{ players, roundResults, roundFinalized? }` | `players = { [id]: { totalDrinks, totalShotguns, name, disconnected } }` |
| `distributeDrinks` | `{ playerId, cardType?, wildcardtype?, drinkCount, shotguns }` | `cardType` for standard, `wildcardtype` for wild |
| `wildCardSelected` | `{ playerId, wildcardtype }` | **to host only** |
| `actionInProgress` | `message: string` | shown as `alert()` |
| `newHost` | `{ newHostId, message }` | |
| `hostLeft` | `message: string` | |
| `gameOver` | `message: string` | |
| `playerLeft` | `{ playerId, remainingPlayers }` | |
| `playerRejoined` | `{ playerId, playerName }` | |
| `quarterUpdated` | `quarter: number` | client opens wild-swap modal if `>1` |
| `forceRefresh` | `{ reason, playerName }` | triggers `window.location.reload(true)` |
| `heartbeat` | `{ timestamp }` | every 10s |

### ⚠️ Dead emits (server emits, client has NO handler)
- **`roundState`** (`server.js:416, 1430`) — the reconnection "resume the timer" payload. **No `socket.on('roundState')` exists on the client.** The round-aware reconnection code that computes and sends this is effectively inert on the UI.
  > **Its payload is now correct**, as of the timer-duration fix — `timeRemaining` is measured
  > against the real round length instead of a hardcoded 30. Adding the missing client
  > listener is a small change that would finally make mid-round reconnection show the right
  > timer. Wiring it up is the fix, not deleting it. Verified on the wire by
  > `tests/reconnection.test.js` scenario 6.
- **`wildCardSelection`** (`server.js:796`) — sent to each player on `nextQuarter`. **No handler.** The client opens the wild-swap modal off `quarterUpdated > 1` instead.

### ⚠️ Dead handlers (client listens, server never emits)
- `playerDisconnected`, `playerReconnected`, `roundEnded` — client has `socket.on` for these but the server never emits them. Safe to delete during rebuild.

---

## 7. Server State (all module-global, keyed by room/socket)

| Object | Shape | Purpose |
|--------|-------|---------|
| `rooms` | `{ [code]: { players, host, gameStarted, quarter, deck } }` | rooms |
| `playerStats` | `{ [socketId]: { totalDrinks, totalShotguns, drinks, shotguns, standard, wild, name?, disconnected? } }` | **global across all rooms** |
| `roundResults` | `{ [code]: { [socketId]: { drinks, shotguns } } }` | current round tally |
| `formerPlayers` | `{ [name]: { id, name, roomCode, totalDrinks, totalShotguns, standard, wild } }` | disconnect snapshot, keyed by **name** |
| `usedCards` | `{ [code]: { standard, wild } }` | discard pile for replenishment |
| `activeRounds` | `{ [code]: { declaredCard, startTime, timeRemaining } }` | round-aware reconnection |
| `socketIdMappings` | `{ [code]: { [oldId]: newId } }` | remap old→new socket ids mid-round |
| `rooms[code].isActionInProgress` | boolean **on the room** | per-room round lock |

`playerStats` remains keyed by socket id across all rooms, but the scoreboard payload is now
built per-room by `buildRoomStats(room)`, straight from `room.players`.

Every lookup into `playerStats` **by player name** is narrowed to the socket ids the room
owns, via `roomSocketIds(room)` / `roomEntriesForName(ownedIds, name)`. Matching on name
alone spanned every game on the server — see the state-bug list below.

| Object | Shape | Purpose |
|--------|-------|---------|
| `rooms[code].wildSwapQuarter` | `{ [playerName]: quarterNumber }` **on the room** | the one-swap-per-player-per-quarter allowance. Keyed by name so it survives a reconnect; stores the quarter so it resets when the quarter advances. |

### State bugs — status

- ✅ **FIXED** `isActionInProgress` was a property of the `rooms` **dictionary**, not
  `rooms[roomCode]` → a global lock that blocked every other game. Now `room.isActionInProgress`.
- ✅ **FIXED** `startGame` did `Object.keys(playerStats).forEach(delete)`, wiping every room's
  stats. Now scoped to `room.players`.
- ✅ **FIXED** `activeRounds[roomCode]` was set in `playStandardCard` *before* the "does anyone
  have the card" check and never cleared on the `noCard` early return, leaving a phantom round
  that reconnecting players were shown. Now set only once the round really starts.
- ✅ **FIXED** `updatePlayerStats` was built from **all** of `playerStats`, leaking every other
  room's socket ids and drink totals into each room's scoreboard.
- ✅ **FIXED 2026-08-14 (Session 3)** `finalizeRound` summed totals and broadcast them
  **before** the `socketIdMappings` merge ran, then discarded the merged result. A player who
  reconnected mid-round lost every drink assigned to them that round, and the entire
  remapping mechanism was dead code. The merge now runs first — a pure statement reorder.
  `tests/reconnection.test.js` 9a and 9b.
- ✅ **FIXED 2026-08-14 (Session 3)** `generateRoomCode` had no collision check, so
  `createRoom` could silently overwrite a live room. It now retries until the code is free.
  **Not test-verified** — forcing a real collision needs ~1,200 open rooms; the bug and the
  fix are both read from the code.
- ✅ **FIXED 2026-08-14 (Session 3)** `wildCardSwap` was unguarded — any player could swap any
  number of wild cards at any time, and only the client modal enforced one per quarter.
  Now **one swap per player per quarter**, tracked on the room as `wildSwapQuarter` and keyed
  by name so a reconnect cannot buy a second one. A refused swap is **silently ignored**; no
  new socket event was added. `tests/swap-guard.test.js`.
- ✅ **FIXED 2026-08-14 (Session 3)** Every `playerStats` lookup by name spanned all rooms.
  Two rooms each with a "Mike" corrupted each other: the reconnecting Mike was awarded the
  **other** Mike's higher score, and the other Mike's entry was then deleted as cleanup. The
  same unscoped match also picked a stranger as your previous identity when building
  `socketIdMappings` mid-round. All five sites are now scoped to the room's socket ids.
  `tests/stats-scoping.test.js`.
- ⚠️ **OPEN BY DECISION — will not be fixed.** A player disconnected when the quarter advanced
  never receives `quarterUpdated` on rejoin through `joinRoom`, so they silently lose their
  wild-card swap. The owner reviewed this (approval item 3) and **declined** the fix: missing
  your swap because you were away is the intended cost. `tests/reconnection.test.js` 11 stays
  `it.fails` permanently as the record of that decision. Do not "fix" it.
- **Unchanged, harmless:** `playerStats[id].drinks = remainder` uses `=` while `.shotguns` uses
  `+=`; both fields are unused downstream (the scoreboard reads `totalDrinks`/`totalShotguns`).

---

## 8. Modals & Screens (client render)

**Screens:** initial (name + create/join), connecting (spinner), lobby (player list + start/share/leave), game.
**In-game modals:**
1. Wild Card Confirmation (host) — `wildCardSelected && isHost`
2. Timer + Drink Assignment — `timeRemaining > 0 && declaredCard !== 'First Down'`
3. No Card — `noCardMessage`
4. First Down — `declaredCard === 'First Down' && timeRemaining > 0`
5. Wild Card Swap — `isWildCardSelectionOpen`
6. Declare Action (host) — `isActionModalOpen` (**hardcodes the 5 standard card names as buttons**)
7. Menu — `isMenuOpen`
8. Host Selection — `isHostSelection`

**Non-modal overlays:** instructions (`alert()`), `ErrorBoundary` crash screen, `?debugrender` / `?debugtest` diagnostic screens, emergency recovery screen.

> The whole `.game-table` grid is sized assuming `document.body.style.zoom = "70%"`, set imperatively in `roomCreated`, `joinedRoom`, and `gameStarted`. `zoom` is non-standard (unsupported in Firefox). The rebuild must remove this dependency.
