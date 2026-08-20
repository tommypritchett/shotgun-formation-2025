# Follow-ups

One place to look for work that was deliberately deferred. Ordered: **F1 is the first thing
to do once the deploy lands.** Everything here was found with a reason for not fixing it at
the time; none of it was silently dropped.

Not to be confused with `BLOCKED.md`, which records things that could not be *done or
tested* rather than things chosen for later.

---

## F1 — `gameStarted` leaks every room's `playerStats` ⚠️ **do this first, after the deploy**

**Status:** live on `main` today. **Not a regression** — this branch does not make it worse,
which is why it was correct not to touch it hours before a push.

**What:** all four `gameStarted` emit sites send the **module-global `playerStats`** —
every room on the server — not this room's:

| Site | Context |
|---|---|
| `server.js:679` | mid-game rejoin through `handleJoinRoom` |
| `server.js:762` | rejoin, hand restored |
| `server.js:867` | `startGame` — the main one |
| `server.js:1501` | `requestGameState` fast reconnect |

Session 1 scoped `startGame`'s stats reset; Session 3 scoped `updatePlayerStats` via
`buildRoomStats(room)` and scoped every `playerStats` name lookup. **Nobody checked
`gameStarted`.** It is the same leak class, at the one site we all walked past.

It matters more than a payload leak, because `App.js:1573` writes that payload **straight
into client state** with no filtering — so another game's players land in your client's
`playerStats`, where the scoreboard's name-resolution then reads them.

**The fix:** point all four sites at the existing `buildRoomStats(room)`. It is already
written, already tested, and already the shape the client expects.

**Why it is worth doing properly rather than quickly:** it changes payload *contents* at a
site the client consumes directly into state, so it wants a failing test first (two rooms,
assert room A's `gameStarted.playerStats` contains nobody from room B) and a real review.

**The bonus — and the reason this unblocks a deletion:** `buildRoomStats` only emits entries
that carry a `name`. Fixing this makes the "process of elimination" fallback at
`App.js:2051` / `:2156` genuinely unreachable, at which point the UI rebuild can delete that
whole block **with proof instead of on somebody's say-so.** See F2.

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

## P2 — The box says 3–10 players; the app has no upper limit at all

Flagged for a decision, changed nothing.

**Where the numbers actually come from:**

| | |
|---|---|
| Printed box | "3–10 PLAYERS · 160 CARDS" |
| Server | **no upper bound**. The only check is `room.players.length >= 3` at `startGame`. |
| Client | `MIN_PLAYERS = 3`. No maximum. |
| Avatar sheet | 10 characters, so 11+ share a character (the accent ring keeps them apart) |
| The number 13 | appears in the menu label `{playerCount} / 13` and a 13-player test. It is **not enforced anywhere** — it is a leftover figure, not a cap. |

**Would capping at 10 break anything?** Nothing structural. The deck is generated
as `78 × playerCount`, so it scales either way, and the assigner grid already
switches to a 3-column layout above 6 targets. Three concrete things would need
touching:

1. a new guard in `handleJoinRoom` (there is no cap to change, one would be added)
2. the menu's `/ 13` label
3. `tests/edge-cases.test.js` "runs a 13-player room", which would have to become
   a "refuses an 11th player" test

**The real question is a product one:** should the app enforce what the box
promises, or quietly allow bigger tables than the printed deck supports? Worth
noting that at 11+ players two people share an avatar character, so 10 is also
where the UI stops being able to give everyone their own face.

---

## P3 — Repo weight: ~18 MB of images that the app never loads

Recommendation only, changed nothing.

| Path | Size | Needed at runtime? |
|---|---|---|
| `client/src/assets/` | **9.2 MB** | **No.** Source art, a logo reference, and a cutouts zip. The avatars are inlined as data URIs in `Avatars.js`. |
| `screenshots/` | 8.6 MB | No. Session 7 deliverable. |
| `docs/avatars-contact-sheet.png` | 360 KB | No. For eyeballing. |

`client/src/assets/` is the one worth acting on, for a reason beyond size: it
sits **inside `client/src`**, so CRA walks it on every build and every hot
reload. A 2.6 MB zip and two large PNGs in the watched tree cost time on every
save for no benefit.

**Three options, in the order I would pick them:**

1. **Move them out of `client/src`** — to `docs/art/` or a top-level `art/`.
   Keeps them in the repo and in history, stops CRA watching them. Cheapest fix,
   no loss.
2. **Gitignore them**, keeping them only on disk. Smallest repo, but the source
   art is then one laptop away from being lost.
3. **Leave them.** 18 MB is not fatal; it is just permanent.

Option 1 is a `git mv` and costs nothing.

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
