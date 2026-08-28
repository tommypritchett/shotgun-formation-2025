# Session 3 Report

> **Status: complete. All six phases run. Everything committed, nothing pushed.**
>
> Branch `overnight-rebuild` at `f65fc14`, working tree clean. `main` never checked out.
> Tags: `phase-a-approved-fixes`, `phase-b-swap-guard`, `phase-c-stats-scoping`.
> `.git/hooks/pre-push` created and executable, so git itself refuses a push.
>
> **Tests: 83 → 89, all green, run twice clean. Client build exit 0, no new warnings.**

---

## Worst news first

### 1. Phase C was not the bug you thought it was. It is cross-room score theft.

You asked me to stop room B's stale Mike appearing in room A's scoreboard payload — a
display leak. Writing your second assertion first showed the leak is the small half.

**That test came back 10 drinks instead of 5.**

`handleJoinRoom`'s reconnect merge filtered the *entire global* `playerStats` map by name,
took the highest `totalDrinks` as the returning player's score, then deleted every other
matching entry as "cleanup". With a Mike in each of two games:

- room A's Mike reconnects and is **awarded room B's Mike's 9 drinks**, and
- room B's Mike's stats entry is **deleted**, so room B loses his score too.

Two games corrupted from one reconnect, silently, with no error anywhere. The same
unscoped match appears at four more sites, including the one that decides which old socket
id is "you" for mid-round drink attribution — so a stranger in another game could become
your previous identity for the round.

Your instinct that "two Mikes at two different Sunday parties is not exotic" was right, and
it was worse than the payload leak you described. Fixed at all five sites.

### 2. You approved a three-line patch that has no test behind it, and that has not changed.

The room-code collision retry (`fix-4`) is still **read from the code, not observed**.
Forcing a real collision needs ~1,200 simultaneously-open rooms; anything smaller is a coin
flip that would fail randomly in CI. All I verified is that the retry does not break room
creation. **It is three lines — read them yourself before shipping.** It is the only change
in this deploy with nothing standing behind it.

One thing I did not change but should flag: the retry is an unbounded `while (rooms[code])`
loop. At 90,000 possible codes it would need 90,000 live rooms to hang, so it is not a real
risk today — but it is an unbounded loop on a single-threaded server, and it is a
one-line fix to bound it if you ever want to. Logged, not fixed, per Tier discipline.

### 3. Your deploy may not start, for a reason that has nothing to do with this session.

`main` tracks **857 files under `node_modules/`**. This branch removes them (commit
`aac133a`, from the overnight session). If Render's Build Command does not run `npm install`
at the repo root, `node server.js` will crash on `require('express')` after you merge.

I cannot settle this from the repo — there is no `render.yaml`, so the build command lives
in your dashboard. **This is the first thing in `DEPLOY.md`, in bold.** Committing
`node_modules` is often what people do *because* their host isn't installing dependencies,
which is exactly why I am not waving it through.

### 4. Nothing here has been seen in a browser. Still.

Three sessions in, **no client code has been executed at any point**. Every statement about
what the app displays is read from `App.js` source. The suite proves the socket contract and
nothing above it. `MANUAL_TEST.md` exists for this and should be run **before** you push.

---

## What changed

| Phase | Change | Commit | Tag |
|---|---|---|---|
| A | Mid-round merge reorder + room-code retry | `b71899a` | `phase-a-approved-fixes` |
| B | One wild-card swap per player per quarter | `a5889ce` | `phase-b-swap-guard` |
| C | Every `playerStats` name lookup scoped to its room | `cde95c3` | `phase-c-stats-scoping` |
| E | `DEPLOY.md`, `MANUAL_TEST.md` | `f65fc14` | — |

### Your four verdicts, as executed

| Item | Verdict | What I did |
|---|---|---|
| 1 — `buildRoomStats` | Approved, with a residual | Fixed the residual, and the much larger bug behind it. See Phase C. |
| 2 — mid-round drink loss | Approved | Applied. Both patches applied cleanly; no hand-editing. |
| 3 — quarter-swap on reconnect | **Declined** | Left alone. Test 11 renamed to `11. DECLINED BY OWNER`, with a comment saying it is a recorded decision and must not be "fixed". |
| 4 — room code collision | Approved | Applied. |
| O1 — unguarded `wildCardSwap` | Approved separately | Guarded. Phase B. |

### Phase A — the two patches

Both applied cleanly with `git apply`; nothing was hand-edited around.

I did the RED step properly rather than trusting the overnight note: flipped 9a/9b to `it(`
and ran them **before** applying, confirming `expected 4, received 0` — the drinks really
are gone, not misattributed. Then applied, then green.

I also verified fix-2 is genuinely the pure statement reorder it claims to be, by comparing
the sorted line multiset of `finalizeRound` before and after: **identical**. No logic was
added, removed or edited — the merge was simply running too late.

### Phase B — the swap guard

State is `room.wildSwapQuarter = { [playerName]: quarterNumber }`, on the room, as you
asked — no new module-level global. Refusal is silent; no new socket event.

**The reconnect question you asked me to answer: the allowance survives a reconnect.** A
player who swaps in Q2, drops, and rejoins in Q2 does not get a second swap.

I did not treat this as ambiguous, and I want to be explicit about why. Keying by socket id
resets the allowance on every reconnect, and a client can reconnect at will — that is not a
weaker guard, it is a guard with a one-line bypass. So "one swap per player per quarter" has
exactly one implementation that delivers it. Name is a sound key here: `handleJoinRoom`
already refuses a duplicate active name, and the reconnection machinery already treats name
as identity.

Storing the quarter rather than a boolean means the allowance resets when the quarter
advances with no bookkeeping to forget. `startGame` clears the map so a room that plays a
second game is not born spent.

### Phase C — the scoping fix

Two helpers, `roomSocketIds(room)` and `roomEntriesForName(ownedIds, name)`, plus a snapshot
of the room's socket ids taken at the top of `handleJoinRoom` and `requestGameState`. The
snapshot must be taken up front because both reconnect paths destroy what the lookup needs:
one filters the player's old entry out of `room.players`, the other overwrites its id.

**On your Tier B clause.** You said to stop and defer if this could not be done without
tracking room membership on `playerStats` entries. It can: `room.players` already *is* room
membership, including disconnected members, and no `playerStats` entry gained a field. Its
shape is untouched. So I fixed it.

**But it does reach into the reconnection identity machinery**, further than the
`buildRoomStats` one-liner you were expecting. It is the change I would most want you to
read yourself. `git revert cde95c3` backs it out independently.

`buildRoomStats` came out *simpler*, not repaired: it now builds from `room.players` instead
of scanning the global map, so the stale-entry fallback is gone rather than fixed. Those
stale entries were already inert — they went out with `name: undefined`, and the client only
keeps entries carrying a name (`App.js:1268`). It also drops a per-round linear scan of the
global map.

---

## Test counts

| | Before | After |
|---|---|---|
| Test files | 7 | **9** |
| Tests | 83 | **89** |
| `it.fails` tripwires | 3 | **1** |

- `tests/swap-guard.test.js` — **4 new**, all RED before the guard existed.
- `tests/stats-scoping.test.js` — **2 new**, both RED first (`['8a-f6…']` leaked; 10 drinks
  instead of 5).
- 9a and 9b moved from `it.fails` to ordinary passing tests.
- 11 remains `it.fails` **permanently**, as the record of your declined fix.

**No test was deleted or weakened.** Two were changed, both disclosed:

- `edge-cases > never deals an empty card` did 200 back-to-back swaps by one player — which
  was only possible *because* `wildCardSwap` was unguarded. It was asserting that an exploit
  still worked. It now advances the quarter between swaps, so all 200 draws are legitimate.
  Still seconds, still recycles the full wild discard pile.
- `game-actions > nextQuarter` waited for `quarterUpdated` with no `since` mark, so a second
  call returned a stale quarter. Test-helper bug, exposed by the new tests; nothing was
  wrong on the wire.

### Runs

```
run 1   Test Files 9 passed (9)   Tests 89 passed (89)   137.01s
run 2   Test Files 9 passed (9)   Tests 89 passed (89)   159.27s
```

No flaky test across either run. That is two runs, not twenty — "no evidence of flakiness",
not proof.

### Build

`cd client && npx react-scripts build` → **exit 0**, 71.72 kB gzipped JS / 3.23 kB CSS —
**identical to the overnight session's numbers**, which is itself the proof that nothing in
`client/src` that the app uses was touched. All ESLint warnings pre-existing; no new ones.

### Delta audit against `main`

Every changed line in `server.js` maps to one of five accounted-for changes: the Phase 1
concurrency fixes, the merge reorder, the room-code retry, the swap guard, the stats
scoping. **Nothing unaccounted for.** `App.js` and `App.css` are byte-identical to `main`.
`client/src/data/cards.js` and `components/CardIcon.jsx` exist but are **imported by
nothing** — dead files that never enter the bundle.

---

## New Tier B — logged, not fixed

**T1. The room-code retry is an unbounded loop.** `while (rooms[roomCode])` with no attempt
cap. Needs 90,000 live rooms to hang, so not a real risk — but it is an unbounded loop on a
single-threaded server, and bounding it is one line. Your patch, applied as approved.

**T2. A reconnecting player can be re-offered a swap they already used.**
`requestGameState` emits `quarterUpdated` (`server.js:1630`) and the client opens the swap
modal on any `quarterUpdated > 1` (`App.js:944`). So a player who swapped in Q2 and then
reconnects in Q2 sees the modal again; picking a card closes it (the client closes locally
on emit and never waits for a reply) and their hand does not change. Nothing hangs. Today
that same path hands out an unlimited *extra* swap instead, so this is strictly better — but
it is a real UI wart and the fix is client-side, which is out of scope. Step 5.5 of
`MANUAL_TEST.md` asks you to judge whether it looks confusing enough to care about.

**T3. `leaveGame` still silently drops the leaver's round drinks** (O3 from the overnight
report). Unchanged, still arguably correct, still a behaviour nobody decided.

**T4. Deck replenishment threshold is still ≤12 regardless of player count** (O4). Unchanged
and still unverified — reaching it needs about a thousand cards drawn through 21-second
rounds.

---

## Confidence, per change

**1. Mid-round merge reorder (item 2) — high.** Proven a pure statement reorder by line
multiset comparison, RED confirmed by hand before applying, two tests that failed with
`0 instead of 4` now pass. The only gap is that it changes what players see and no player
has seen it. `MANUAL_TEST.md` step 1 is exactly this.

**2. Swap guard (O1) — high on the mechanism, medium on the experience.** Four tests, all
RED first, including the reconnect-bypass case. What I cannot vouch for is how it feels in
the app, because the swap modal has never been opened in a browser. The specific risk is
being *too strict* — step 5.2 is there to catch a legitimate first swap being refused.

**3. Stats scoping (item 1 + the bug behind it) — high on correctness, this is the one to
review.** Both tests RED first, full suite green including every reconnection scenario —
which is what would break if I had "fixed" the leak by damaging the merge, exactly as you
warned. But it is five edits inside the reconnection identity machinery, it is bigger than
the residual you described, and my confidence rests on tests I wrote today plus a read of
client code I have never run. **Read this one yourself.**

**4. Room-code retry (item 4) — low, and unchanged from the overnight report.** Not
test-verified and cannot honestly be. Three lines. Read them.

### Where I'd be wrong, in order

1. **Anything I say about the client.** Three sessions, zero browser executions. The
   `App.js:1268` reasoning that stale entries are inert is a code-read, and it is load-bearing
   for the Phase C simplification.
2. **The two-Mikes fix under real reconnect timing.** My tests model a reconnect as a clean
   drop then a new socket on loopback. Real phones half-open connections and Socket.IO does
   its own backoff. Step 3.7 of the manual test is the real check.
3. **Scale.** Six loopback rooms of three players proves the isolation bug is gone. It
   proves nothing about memory, latency or socket limits. `playerStats` is still one global
   map.
4. **`it.fails` as documentation.** Down to one tripwire, and it is now clearly labelled
   `DECLINED BY OWNER` with a comment saying not to fix it — but it still inverts, and it
   will confuse whoever meets it first.

---

## What I'd do next

1. **Run `MANUAL_TEST.md`, then check Render's Build Command, then ship.** In that order.
   The build-command check takes thirty seconds and is the difference between a deploy and
   an outage.
2. **Wire up `socket.on('roundState')` in the client.** Still the highest-value small change
   available. The payload has been correct since Phase 1 and there is still no listener, so
   a player who refreshes mid-round sees a wrong timer — the single most common real case,
   and step 2.3 of the manual test will show it to you directly.
3. **Then Phase 3, on its own night — and get the client under test first.** 89 tests
   protect the server; the client has zero, and Phase 3 is entirely client work. That
   asymmetry is now the largest risk in the plan, and it grew this session rather than
   shrinking.
4. **Reconsider stable player UUIDs sooner than planned.** Items 2, 3 and today's Phase C are
   all the same root cause: socket id used as identity. Phase C added *more* machinery to
   compensate for it. The UUID refactor would delete considerably more than it adds, and the
   case for it is stronger after today than it was yesterday.

**On the run sheet:** putting Phase C's acceptance test in your own words — "assert that A's
own Mike can still disconnect and reconnect with his totals intact, the second assertion is
the one that matters" — is what surfaced the real bug. A narrower brief would have produced
a clean-looking one-line fix to `buildRoomStats` and left the score theft in place.
