# Decisions made without you

Judgment calls taken overnight, most conservative option each time. Everything here
is reversible; nothing here changed game behaviour unless explicitly stated.

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
