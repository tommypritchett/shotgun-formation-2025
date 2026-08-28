# Decisions made without you

Judgment calls taken overnight, most conservative option each time. Everything here
is reversible; nothing here changed game behaviour unless explicitly stated.

**D1–D6 are from the overnight session. D7–D9 are from Session 3**, where you were
supervising — they are recorded for the same reason, but you approved the work they sit
inside.

---

## D1 — Test runner: Vitest, root devDependency only

**Chose:** `vitest@2.1.9` + `socket.io-client@4.8.1` in the **root** `package.json`
`devDependencies`. `client/package.json` untouched.

**Why:** The prompt allowed Vitest or Jest. Jest would have collided with the
`react-scripts` Jest config in `client/`; Vitest at the root is fully isolated from
the client build. `devDependencies` means Render's `npm run build` never installs
them, so production is unaffected. No existing dependency was upgraded.

**Reversible by:** `npm uninstall vitest socket.io-client` at the repo root.

---

## D2 — The harness spawns `server.js` as a child process rather than requiring it

**Chose:** `spawn(node, ['server.js'], { env: { PORT: <free port> } })`, waiting on the
`Server is running on port N` line.

**Why:** `server.js` calls `server.listen()` at module load and exports nothing.
Requiring it in-process would have meant editing production code purely for
testability — refactoring the entrypoint is a bigger change than the four fixes I was
asked to make, and it is exactly the kind of thing you would want to approve first.
Spawning also gives each test file a genuinely isolated server, which is what a
concurrency test suite needs.

**Cost:** Tests cannot read server internals (`activeRounds`, `rooms.isActionInProgress`)
directly. See D3.

---

## D3 — Tests assert on observable socket behaviour, not on server internals

**Chose:** Where the prompt says "assert `activeRounds[roomCode]` is clear", the test
asserts the two things a player can actually observe when that state is stale:

1. a reconnecting player is **not** sent a `declaredCard` / `roundState` for a round
   that never started, and
2. the next declaration is accepted rather than rejected with `actionInProgress`.

**Why:** This follows the Phase 2 instruction ("assert on the *observable* outcome …
don't assert on internal structure") and avoids adding a debug/state-dump endpoint to
`server.js`, which would be a new production surface. The observable assertions fail
before the fix and pass after it, which is what matters.

---

## D4 — Root `npm test` now runs the suite

**Chose:** Changed root `package.json` `"test"` from `echo "Error: no test specified" && exit 1`
to `vitest run`.

**Why:** There is now a real suite. Render runs `npm run build`, never `npm test`, so
deployment is unaffected.

---

## D5 — Fixed a fifth bug in the same family: cross-room scoreboard leakage

**Found:** `finalizeRound` and `firstDownEvent` both built their
`updatePlayerStats.players` payload with `Object.keys(playerStats).forEach(...)`.
`playerStats` is keyed by socket id across **every room on the server**, so each room's
scoreboard broadcast contained every other room's socket ids and drink totals.

**Chose:** Extracted `buildRoomStats(room)` (server.js, above `finalizeRound`) and used it
at both sites. It keeps entries for players currently in the room, **plus** stale entries
whose `name` matches a current member — because the client's reconnect merge looks players
up by name and would break if those vanished. The `name`/`disconnected` fields are computed
exactly as before, so the payload shape is byte-identical for a single-room server.

**Why this was in scope:** Phase 1 said to fix other global-state-that-should-be-room-scoped
bugs in the same family and flag them for review. This is that. **Please review it** — it is
the one Phase 1 change you did not explicitly ask for.

**Risk:** Low. Pure filter, no shape change. Covered by
`concurrency.test.js > does not leak one room's players into another room's scoreboard`.

---

## D6 — `Safety` used as the "card nobody holds" in the phantom-round test

**Chose:** The phantom-round test declares `'Safety'` as a Standard card.

**Why:** The test needs a declaration nobody can answer, deterministically. Picking a real
Standard card and hoping no one drew it is flaky at 3 players. `Safety` is a real card in
`generateDecks` but lives in the **wild** deck, so it can never appear in
`playerHand.standard` — the `noCard` branch fires every time, using a real wire value
rather than a made-up string.

---

## D7 — The swap allowance is keyed by player NAME, so it survives a reconnect

**Chose:** `room.wildSwapQuarter = { [playerName]: quarterNumber }`, on the room object.
A swap is refused when the recorded quarter equals the room's current quarter.

**The reconnect question you asked me to answer: the allowance SURVIVES a reconnect.**
A player who swaps in Q2, drops, and rejoins in Q2 does **not** get a second swap. When
the quarter advances they get their next one normally. Asserted directly by
`swap-guard.test.js > does not hand out a fresh swap to a player who reconnects`.

**Why this is not a guess.** The alternative — keying by socket id — resets the allowance
on every reconnect, and a client can reconnect at will. That is not a weaker version of
the guard; it is a guard with a one-line bypass, which defeats the entire point of
closing the exploit. So the requirement "one swap per player per quarter" only has one
implementation that actually delivers it. That is why this is D7 and not a Tier B item.

Name is a sound identity key here: `handleJoinRoom` refuses a name already active in the
room, and the existing reconnection machinery already treats name as identity
(`formerPlayers` is keyed by name, and the client's stats merge looks players up by name).

**Storing the quarter rather than a boolean** means the allowance resets the instant
`room.quarter` advances, with no reset step to forget. `startGame` clears the map as well,
so a room that plays a second game does not start it with quarter 1 already spent.

**One consequence you should know about, and it is cosmetic — see also Tier B item T2.**
`requestGameState` emits `quarterUpdated` (server.js:1630) and the client opens the swap
modal on any `quarterUpdated > 1` (App.js:944). So a player who already swapped this
quarter and then reconnects will be **re-offered a modal that the server will now no-op**:
they pick a card, the modal closes (the client closes it locally on emit, App.js:461, and
never waits for a reply), and their hand simply does not change. Nothing hangs and nothing
breaks. Today that same path hands out an unlimited extra swap instead, so this is
strictly an improvement — but it is a real, if small, UI wart, and fixing it is a client
change, which is out of scope this session.

**Reversible by:** deleting `hasSpentSwapThisQuarter` / `recordSwap` and their two call
sites in the `wildCardSwap` handler.

---

## D8 — The deck-replenishment test now advances the quarter between swaps

**Chose:** `edge-cases.test.js > never deals an empty card under sustained play` did 200
back-to-back swaps by one player — which was only possible *because* `wildCardSwap` was
unguarded. With the guard in place that test was asserting an exploit still worked.

It now calls `nextQuarter()` before each swap, so all 200 draws are legitimate. The test
still runs in seconds, because `nextQuarter` has no timer either, and it still drives a
full recycle of the wild discard pile.

**Why not just delete it:** it is the only test that reaches deck replenishment at all.

---

## D9 — Fixed a latent bug in the `nextQuarter` test helper

**Found:** `game-actions.js > nextQuarter` did `host.waitFor('quarterUpdated')` with no
`since` mark, so it matched the **first** `quarterUpdated` in the whole event log. The
second call in a test therefore returned a stale `2` instead of `3`.

Nothing was previously wrong on the wire — no existing test advanced the quarter twice and
checked the result, and the round trip was still genuinely awaited via the watcher path.
Two of the new Phase B tests advance the quarter twice, which is what exposed it.

**Chose:** give the host its own mark, exactly like the watchers already had. Test-only
change; `server.js` is not involved.

---

## D10 — Phase C was not a payload leak. It was cross-room score theft.

**Read this one.** You asked me to stop room B's stale Mike appearing in room A's
`updatePlayerStats` payload. Writing your second assertion first — A's own Mike
disconnects and reconnects with his totals intact — showed the leak is the *small* half
of the problem. That test came back **10 drinks instead of 5**.

**What is actually happening.** `handleJoinRoom`'s reconnect merge (was server.js:488) did:

```js
const allPlayerEntries = Object.entries(playerStats).filter(([id, stats]) =>
  stats.name === playerName);          // every room on the server
```

then took the entry with the **highest** `totalDrinks` as the returning player's score,
then **deleted every other matching entry** as "cleanup". So with a Mike in each of two
games:

- room A's Mike reconnects and is awarded **room B's Mike's 9 drinks**, and
- room B's Mike's stats entry is **deleted**, so room B loses his score too.

Both rooms corrupted, from one reconnect, silently. The same unscoped name match appears
at four more sites: the mid-round `oldEntry` lookup that builds `socketIdMappings`
(so a stranger becomes your previous identity for the round), and all three equivalents
in the `requestGameState` fast-reconnect path.

**Chose:** narrow every name lookup into the global `playerStats` map to the socket ids
the room owns. Two small helpers, `roomSocketIds(room)` and
`roomEntriesForName(ownedIds, name)`, and a snapshot of the room's ids taken at the top of
`handleJoinRoom` and `requestGameState`.

The snapshot has to be taken **before** the reconnect paths run, because they destroy the
very thing being looked up: `handleJoinRoom` filters the player's old entry out of
`room.players` (:434), and `requestGameState` overwrites its id in place (:1461).

**On your "make it Tier B" clause.** You said to say so and stop if this could not be done
without tracking room membership on `playerStats` entries. It can: `room.players` already
*is* room membership, including disconnected members, and nothing was added to a
`playerStats` entry. Its shape is untouched. So I fixed it rather than deferring it.

**But be aware this reaches into the reconnection identity machinery** — further than the
`buildRoomStats` one-liner you were expecting. It is the change in this session I would
most want you to look at yourself. Reverting it is `git revert phase-c-stats-scoping`.

**`buildRoomStats` itself is now simpler, not more complex.** It builds the payload from
`room.players` instead of filtering the global map, so the stale-entry fallback is gone
rather than repaired. Those stale entries were already inert: they went out with
`name: undefined`, and the client keeps only entries that carry a name (App.js:1268).
It also removes the per-round linear scan of the global map.

**Verified by:** `tests/stats-scoping.test.js`, both tests RED first (`['8a-f6…']` leaked,
and 10 drinks instead of 5). Full suite 89/89 with no regressions — in particular
reconnection scenarios 5, 7, 9a, 9b and 10, which are the ones that would break if this
had been "fixed" by damaging the reconnect merge.
