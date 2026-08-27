# Follow-ups

One place to look for work that was deliberately deferred. Everything here was found with a
reason for not fixing it at the time; none of it was silently dropped.

**F1 is DONE** (Session 14, `phase-14-scoped-game-stats`). F2 is now unblocked and provable.

Not to be confused with `BLOCKED.md`, which records things that could not be *done or
tested* rather than things chosen for later.

---

## F1 — `gameStarted` leaks every room's `playerStats` ✅ **FIXED, Session 14**

**Status:** fixed on `overnight-rebuild`, tag `phase-14-scoped-game-stats`. Still live on
`main` until the deploy lands. **Was not a regression** — this branch never made it worse,
which is why it was correct not to touch it hours before a push.

**What it was:** the `gameStarted` emit sites sent the **module-global `playerStats`** —
every room on the server — not this room's. There turned out to be **five**, not four: the
room-wide kickoff broadcast wrote it in ES6 shorthand (`playerStats` rather than
`playerStats: playerStats`), so it did not match the grep every previous audit used, and it
is the largest of the five.

Session 1 scoped `startGame`'s stats reset; Session 3 scoped `updatePlayerStats` via
`buildRoomStats(room)` and scoped every `playerStats` name lookup. **Nobody checked
`gameStarted`.** It is the same leak class, at the one site we all walked past.

It matters more than a payload leak, because `App.js:1573` writes that payload **straight
into client state** with no filtering — so another game's players land in your client's
`playerStats`, where the scoreboard's name-resolution then reads them.

**The fix, as shipped:** all five sites point at the existing `buildRoomStats(room)`.
Covered by `tests/game-started-scoping.test.js` (5 tests), including one that asserts the
payload does **not** shrink to nothing for your own room, and one that asserts it stops
growing with rooms the server has hosted since.

**The bonus — and the reason this unblocks a deletion:** `buildRoomStats` only emits entries
that carry a `name`. Now that this is fixed, the "process of elimination" fallback in
`App.js` is genuinely unreachable, and the UI rebuild can delete that whole block **with
proof instead of on somebody's say-so.** See F2. Deliberately NOT deleted in Session 14:
removing client code the day before a deploy is not a trade worth making.

---

## F2 — For the record: "that elimination fallback is dead code" was wrong

Recorded so a future session does not rediscover this the hard way, in either direction.

**The claim (Session 4 prompt):** the `Object.values(playerStats).filter(s => !s.name)`
fallback at `App.js:2051` / `:2156` is unreachable, because `App.js:1268` gates on
`if (backendStats.name)` and so an unnamed entry can never enter client state. Therefore
the block is deletable.

**It is wrong, and the premise is right — which is what makes it easy to get wrong.**
`App.js:1268` genuinely does gate the `updatePlayerStats` path. But that is **one of four
writers** to that state:

| Line | Writer | Filters unnamed? |
|---|---|---|
| `1253` | `updatePlayerStats` handler | ✅ yes — the one that was checked |
| **`1573`** | **`gameStarted` handler — `setPlayerStats(playerStats)`** | ❌ **no, raw payload** |
| `1047`, `1072` | localStorage restore | ❌ no — restores whatever was in state |

And `gameStarted`'s entries have no name: `startGame` builds each as
`{ totalDrinks, totalShotguns, standard, wild }` (`server.js:756`). `name` is only ever
stamped on at **disconnect** (`server.js:1742`).

**Why that makes the fallback reachable.** It is guarded by `if (!stats)` where
`stats = playerStats[player.id]`, so it needs three things at once:

1. the player's socket id is not a key in the map — **true after any reconnect**;
2. no entry matches their name — **true when the last write came from `gameStarted`**,
   because those entries have no name for Strategy 1 to match;
3. at least one unnamed entry exists — **true for the same reason**.

A reconnect delivers `gameStarted`, which overwrites state with the unnamed map. That is
exactly the state where Strategy 1 misses and Strategy 2 fires — picking the unnamed entry
with the highest `totalDrinks` and showing it as that player's score. Combined with F1, the
map it picks from can contain players from other games entirely.

**Calibration:** reachable *by construction*, from reading the code. Nobody has observed it
fire, because no client code has been executed in any session to date. The defensible
statement is not "it runs often" — it is that **"it can never run" is not supported by the
code**, so deleting it on that basis is unsafe.

**What to do:** fix F1 first. Then the claim becomes true, and the deletion is provable.

---

## P1 — Round Results stays anonymous. PRODUCT DECISION, not tech debt.

**Do not "improve" this.** Round Results reads *"Marcus drank 2"*, never
*"Shannon gave Marcus 2."*

Session 7 logged the missing attribution as a limitation of the frozen wire, and
a later session proposed changing the payload to carry the pourer. **The owner
reviewed that and rejected it, deliberately.**

**The reasoning:** keeping it anonymous stops players targeting each other in
online games. In person the table already knows who poured — that is where the
fun lives, and it needs no help from the app. Over the internet, naming the
pourer turns into griefing.

So the payload staying recipient-only is the DESIRED behaviour, not a gap. If a
future session finds itself thinking "the server should really send who poured",
this is the answer: it should not.

**The same reasoning applies to the passive screen.** Do not add per-player pour
attribution there either.

---

## P2 — RESOLVED: the app is capped at 10 players, matching the box

**Decided by the owner:** the box is a printed promise, and it is cheaper to
match it than to explain the gap.

`handleJoinRoom` now refuses an 11th player with the existing `error` event.
`MIN_PLAYERS` / `MAX_PLAYERS` are constants on both sides; the menu reads
`N / 10` from the client constant rather than a hardcoded number.

**A disconnected player still holds their seat** — they own drinks and are
expected back, so they count against the cap. Tested both ways.

Ten is also exactly the size of the avatar sheet, so a full table now has ten
distinct characters and nobody shares one. The accent-ring machinery stays: it
costs nothing and it is what saves us if the cap ever moves.

`tests/edge-cases.test.js` traded its 13-player test for a full-10 test plus two
cap tests.

---

## P3 — RESOLVED: source art moved out of `client/`

**Decided by the owner:** keep it in the repo, get it out of `client/`.

`client/src/assets/` and `docs/avatars-contact-sheet.png` are now `art/`, with a
README explaining what each file is and that regenerating avatars means
regenerating `Avatars.js`, not these.

`client/src` went from 13 MB to **4 MB**. CRA no longer walks ~9.5 MB of PNGs and
a zip on every build and every hot reload, for files no bundle has ever
referenced. Nothing in the app pointed at them: the avatars are inlined data URIs.

---

## F3 — The error message renders twice

`App.js:1934` and `:1935` are the identical line:

```jsx
{errorMessage && <p style={{color: '#ff6666', marginTop: '10px'}}>{errorMessage}</p>}
```

Cosmetic and pre-existing. Newly relevant because Session 4's room-code exhaustion path
emits the existing `error` event, which reaches this render — so a path that was near
unreachable now has a real trigger. Delete one of the two lines during the UI rebuild.

---

## F4 — `leaveGame` silently drops the leaver's round drinks

(Was T3.) `leaveGame` removes the player from `room.players`, and `finalizeRound` only
iterates `room.players`, so drinks assigned to them that round vanish. Arguably correct —
they left — but it is a silent behaviour nobody decided on. A judgment call, not a bug.

## F5 — Deck replenishment threshold is `≤12` regardless of player count

(Was T4.) `playStandardCard` splices before calling `checkAndReplenishDecks`, so with 13
players holding several copies each, one declaration can need well over 12 cards and hands
could shrink below 5. **Unverified** — reaching it needs on the order of a thousand cards
drawn through 21-second rounds. `12 * playerCount` would be the conservative fix.

## F6 — A player away at the quarter change loses their wild-card swap

(Was T2 / approval item 3.) **Reviewed and declined by the owner** — missing your swap
because you were away is the intended cost. `tests/reconnection.test.js` scenario 11 stays
`it.fails` permanently as the record. **Do not "fix" this**; it is here so nobody mistakes
the failing test for outstanding work.

---

## Closed

- **T1 — unbounded room-code retry.** Fixed in Session 4 (`d8320f2`): bounded at 50
  attempts, refuses via the existing `error` event. Measured before the fix: 45,592,070
  spins in 3 seconds without returning, which pins the event loop and stops every game on
  the server.
- **The `node_modules` deploy blocker.** Resolved in Session 4: the root build script now
  runs its own `npm install`, verified by a clean-checkout build-and-serve rehearsal.
