# Session 5 — Set up the test environment, then get out of the way

Small session. I'm about to run `MANUAL_TEST.md` on two phones and a laptop. Get the
environment right and fix a flaw in the checklist first.

My laptop's LAN address is **`10.0.0.42`**.

**Do not push. Do not merge. Do not touch `main`.** Same rules as every prior session.

---

## Phase 1 — The env file that doesn't exist

`client/.env.local` is missing. Without it, `App.js:71` falls back to
`https://shotgunformation.onrender.com` — my **live production server**. I would run the
entire checklist against the old code, every test would fail confusingly, and **test 3 would
crash production**, since that test exists specifically to reproduce the outage bug.

Create it:

```
REACT_APP_API_URL=http://10.0.0.42:3001
```

**Not `localhost`.** The checklist currently says `localhost:3001` and that's wrong for this
setup — a phone's `localhost` is the phone. The bundle is built once and served to every
device, so the URL baked into it has to be reachable from all of them.

Confirm `client/.gitignore` already ignores `.env.local` so this never gets committed.

## Phase 2 — Prove the env var actually took

Do not assume it worked. Create React App only reads env files at boot, and I may have had
the dev server running already.

Start both servers (backgrounded, with logs I can read afterwards):

- server: `npm start` from the repo root, port 3001
- client: `cd client && npm start`, port 3000

Then verify, and show me the actual output of each:

1. `curl -s -o /dev/null -w "%{http_code}" http://10.0.0.42:3001/` → expect 200
2. `curl -s http://10.0.0.42:3000/` → expect the React shell, 200
3. **The one that matters:** fetch the dev bundle from `http://10.0.0.42:3000` and confirm
   `10.0.0.42:3001` appears in it. If the bundle only contains the `onrender.com` fallback,
   the env var did not take and everything downstream is worthless. Say so loudly and stop.
4. Confirm the server is bound to all interfaces, not just loopback — the phones need to
   reach it from off-box.

Report the PIDs and the exact commands to stop both when I'm done.

If macOS firewall blocks the ports, tell me what dialog to expect and what to click.

## Phase 3 — Fix `MANUAL_TEST.md`

The checklist is good; its setup section is wrong. Rewrite the "Before you start" block:

- Real address `10.0.0.42` throughout, not `localhost`, for both laptop and phones.
- Laptop windows go to `http://10.0.0.42:3000`. Phones go to the same URL. Everything uses
  one address — that removes a whole class of confusion.
- Add a **pre-flight check** I can do in 30 seconds before wasting an evening: open the app,
  confirm in devtools/console that the socket connected to `10.0.0.42:3001` and not
  `onrender.com`. Give me the exact thing to look for.
- Add the step I keep almost forgetting: if the client dev server was already running,
  **restart it**, or the env var is not in the bundle.
- Note that both phones and the laptop must be on the same Wi-Fi, and that a VPN on any
  device will break it.

Keep every numbered test step exactly as it is. Only the setup section changes.

## Phase 4 — Log the post-deploy task

You found that `gameStarted` emits the module-global `playerStats` — every room on the
server — straight into client state at `App.js:1573`. Same leak class we fixed in
`finalizeRound`, at a site we both walked past. It is live on `main` today so it is not a
regression, and not touching it hours before a push was correct.

Record it as **the first task after the deploy lands**, in whatever file you're using for
follow-ups. Include the point you made: pointing `gameStarted` at `buildRoomStats` closes the
leak *and* makes the `App.js:2051`/`:2156` elimination fallback genuinely unreachable — so it
becomes deletable with proof rather than on somebody's say-so.

And note for the record that my "that fallback is dead code" claim was wrong, with your
reasoning, so a future session doesn't rediscover it the hard way.

## Phase 5 — Tell me I'm ready

Short. Confirm:

- env file created and verified in the bundle
- both servers up, reachable on `10.0.0.42`, PIDs and stop commands
- `MANUAL_TEST.md` setup section corrected
- anything you expect to go wrong on real phones that I should not mistake for a bug

Then stop. Commit the `MANUAL_TEST.md` change and the follow-up note. Nothing pushed.
