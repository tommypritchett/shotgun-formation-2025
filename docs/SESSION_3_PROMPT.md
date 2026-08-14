# Session 3 — Apply approved fixes, prepare for deploy

I reviewed `OVERNIGHT_REPORT.md`. Here are my verdicts on the four approval items.
Read `docs/proposed/README.md` and the report before starting.

| Item | Verdict |
|---|---|
| **1 — `buildRoomStats`** | **Approved**, but I found a residual bug in review. See Phase C. |
| **2 — mid-round drink loss** | **Approved. Apply the patch.** |
| **3 — quarter-swap on reconnect** | **Declined.** Missing your swap because you were away is a fair cost, and the fix needs new server state. |
| **4 — room code collision** | **Approved. Apply the patch.** |

One thing you buried in item 3's reasoning is approved separately: **observation O1, the
unguarded `wildCardSwap`.** That isn't a design call, it's an exploit — a player can farm
the deck for Doink. See Phase B.

Good call leaving #2 as a patch instead of a commit. The rule existed to stop unsupervised
changes to that machinery; I'm supervising now.

## Ground rules

- **Do not push. Do not merge into `main`. Do not check out `main`.** This session ends with
  everything staged and ready, and I pull the trigger separately.
- `server.js` is in scope. `client/` is still off limits — no file under `client/src` changes.
- Socket event names and payload shapes stay frozen. Adding a guard is fine; changing a
  payload is not.
- Same Tier A / Tier B discipline as before. Anything new that's a judgment call about game
  behaviour: log it, don't fix it.
- Failing test first, then the fix, for every change. Commit and tag per phase.

---

## Phase A — Apply the two approved patches

```
git apply docs/proposed/fix-2-mid-round-drink-loss.patch
git apply docs/proposed/fix-4-room-code-collision.patch
```

Flip `9a` and `9b` in `tests/reconnection.test.js` from `it.fails(` to `it(`.
Run the full suite. Expect 83/83.

If either patch doesn't apply cleanly, stop and tell me rather than hand-editing around it.

Commit → `git tag phase-a-approved-fixes`.

## Phase B — O1: guard `wildCardSwap`

The server currently accepts unlimited wild-card swaps from any player at any time. It
should be **one swap per player per quarter**.

Write the failing test first: a player swaps, then attempts a second swap in the same
quarter, and the second is refused. Then confirm the swap allowance resets on `nextQuarter`.

On the refusal path: **silently ignore it, don't add a new socket event.** The real client
only opens the swap modal on `quarterUpdated` and closes it after one swap, so a second
attempt means a replayed or malformed message, not a user action. Adding an error event
would be new surface the client doesn't listen for.

You'll need per-player per-quarter state that the server doesn't track today. Keep it
scoped to the room — do not add another module-level global keyed by socket id. Note in
`DECISIONS.md` how it survives (or doesn't survive) a reconnect, and if that's ambiguous,
make it Tier B rather than guessing.

Commit → `git tag phase-b-swap-guard`.

## Phase C — The `buildRoomStats` residual I found in review

Your fix scopes the scoreboard payload correctly, and keeping stale name-matched entries so
the client's reconnect merge keeps working was the right call. But the fallback is:

```js
const belongsToRoom = player || memberNames.has(playerStats[playerId].name);
```

That match is **on name alone, with no room association.** So if room B has a stale entry
for a "Mike" and room A also has a "Mike", room B's Mike still leaks into room A's payload —
and the client's "find by name, take the highest `totalDrinks`" heuristic can then attribute
the wrong Mike's score. Two Mikes at two different Sunday parties is not exotic.

Fix it so a stale entry is only included when it genuinely belongs to **this** room.

Failing test first: two rooms, both with a player named "Mike", B's Mike disconnects mid-game
with a non-zero score, assert room A's `updatePlayerStats.players` payload contains no entry
belonging to B's Mike — and, critically, assert that A's own Mike can still disconnect and
reconnect with his totals intact. **The second assertion is the one that matters** — it's easy
to fix the leak by breaking the reconnect merge, and that would be worse than the bug.

If you can't do both without tracking room membership on `playerStats` entries, say so and
make it Tier B rather than shipping a half-fix.

Commit → `git tag phase-c-stats-scoping`.

## Phase D — Verify

- Full suite, twice, clean. Report the count.
- `cd client && npm run build` — succeeds, no new warnings.
- Confirm the only behavioural deltas versus `main` are: the Phase 1 concurrency fixes, the
  mid-round merge reorder, the room-code retry, the swap guard, and the stats scoping.
  Nothing else. If you find a change you can't account for, flag it loudly.

## Phase E — Deploy preparation

**Prepare only. Do not execute any of it.**

### `DEPLOY.md`

- **What actually changes in production.** Diff `main..HEAD` and describe it in plain
  English — what a player would notice, and what they wouldn't.
- **Verify the deploy won't break.** Root `package.json` now has `vitest` and
  `socket.io-client` in `devDependencies`, and `node_modules` was untracked from git.
  Confirm Render's build (`npm run build`, serving `client/build` from Express) is unaffected
  by both. If either is a risk, say so at the top in bold.
- **The exact commands I'll run** to merge and push, in order, copy-pasteable.
- **What's currently blocking a push**, so I'm not surprised: check for
  `.git/hooks/pre-push`, and list the deny rules in `.claude/settings.local.json` that block
  `git push` and `main` checkout. Tell me exactly what to remove and what to leave.
- **Rollback.** Exact commands to get production back to `e994b5f` / tag `pre-ui-rebuild`,
  and how fast that is.

### `MANUAL_TEST.md`

A checklist for me to run on two phones plus a laptop before pushing. This is the part your
suite explicitly cannot cover — no client code has run at any point, by your own admission.
Numbered steps, exact expected result for each, space to tick off. Cover at minimum:

1. **The #2 fix, end to end** — player accumulates drinks over several rounds, drops
   mid-round while a drink window is open, rejoins, totals are intact. This is the whole
   reason we're deploying.
2. **Browser refresh mid-round** (scenario 7) — the most common real case.
3. **Two concurrent games on one server** — the outage bug. Two rooms, both mid-game, both
   finish rounds, neither disturbs the other and the process stays up.
4. **Host leaves mid-game** — new host assigned, game continues.
5. **The swap guard from Phase B** doesn't block the legitimate one-per-quarter swap.
6. **`actionInProgress`** — the client handles this with a browser `alert()`, which is
   completely unexercised. Note what it actually does on screen.

Call out which steps need a real second device versus an incognito window.

## Phase F — Report

Write `SESSION_3_REPORT.md`: what changed, test counts before and after, anything new that
became Tier B, and your confidence on each of the four changes. Same format as before —
blunt, worst news at the top.

Then stop. Everything committed, nothing pushed, working tree clean.
