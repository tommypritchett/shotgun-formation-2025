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
