# Proposed fixes — NOT applied

These are the Tier B changes from `OVERNIGHT_REPORT.md`. They are **not** in `server.js`.
The repo is in its unfixed state; these files exist so approving them in the morning is a
one-line command rather than an afternoon of work.

```bash
git apply docs/proposed/fix-2-mid-round-drink-loss.patch
git apply docs/proposed/fix-4-room-code-collision.patch
```

---

## `fix-2-mid-round-drink-loss.patch` — **verified working**

**Approval item 2.** Moves the `socketIdMappings` merge block inside `finalizeRound` so it
runs **before** the totals are summed, instead of after they have already been summed,
broadcast, and thrown away.

It is a **pure statement reorder** — no logic added, removed, or edited. The merge already
handled transitive `A→B→C` chains correctly; it was simply running too late to matter.

**I applied this, tested it, and reverted it.** Evidence:

- `reconnection.test.js` 9a and 9b, flipped from `it.fails` to `it`, both **pass**.
- **Full suite with the patch applied: 83 passed (83), 7 files. No regressions.**

**To adopt it:**

```bash
git apply docs/proposed/fix-2-mid-round-drink-loss.patch
# then flip 9a and 9b in tests/reconnection.test.js from `it.fails(` to `it(`
npm test
```

**Still verify by hand before trusting it.** Two phones, one player accumulating drinks
across several rounds, disconnecting and returning mid-round. The tests prove the socket
contract; they do not prove the UI renders it.

---

## `fix-4-room-code-collision.patch` — **not test-verified**

**Approval item 4.** Retries `generateRoomCode()` until it returns a code not already in
`rooms`. Three lines, no payload change, no client change.

**I could not write a test that proves the bug.** `Math.random()` has no seam the harness can
control, and forcing a real collision needs ~1,200 simultaneously-open rooms to be ~99%
likely — anything smaller is a coin flip that would fail randomly in CI. See `BLOCKED.md` B2.

What I did verify: with the patch applied, `edge-cases.test.js` and `concurrency.test.js`
still pass (13/13), so the retry loop does not break room creation.

**The bug itself is read from the code, not observed.** `createRoom` does
`rooms[roomCode] = {...}` with no existence check, so a collision overwrites a live room's
game object and points two groups at the same code.

---

## Not included

**Approval item 3** (a player away at quarter change loses their wild-card swap) has no patch,
because it is not a small change. It needs new per-player "swapped this quarter" state on the
server, and it should be done together with guarding `wildCardSwap`, which currently lets any
player swap any number of times (observation O1). That is a design decision, not a patch.
