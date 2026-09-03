# Manual test — the feed calling

**Run this against a replay, not a live game.** Football happens twice a week and
this is the first time the feature touches real play; the point is to find the
problems on a Tuesday rather than in front of ten people on a Sunday.

Everything below uses recorded 2025 games, so it can be run any day, repeatedly,
and it will behave identically each time.

---

## Setup

```bash
# 1. Server, with the replay seam on
ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js

# 2. Three browser windows, a real room, a real replay
node scripts/watch-replay.mjs fixtures/nfl/401772877.json --speed 20
```

`401772877` is CAR 7 – NO 17, the 24-point slog — the game that most needs the
feed to carry it, and therefore the one worth watching. `--speed 20` runs it in
about ten minutes. Drop `--speed` for real time.

The harness prints a transcript path at the end. **Read it** — it is one line per
play, and the blank lines are where a missed call would show.

> If the room never appears, the built bundle is pointing at a different server
> than the one you started. `cat client/.env.local`, then
> `cd client && npx react-scripts build`.

---

## 1. A round starts on its own

- [ ] Attach the game. **Every window** shows the score strip under the header.
- [ ] **Every window** shows a one-off line: *"The feed is calling this game…"*.
- [ ] Within a minute a round starts **with nobody touching anything** — the card
      appears, the countdown runs, the drink assigner opens for holders.
- [ ] It looks exactly like a round the Ref declared. No extra banner, no
      different styling, no "auto" label on the round itself.
- [ ] Open **Would have called**. The entry is there with a time and a reason.

**What would be wrong:** a round that starts but never finalizes; a card nobody
holds; a round that looks visibly different from a Ref's.

## 2. The Ref overrides mid-flight

- [ ] While the game is running, the Ref taps **Declare Action** and calls
      something by hand.
- [ ] It declares immediately (or says an action is in progress, if a round is
      genuinely live — that is correct).
- [ ] Anything the feed had queued for that moment is dropped, not stacked
      behind it. You should **not** see a second round fire the instant the
      Ref's round ends.

**Why it matters:** by the time the Ref's round finishes, the queued play is old
news. Firing it late is worse than losing it.

## 3. A suggestion accepted

- [ ] Wait for a green **"Call it?"** prompt (3 n Out is the common one — about
      three a game).
- [ ] Only the **Ref's** window shows it. The other two show nothing.
- [ ] The countdown ticks down.
- [ ] Tap **Call it**. A normal round starts, in every window.

## 4. A suggestion ignored

- [ ] Wait for another prompt and **do nothing**.
- [ ] It disappears on its own when the countdown reaches zero.
- [ ] No round starts.
- [ ] It does **not** linger on screen looking live.

## 5. The pause control

- [ ] Ref opens **What the feed calls**.
- [ ] Tap **Pause auto-calling**.
- [ ] The score strip **stays** and keeps updating. The game is not detached.
- [ ] Every window shows *"Auto-calling is paused."*
- [ ] Wait two minutes: **no rounds start**.
- [ ] The Ref can still declare by hand, and it works.
- [ ] Tap **resume**. Calling starts again, and it does **not** fire a burst of
      everything that happened while paused.

**This is the escape hatch.** If it does not work instantly, nothing else in this
list matters.

## 6. Turning a card down

- [ ] In the dial, set **First Down** to `off`.
- [ ] Watch for two minutes: no First Down rounds, but others still fire.
- [ ] Set it to `suggest`. Now it asks instead of calling.
- [ ] Confirm **Fake Punt/FG** cannot be switched on at all, and that the sheet
      names Doink, Record Broken and Fake Punt/FG as Ref-only.

## 7. The feed dying

- [ ] With the replay running, **stop the script** (Ctrl-C in the harness
      terminal, or let the fixture run out).
- [ ] Every window is told the feed ended — it does **not** just go quiet.
- [ ] If a round was live, it **finishes** before the game detaches.
- [ ] After it detaches, the room is an ordinary game of Shotgun Formation: the
      Ref can declare, rounds run, scores update.

**Why it matters:** silence is indistinguishable from a dull patch of football.
The room has to be told.

## 8. A full game, end to end

- [ ] `node scripts/watch-replay.mjs fixtures/nfl/401772879.json --speed 20`
      (SF 26 – LAR 42, a shootout — the opposite of the slog).
- [ ] Let it run to the end without intervening.
- [ ] The game reaches the final whistle and detaches cleanly.
- [ ] Read the transcript. Scan the **blank** lines: does anything obviously
      eventful have nothing beside it?
- [ ] Check the queue counters in the log: `stale` and `full` drops should both
      be **0** at 20×. If they are not, the room was backed up.

---

## The one to watch at 1×

```bash
node scripts/watch-replay.mjs fixtures/nfl/401772636.json --from 12
```

IND 31 – ATL 25 from Q1 10:15, at real speed. This contains the busiest stretch
in any of the ten fixtures — **14 calls in five minutes**, a round roughly every
21 seconds against a 21-second round length. Every one of those calls is
legitimate; it was genuinely a wild five minutes of football.

**This is the judgement call nothing else can answer:** does that read as alive,
or as relentless? If it is too much, the dial is the answer and the first thing
to turn down is Big Play 20+ — about 11 a game, and it clusters exactly where
the game is already busy.

---

## What is not covered here

- **A real live game.** Everything above is a recording. The live poller shares
  the same code path, but it has never been pointed at a game in progress.
- **The paid Render instance.** Polling keeps the service awake, which is what
  suspended the free tier twice. This must not go to production without it.
- **Two rooms watching the same game.** The poller is shared and refcounted and
  is unit-tested, but it has not been watched with two real rooms.
