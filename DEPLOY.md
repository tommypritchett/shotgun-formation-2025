# Deploy — Session 4

> **Prepared, not executed.** Nothing here has been run. Nothing is pushed, `main` was
> never checked out. Branch `overnight-rebuild` at `d8320f2`, working tree clean.

---

## ✅ The dependency risk is resolved

Session 3 led with a blocker: `main` tracks 857 files under `node_modules/`, this branch
removes them (commit `aac133a`), and if Render never ran a **root** `npm install` the server
would crash on `require('express')` after the merge.

**That is fixed, and it no longer depends on a setting either of us can see.**

### What the risk actually was

Root `npm run build` used to be `cd client && npm install && npm run build`. That installs
the **client's** dependencies and nothing else — never `express`, `cors` or `socket.io` for
the server. Production worked anyway because `node_modules` was committed to git. Remove it
from git without a root install somewhere in the chain, and `node server.js` has nothing to
load.

### Why it is no longer a risk

The root build script now installs root dependencies itself:

```json
"build": "npm install && cd client && npm install && npm run build"
```

Your reasoning that the rest was answerable from the repo was right: `client/build` is
gitignored and untracked on `main` (`git ls-tree main -- client/build` → zero files), the
server serves it statically, and the site works today — so Render must already be running
`npm run build`, which also proves `cd client && npm install` happens there. The only gap was
the root install, and the script now closes it regardless of how the dashboard is configured
or who changes it later.

**Verified from a genuinely clean state**, not reasoned about:

```
mv node_modules ..              # root deps gone
mv client/node_modules ..       # client deps gone
mv client/build ..              # build output gone
npm run build                   # the exact command Render runs
PORT=3999 NODE_ENV=production node server.js
```

Result: both dependency trees installed, `client/build` produced, server started, `GET /`
returned **200** with the real `index.html` (706 bytes, referencing `main.e4171912.js`), and
`GET /static/js/main.e4171912.js` returned **200** with all 236 kB. Same bundle hashes as
every previous build. `package-lock.json` was not modified by the install.

### The 30-second dashboard check you can still do

Not required any more — this is confirmation, not a gate.

**Render → your service → Settings:**

| Field | Should read | Note |
|---|---|---|
| **Build Command** | `npm run build` | `npm install && npm run build` is also fine — the extra install is now redundant but harmless. |
| **Start Command** | `npm start` or `node server.js` | Both are identical; `start` is `node server.js` and is unchanged from `main`. |

The only setting that would still be wrong is a Build Command that does **not** invoke
`npm run build` at all — e.g. one that calls `react-scripts build` directly. If you see
that, change it to `npm run build`.

**The `devDependencies` half was never a risk.** `vitest` and `socket.io-client` are root
`devDependencies` only. Render sets `NODE_ENV=production`, so `npm install` skips them; and
even installed they are never loaded, because `npm start` is `node server.js`, which imports
neither. Render never runs `npm test`.

`dependencies`, and the `start` script, are byte-identical to `main`:

```diff
   "scripts": {
-    "test": "echo \"Error: no test specified\" && exit 1",
+    "test": "vitest run",
+    "test:watch": "vitest",
     "start": "node server.js",                                      <- unchanged
-    "build": "cd client && npm install && npm run build"
+    "build": "npm install && cd client && npm install && npm run build"
   },
   "dependencies": {                        <- unchanged, same versions
     "cors": "^2.8.5", "express": "^4.21.1", "socket.io": "^4.8.1"
+  },
+  "devDependencies": {
+    "socket.io-client": "^4.8.3", "vitest": "^2.1.9"
   }
```

---

## What actually changes in production

`server.js` only. **No file under `client/src` that the app uses was modified** — `App.js`
and `App.css` are byte-identical to `main`, and the client bundle is unchanged
(71.72 kB gzipped, same hash inputs, same 3.23 kB CSS as before the session).

### What a player will notice

1. **Two groups can play at the same time without killing the server.** This is the big
   one and it predates this session. On `main`, the moment a second group starts a game
   the server deletes the first group's players from its stats map; the next round to
   finish throws inside a `setInterval` and **the entire Node process dies**, ending every
   game on the server at once. Two Sunday parties was enough. Fixed.
2. **If your phone drops mid-round, you keep the drinks you were given.** On `main` they
   are silently deleted — not misattributed, gone. Your friends watched you get four
   drinks and the scoreboard says zero. This is the single change most likely to be
   noticed in a good way.
3. **Two people called Mike in two different games no longer corrupt each other.** On
   `main`, when Mike in game A reconnects he is awarded Mike-in-game-B's score if it is
   higher, and Mike-in-game-B's score is then deleted. Both games are damaged, silently,
   from one reconnect.
4. **A reconnecting player is shown the correct time left in the round** (21s rounds used
   to claim 30s remaining). Round lengths themselves are unchanged: 21 / 11 / 6.
5. **You get one wild-card swap per quarter, and only one.** Previously the server
   accepted unlimited swaps and only the app's modal stopped you; you could reroll your
   whole hand and fish for a 40-drink Doink.

### What a player will NOT notice

- No visual change of any kind. No new screens, no restyling.
- No change to round lengths, card values, deck sizes, drink maths, or the 10→1 shotgun
  fold.
- No socket event renamed, added or removed. No payload shape changed. The `disconnected`
  field is passed through exactly as before, `undefined` and all.
- Being away when the quarter turns still costs you that quarter's swap — you reviewed
  this (approval item 3) and declined a fix.

### The six behavioural deltas, and nothing else

Audited line by line with `git diff main HEAD -- server.js`. Every changed line maps to one
of these; there is nothing unaccounted for.

| # | Change | Where |
|---|---|---|
| 1 | Phase 1 concurrency fixes: room-scoped `playerStats` reset, `room.isActionInProgress` instead of `rooms.isActionInProgress`, `activeRounds` set only once a round really starts, one `ROUND_DURATIONS` constant | `5d0a8ef` |
| 2 | Mid-round merge reorder — a reconnecting player keeps that round's drinks | `b71899a` |
| 3 | Room code collision retry | `b71899a` |
| 4 | One wild-card swap per player per quarter | `a5889ce` |
| 5 | Every `playerStats` name lookup scoped to the room that owns it | `cde95c3` |
| 6 | Room-code retry bounded at 50 attempts; on exhaustion it refuses cleanly via the existing `error` event instead of pinning the event loop | `d8320f2` |

Two new files exist under `client/src` — `data/cards.js` and `components/CardIcon.jsx`,
both from `aac133a`, both from your own earlier work. **Neither is imported by anything.**
They ship as dead code and do not enter the bundle; the build output is byte-for-byte the
size it was before they existed.

---

## Verification behind this

- `npm test` → **94 passed (94), 10 files**. Run twice back to back, clean both times.
  No flakes across the runs.
- **`npm run build` from a completely clean checkout** — no root `node_modules`, no client
  `node_modules`, no `client/build` — then `node server.js` under `NODE_ENV=production`,
  serving both `/` and the JS bundle with **200**. This is the deploy rehearsal, not just a
  compile check.
- All ESLint warnings pre-existing; **no new warnings**, as expected since nothing in
  `client/src` changed. Bundle hashes identical to every previous build.
- Test count went 83 → 89 → **94**: +4 swap guard, +2 stats scoping, +5 room-code allocator.
  Zero tests were deleted or weakened.

**What the suite does not cover:** any client code. It has never been run, in a browser or
otherwise. Every assertion is against the socket contract. That is what `MANUAL_TEST.md`
is for, and **you should run it before you push, not after.**

---

## What is currently blocking a push

Two separate mechanisms. Both are deliberate.

### 1. `.git/hooks/pre-push` — git itself refuses

```sh
#!/bin/sh
exit 1
```

Still in place, still executable — verified this session (running it directly exits `1`,
which is what makes git abort). **This blocks every push, from any tool, including you.**
You must delete it before you can push anything:

```bash
rm .git/hooks/pre-push
```

### 2. `.claude/settings.local.json` deny rules — these stop *me*, not you

```json
"deny": [
  "Bash(git push:*)",
  "Bash(git checkout main:*)",
  "Bash(git switch main:*)",
  "Bash(npm audit fix:*)",
  "Bash(rm -rf:*)"
]
```

**Leave all five in place.** They constrain what an assistant can run in this repo and have
no effect on you typing commands in your own terminal. Removing them buys you nothing and
removes a guardrail — in particular `npm audit fix`, which breaks `react-scripts`.

So, when you are ready to ship: **delete the hook, leave the settings alone.** The hook is
the only thing you need to remove; the deny rules never touch your own terminal.

---

## The exact commands to merge and push

Run from the repo root, in order. Read the diff step; do not skip it.

```bash
# 0. Confirm you are where you think you are, and that nothing is uncommitted
git status
git branch --show-current        # expect: overnight-rebuild
git log --oneline -1             # expect: d8320f2 (or later)

# 1. Look at what you are about to ship (server.js is the only production file)
git diff main HEAD -- server.js

# 2. Remove the push block
rm .git/hooks/pre-push

# 3. Merge. --no-ff keeps the branch's shape in history, which matters
#    because the rollback plan below refers to these commits.
git checkout main
git merge --no-ff overnight-rebuild

# 4. Push. Render deploys from main automatically.
git push origin main
```

**Before step 4, have `MANUAL_TEST.md` done.** Once you push, Render rebuilds and the live
game changes under whoever is playing.

If you would rather have a review surface first, replace steps 3–4 with:

```bash
rm .git/hooks/pre-push
git push -u origin overnight-rebuild
gh pr create --base main --head overnight-rebuild \
  --title "Server concurrency, mid-round reconnect, and cross-room stats fixes" \
  --body-file SESSION_4_REPORT.md
```

---

## Rollback

Production goes back to `e994b5f`, which is both the current `main` tip and the tag
`pre-ui-rebuild`. Verified: `git rev-parse pre-ui-rebuild` → `e994b5f…`.

### Fastest — no git at all (seconds)

Render dashboard → your service → **Deploys** → find the deploy built from `e994b5f` →
**Redeploy**. This is the one to reach for mid-party: it does not touch the repo, so you
can take your time fixing the branch afterwards. Render rebuilds and restarts; expect a
minute or two of downtime while the service swaps over.

### If you need git back at `e994b5f` too

```bash
# Undo the merge commit, keeping history honest. Safe on a pushed branch.
git checkout main
git revert -m 1 <merge-commit-sha>
git push origin main
```

Use `git revert`, **not** `git reset --hard` + force push. The deny list blocks force
pushes for a reason and a rewritten `main` is a worse problem than the one you are solving.

### If you must hard-reset anyway

```bash
git checkout main
git reset --hard pre-ui-rebuild
git push --force-with-lease origin main
```

`--force-with-lease`, never bare `--force`. Only do this if nobody else has pulled.

**Rollback caveat:** rolling back restores the `main` tree, which still contains the
committed `node_modules`. That is fine — it is how production runs today — but it means a
successful rollback tells you nothing about whether the dependency chain works. That
question is settled separately, by the clean-checkout rehearsal at the top of this document.

### How fast

| Route | Time to live |
|---|---|
| Render "Redeploy" of the old build | ~1–3 min, no repo changes |
| `git revert` + push | ~1 min of typing + a full Render build (~3–5 min) |

---

## One thing I still could not verify

**The room-code *collision* still cannot be provoked through a socket.** Forcing a real one
needs on the order of 1,200 simultaneously-open rooms to be reliably reproducible; anything
smaller is a coin flip that would fail randomly in CI. `Math.random` has no seam the harness
can control. So the collision bug itself remains read from the code: `createRoom` did
`rooms[roomCode] = {...}` with no existence check.

**What changed in Session 4 is that the retry loop is now genuinely tested.**
`tests/room-code.test.js` lifts the allocator straight out of `server.js` source and drives
it with all 90,000 codes taken, which reaches the exhaustion branch honestly. Before the cap
that branch did not exist: measured standalone, the old `while` loop spun 45,592,070 times
in 3 seconds and never returned — on a single-threaded server that pins the event loop and
stops every game on the box.

The original three-line retry is still worth reading yourself, and the suite confirms it does
not break room creation (13/13 across
`edge-cases` and `concurrency`).

**Every change in this deploy now has a test behind it.** The residual gap is narrower than
Session 3's: not "the fix is unverified", but "the specific event that triggers the fix has
never been observed in the wild". That is an acceptable place to be for a branch this size.
