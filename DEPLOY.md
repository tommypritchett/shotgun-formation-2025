# Deploy

> **Verified ready 2026-08-27 at `c5b9fbf`.** Branch `overnight-rebuild`, **68 commits ahead
> of `main`**. **305 tests green**, 37 files. Clean-checkout build rehearsed end to end under
> `NODE_ENV=production` (below).
>
> This supersedes the Session 8 version of this document, which was written when this branch
> touched `server.js` only. **That is no longer true** — the whole visual rebuild has landed
> since. Read the "What actually changes" section rather than remembering the old one.

---

## Pre-flight, all verified at `c5b9fbf`

| Check | Result |
|---|---|
| `npm test` | **305 passed (305)**, 37 files |
| `npm run build` from a genuinely clean `git clone`, **with `NODE_ENV=production`** | ✅ both dependency trees installed, `client/build` produced |
| `node server.js` on that clean build | ✅ `GET /` → 200 and serves `<title>Shotgun Formation</title>`; `GET /socket.io/?EIO=4&transport=polling` → 200 |
| Bundle points at **production**, not a LAN address | ✅ the clean build contains `https://shotgunformation.onrender.com` and **no** `10.0.0.*` / `192.168.*` |
| `client/.env.local` reaches Render? | ❌ **No** — gitignored (`client/.gitignore:16`) and untracked. Verified again this session. |
| `client/build` reaches Render? | ❌ **No** — gitignored (`client/.gitignore:12`), 0 files tracked. Render builds from source. |
| LAN address anywhere in a tracked file? | ❌ **No.** `git grep` for `10.0.0.*`, `192.168.*` finds nothing outside tests and docs. |
| `react-scripts` survives `NODE_ENV=production` | ✅ it is in `client/package.json` **dependencies**, not devDependencies — confirmed, not assumed |

> **Note on your local tree.** `client/.env.local` exists on your machine and points at
> `http://10.0.0.42:3002`, so your **local** `client/build` currently has the LAN address
> baked into it. That is correct for testing on the couch and it can never reach production,
> because neither the env file nor the build directory is tracked. The rehearsal above was
> run from a clean clone precisely to prove that.

---

## What actually changes in production

Both files. `server.js` and the entire client.

```
33 files changed, 4566 insertions(+), 1044 deletions(-)
server.js                 | 1334 +++++++++++--------
client/src/App.js         | 1441 +++++++++++----------
+ 24 new files under client/src (components/, lib/, screens/, data/)
```

### The player-visible list

**The game looks completely different.** "Playbook Chalk": chalkboard base, stadium amber for
the Standard deck, neon green for Wild, red reserved for the four 40-drink shotgun cards. The
app cards now render like the printed cards. Everything below is on top of that.

1. **Two groups can play at the same time without killing the server.** The original reason
   this branch exists. On `main`, the moment a second group starts a game the server deletes
   the first group's players from its stats map, the next round to finish throws inside a
   `setInterval`, and the whole Node process dies — ending every game on the box. Two Sunday
   parties was enough.
2. **Your drinks survive your phone dropping.** On `main` they are silently deleted.
3. **The host leaving no longer ends the game.** The whistle moves to somebody who is
   actually there, in the lobby and mid-game. A room now closes only when nobody has been
   active in it for 30 minutes.
4. **Everyone can see who the Ref is.** The REF badge lands on whoever holds it, not only on
   your own row. It was structurally impossible to see before.
5. **A round waits for Lock In.** Pouring everything you owe is not the same as being done;
   rounds no longer end out from under somebody mid-decision.
6. **"Rejoining your game…" is no longer a dead end.** It has a Back to start button, a
   working ten-second timeout, and it forgets the saved game so the next load is not stuck
   too.
7. **Two people called Mike in two different games cannot corrupt each other** — the last
   member of that family, `formerPlayers`, is now scoped per room.
8. **A phone on a network that blocks WebSocket can now connect at all.** It used to fail
   outright instead of falling back to polling.
9. Correct round timer on reconnect, one wild-card swap per quarter, undo a pour, the 10→1
   shotgun fold applied once server-side, and a 10-player cap matching the printed box.

### What has NOT changed

- No socket event renamed, added or removed. **One additive field**: `gameStarted` now
  carries `hostId`. No payload shape changed.
- No change to round lengths (21 / 11 / 6), card values, deck sizes, or the drink maths.
- `hostLeft` is no longer emitted — it existed only to announce the room closing, which no
  longer happens. Nothing on the client listens for it either.

### One thing worth knowing before you push

**The bundle is much bigger than it was.** `main` shipped ~72 kB gzipped of JavaScript; this
ships **416 kB gzipped** (707 kB raw). The avatars and card art are inlined as base64 data
URIs in `components/Avatars.js`. That is a one-time cost on first load, cached afterwards,
and it is not a bug — but it is the number most likely to be felt on a bad cellular
connection, which is exactly the condition in your post-deploy check below. If the first load
feels slow on cellular, this is why, and moving that art to real image files is the fix.

---

## What blocks a push

**`.git/hooks/pre-push` no longer exists.** It was deleted during the Session 8 deploy
attempt and was never restored. Nothing in git is stopping you.

The `.claude/settings.local.json` deny rules are still in place and still constrain **me**,
not you:

```json
"deny": [
  "Bash(git push:*)",
  "Bash(git checkout main:*)",
  "Bash(git switch main:*)",
  "Bash(npm audit fix:*)",
  "Bash(rm -rf:*)"
]
```

**Leave all five.** They have no effect on your own terminal, and `npm audit fix` in
particular breaks `react-scripts`.

---

## The exact commands

Run from the repo root, in order.

```bash
# 0. Confirm where you are and that nothing is uncommitted
git status
git branch --show-current        # expect: overnight-rebuild
git log --oneline -1             # expect: c5b9fbf (or later)

# 1. Look at what you are shipping
git diff main HEAD --stat
git diff main HEAD -- server.js

# 2. Run the suite one more time on the machine you are pushing from
npm test                         # expect: 305 passed (305)

# 3. Merge. --no-ff keeps the branch's shape, which the rollback plan relies on.
git checkout main
git merge --no-ff overnight-rebuild

# 4. Push. Render deploys from main automatically.
git push origin main
```

**Before step 4, have `MANUAL_TEST.md` done.** Once you push, Render rebuilds and the live
game changes under whoever is playing.

If you would rather have a review surface first:

```bash
git push -u origin overnight-rebuild
gh pr create --base main --head overnight-rebuild \
  --title "Visual rebuild, room lifecycle, and the cross-room name-collision fixes" \
  --body-file docs/SESSION_14_REPORT.md
```

---

## After the deploy — check these, in this order

**1. The socket is talking to production, not to your house.**

Open https://shotgunformation.onrender.com → DevTools → **Network** → filter **WS** → reload.
The socket URL must be

```
wss://shotgunformation.onrender.com/socket.io/...
```

It must **not** contain `10.0.0.42`. If it does, a contaminated local build got pushed —
roll back, and check that `client/build` and `client/.env.local` are still untracked.

> Because the client now asks for **polling first** and upgrades, you will see the polling
> request before the WS one. That is correct and is the fix from this session. What matters
> is that the WS entry appears and its host is `shotgunformation.onrender.com`.

**2. Join once from a phone on cellular, off the home wifi.** Not wifi. This is the path that
was broken — WebSocket-first with no fallback — and the only way to know it is fixed is a
network you do not control.

**3. Two rooms, both with a game started, and the server stays up.** Two phones or two
browsers, two separate room codes, both press Start. This is the crash that has been live
since Session 3. Watch the Render log; the process must not restart.

**4. Read the first line of the Render log.** It prints the commit it is running:

```
Running code: <sha> (<branch>)  |  node <version>  |  started <timestamp>
```

If that sha is not what you just pushed, you are looking at a stale server. This line has
already caught exactly that once.

---

## Rollback

Production goes back to `e994b5f`, the current `main` tip and the tag `pre-ui-rebuild`.

### Fastest — no git at all

Render dashboard → your service → **Deploys** → find the deploy built from `e994b5f` →
**Redeploy**. Reach for this mid-party: it does not touch the repo, so you can fix the branch
afterwards at your own pace. Expect a minute or two of downtime while the service swaps.

### If you need git back too

```bash
git checkout main
git revert -m 1 <merge-commit-sha>
git push origin main
```

Use `git revert`, **not** `git reset --hard` + force push. A rewritten `main` is a worse
problem than the one you are solving.

| Route | Time to live |
|---|---|
| Render "Redeploy" of the old build | ~1–3 min, no repo changes |
| `git revert` + push | ~1 min of typing + a full Render build (~3–5 min) |

---

## What the suite still does not cover

The 305 tests are the socket contract, the client's pure logic modules, and rendered
components in jsdom. **There is still no end-to-end browser test of a real game.** Every
claim about what a real phone shows during a real round is read from source or checked by
hand. `MANUAL_TEST.md` is what stands between that gap and your players — run it before you
push, not after.
