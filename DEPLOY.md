# Deploy — Session 3

> **Prepared, not executed.** Nothing here has been run. Nothing is pushed, `main` was
> never checked out. Branch `overnight-rebuild` at `cde95c3`, working tree clean.

---

## ⚠️ READ THIS BEFORE YOU MERGE

**Commit `aac133a` removed `node_modules/` from git — 857 tracked files that exist on
`main` today and will not exist after you merge.** That commit is from the overnight
session, not this one, but it ships when you push.

**If Render's Build Command does not run `npm install` at the repo root, the server will
not start after this deploy.** It will crash on `require('express')`. The root
`node_modules` currently in `main` is what `node server.js` loads from, and after the merge
git will no longer provide it.

This is not a hypothetical: committing `node_modules` is usually what people do *because*
their host isn't installing dependencies. I cannot see your Render dashboard, so I cannot
close this out for you.

**Check this first — Render → your service → Settings → Build Command:**

| What it says | Verdict |
|---|---|
| `npm install && npm run build` | ✅ Safe. Root deps get installed. Deploy. |
| `npm ci && npm run build` | ✅ Safe. `package-lock.json` is in sync with `package.json`. |
| `npm run build` | ❌ **Will break.** Change it to `npm install && npm run build`. |
| `yarn && npm run build` | ⚠️ Probably fine, but there is no `yarn.lock`. Prefer npm. |

Root `npm run build` is `cd client && npm install && npm run build` — it installs the
**client's** dependencies and nothing else. It never installs `express`, `cors` or
`socket.io` for the server.

**The `devDependencies` half of the question is fine.** `vitest` and `socket.io-client`
were added to the root `devDependencies` only. Render sets `NODE_ENV=production`, so
`npm install` skips them. Even if they were installed they are never loaded: `npm start`
is `node server.js`, which imports neither. `dependencies`, `start` and `build` are
byte-identical to `main`:

```diff
   "scripts": {
-    "test": "echo \"Error: no test specified\" && exit 1",
+    "test": "vitest run",
+    "test:watch": "vitest",
     "start": "node server.js",            <- unchanged
     "build": "cd client && npm install && npm run build"   <- unchanged
   },
   "dependencies": {                        <- unchanged, same versions
     "cors": "^2.8.5", "express": "^4.21.1", "socket.io": "^4.8.1"
+  },
+  "devDependencies": {
+    "socket.io-client": "^4.8.3", "vitest": "^2.1.9"
   }
```

Render never runs `npm test`, so pointing it at `vitest` changes nothing in production.

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

### The five behavioural deltas, and nothing else

Audited line by line with `git diff main HEAD -- server.js`. Every changed line maps to one
of these; there is nothing unaccounted for.

| # | Change | Where |
|---|---|---|
| 1 | Phase 1 concurrency fixes: room-scoped `playerStats` reset, `room.isActionInProgress` instead of `rooms.isActionInProgress`, `activeRounds` set only once a round really starts, one `ROUND_DURATIONS` constant | `5d0a8ef` |
| 2 | Mid-round merge reorder — a reconnecting player keeps that round's drinks | `b71899a` |
| 3 | Room code collision retry | `b71899a` |
| 4 | One wild-card swap per player per quarter | `a5889ce` |
| 5 | Every `playerStats` name lookup scoped to the room that owns it | `cde95c3` |

Two new files exist under `client/src` — `data/cards.js` and `components/CardIcon.jsx`,
both from `aac133a`, both from your own earlier work. **Neither is imported by anything.**
They ship as dead code and do not enter the bundle; the build output is byte-for-byte the
size it was before they existed.

---

## Verification behind this

- `npm test` → **89 passed (89), 9 files**. Run twice back to back, clean both times
  (137s, 159s). No flakes across the two runs.
- `cd client && npx react-scripts build` → **exit 0**, "build folder is ready to be
  deployed". All ESLint warnings pre-existing; **no new warnings**, as expected since
  nothing in `client/src` changed.
- Test count went 83 → 89: +4 for the swap guard, +2 for the stats scoping. Zero tests
  were deleted or weakened.

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

Executable, created this session at your request. **This blocks every push, from any tool,
including you.** Remove it when you are ready:

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

So: **delete the hook, leave the settings alone.**

---

## The exact commands to merge and push

Run from the repo root, in order. Read the diff step; do not skip it.

```bash
# 0. Confirm you are where you think you are, and that nothing is uncommitted
git status
git branch --show-current        # expect: overnight-rebuild
git log --oneline -1             # expect: cde95c3

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
  --body-file SESSION_3_REPORT.md
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

**Rollback caveat:** rolling back restores the `main` tree, which includes the committed
`node_modules`. So a rollback is self-healing with respect to the dependency risk at the
top of this document — which also means a successful rollback does **not** prove the
dependency problem is gone. Fix the Build Command before trying again.

### How fast

| Route | Time to live |
|---|---|
| Render "Redeploy" of the old build | ~1–3 min, no repo changes |
| `git revert` + push | ~1 min of typing + a full Render build (~3–5 min) |

---

## One thing I could not verify

**The room-code collision fix is not test-verified.** Forcing a real collision needs on the
order of 1,200 simultaneously-open rooms to be reliably reproducible; anything smaller is a
coin flip that would fail randomly. The bug and the fix are both read from the code:
`createRoom` did `rooms[roomCode] = {...}` with no existence check. The patch retries until
the code is free, and the suite confirms it does not break room creation (13/13 across
`edge-cases` and `concurrency`).

**Read the retry loop yourself before you ship it** — it is three lines, and it is the only
change in this deploy with no test standing behind it.
