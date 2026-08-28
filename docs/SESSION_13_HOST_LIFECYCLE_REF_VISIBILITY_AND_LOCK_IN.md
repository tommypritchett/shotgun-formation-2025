# Session 13 — room lifecycle, who the Ref is, and what "done" means

Four items from live play. Two are lifecycle rules, one is a display bug that turned out to be
bigger than reported, one is a correction to a rule **I got wrong in Session 12**.

Rules unchanged: **no push, no merge, never touch `main`.** All 240 tests stay green. Commit and
tag per item. Leave `.claude/settings.local.json` alone.

---

## 1 & 2 — The room lifecycle is wrong in the same way, twice

Treat these as **one change**. They are the same mistake approached from opposite ends: the code
ends a game when the last *connected* person leaves, when what it should do is end a game when
nobody has been *active* for a while.

### The current rule

`server.js:1676-1694` (`leaveGame`). The braces are indented misleadingly but parse fine — the real
logic is:

```js
if (room.host === socket.id) {
  const stillHere = activePlayers(room);
  if (stillHere.length > 0) {
    room.host = stillHere[0].id;          // ✅ correct — reassigns
    ...
  } else {
    io.to(roomCode).emit('gameOver', '...');
    delete rooms[roomCode];               // ❌ kills the room
    delete usedCards[roomCode];
  }
}
```

So the host leaving **does** reassign correctly when somebody else is connected. What it does not
survive is the host leaving while everyone else's phone happens to be asleep — then the room is
deleted along with their seats, their drinks and their hands, while they are still expected back.
Every other path in this codebase treats a disconnected player as *in the game holding their
totals*. This one nukes them.

The disconnect handler at `:2109-2117` has the same shape and needs the same treatment.

### The rule it should be

**Owner's decision:**
- **The host leaving never ends the game.** Reassign if someone is connected. If nobody is
  connected, leave the room standing with no valid host and let the Session 12 ref-recovery hand
  the whistle to whoever comes back first. That code already exists (`:321-326`) — this is about
  not destroying the room before it can run.
- **A room closes when nobody has been active for 30 minutes.** Not when the last connected person
  leaves.

### The reaper

`disconnectedAt` is already stamped at the disconnect site and read nowhere — it exists for exactly
this. Key off **every player in the room**, so a live game with one dropped phone is never touched:
a room is reapable only when every player is disconnected **and** the most recent `disconnectedAt`
across all of them is older than 30 minutes.

- One interval for the whole server, not one per room.
- Reaping must clean up everything the audit lists as orphaned by room deletion —
  `playerStats` entries for that room's players, `roundResults[roomCode]`, `activeRounds[roomCode]`,
  `socketIdMappings[roomCode]`, `usedCards[roomCode]`, and the room's `formerPlayers` entries.
  This is the one place in the codebase that gets to do a complete teardown; write it once and
  reuse it from the other deletion sites if that is clean.
- A player who **explicitly leaves** is removed from `room.players` outright and does not count.
  Only disconnections park a seat.
- Make the window a named constant, not a literal. `ROOM_IDLE_TIMEOUT_MS`.

### ⚠️ This is not safe to ship alone — read item 2b

**Tests:** host leaves with one active player → reassigned, room lives. Host leaves with only
disconnected players → **room lives**, no host, and the first player back becomes Ref. Room with
all players disconnected 29 minutes → untouched. At 31 minutes → gone, and every global listed above
has no key for it. A room with one connected player and four disconnected for two hours → untouched.

Tag `phase-13-room-lifecycle`.

### 2b — The reaper makes an existing client dead-end much more likely. Fix both together.

This is `AUDIT_PRE_LAUNCH.md` T2.5, and it is currently rare because rooms never die. **Your reaper
will start killing rooms, so it stops being rare.**

Two defects that compound:

1. `App.js:790` — the auto-rejoin bail-out compares `gameState` captured in a `[]`-deps closure, so
   it is frozen at `'initial'` and **the comparison is always false. The bail-out is dead code.**
   Worse, the same timeout removes the only `roomNotFound` listener (`:786-787`), so the reply that
   would rescue the player has nothing listening when it arrives.
2. `shotgunFormation_gameState` is written (`:668`) and **never removed anywhere** — no `removeItem`
   in the file. `leaveLobby`, `handleLeaveGame`, `gameOver` and `hostLeft` all clear the URL and
   none clear storage.

Result once the reaper exists: a player's phone holds a room the reaper has since deleted, auto-rejoin
fires on next open, the server says `roomNotFound`, nobody is listening, and they sit on
*"Rejoining your game…"* forever with no button. On Render's free tier a cold start regularly exceeds
the 10-second timeout, so this fires on the **first load of the evening**.

**Fix:** clear localStorage on every leave/end path, make the bail-out actually work (read from a ref,
not a frozen closure), keep the `roomNotFound` listener alive long enough to be useful, and give the
connecting screen a visible way back to the join screen.

**Test:** a saved game state pointing at a room that no longer exists lands the player on the join
screen with a message, within a bounded time, every time.

Tag `phase-13-rejoin-deadend`.

---

## 3 — Nobody can see who the Ref is. This is not a rejoin bug.

**Reported as:** *"after you rejoin it does not show who the ref is to the other players."*

**What it actually is:** `client/src/App.js:2024`

```js
isRef: player.id === socket.id && isHost,
```

`isHost` is a boolean about **you**. `player.id === socket.id` is only true for **your own row**. So
the REF badge can only ever render on your own row, and only when you are the Ref. **No player has
ever been able to see who the Ref is.** Rejoining is just when you notice, because that is when you
go looking.

The client has **no `hostId` state at all** — grep returns nothing — and **no join, reconnect or
`gameStarted` payload carries the host's id.** The only thing that ever tells a client who the Ref
is, is the `newHost` event. So a player who joins or reconnects after the last `newHost` fired has
no way to know, and a **Ref who reloads gets `isHost: false`** (`useState(false)` at `:178`) until
some future `newHost` happens to fire.

### The fix

- **Server:** include the current host id in the payloads a client uses to build its picture of the
  room — `gameStarted`, the `requestGameState` reconnect reply, and `updatePlayers`. Pick the
  smallest consistent set and say which you chose.
- **Client:** add `hostId` state. Derive `isHost` from `hostId === socket.id` rather than storing it
  separately, and set `isRef: player.id === hostId` at `:2024` so the badge lands on whoever actually
  holds it.

**Do not break the Session 11 handoff guarantee.** `isHost` must still only change when the server
says so — that fix was deliberate and the comment at `:438-439` records why. Deriving it from a
`hostId` that is itself only written by server events preserves that; make sure nothing optimistic
writes `hostId` locally.

**Tests:** four players, one is Ref → all four render the REF badge on the same row. Ref hands off →
the badge moves on every client. The Ref reloads → they come back with the whistle and the badge, and
everyone else still shows it in the right place. A player joining mid-game sees the correct Ref
immediately, with no `newHost` needed.

Tag `phase-13-ref-visibility`.

---

## 4 — Early round end fires too soon. My Session 12 rule was wrong.

`SESSION_12` said the round ends when every player who owes something *"has zero pending, or has
explicitly locked in."* **The first half of that is wrong and I should not have written it.**

**Owner:** *"Once you give all your drinks out but don't lock them in yet it ends the round — should
only be after you end the round."*

They are right. Pouring your last drink is not a statement that you are finished. People pour, look
at the board, change their mind, and undo — Session 11 exists specifically so undo works for the
whole round. A rule that ends the round the instant the last drink lands takes that away and makes
the round feel like it is snatched from you.

### The corrected rule

A round ends early when **every player who is not skipped is done**, where:

| Player | Done when |
|---|---|
| Owes nothing this round (holds no copy of the declared card) | **Automatically.** They have no action; do not make them press anything. |
| Owes something | **Only when they explicitly Lock In.** Pouring everything is *not* done. |
| Disconnected | **Skipped** — unchanged, a dead phone must not hold nine people hostage. |
| First Down | **Excluded from early-end entirely** — unchanged, and your reasoning for an exclusion over a floor was right. |

Locking in with drinks still outstanding remains a forfeit — unchanged.

**Check the affordance while you are in there.** If pouring your last drink no longer ends anything,
Lock In has to be obviously the next thing to do, and it should be clear the table is waiting on you.
If the dock already flips to LOCK IN on the last pour, that is probably enough — confirm it, and say
so.

**Tests:** three players hold the card; all three pour out and none locks in → **the round runs its
full duration.** All three pour out and lock in → ends early. Two hold the card, one is disconnected
→ the connected one locking in ends it. A player who locks in can still not pour afterwards, and a
player who has poured everything can still **undo** right up until they lock in.

Tag `phase-13-lockin-only`.

---

## Also worth fixing while you are in `leaveGame`

`server.js:1705`:
```js
const playerHand = playerStats[player.id];
io.to(player.id).emit('updatePlayerHand', { standard: playerHand.standard, wild: playerHand.wild });
```
Unguarded, and it iterates every remaining player. Every comparable site in the file guards this
lookup. The Session 12 `uncaughtException` handler now stops it ending the server, but it will still
abort the loop and leave the rest of the table without a hand refresh.

---

## Then

Short report: what each defect actually was, the payload set you chose for item 3, test counts, and
anything that differed from the account above — including where this prompt was wrong. Nothing pushed.
