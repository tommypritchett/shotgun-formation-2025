# Session 15 — the live game feed and the detector, both testable without a live game

Phases 1 and 2 of `docs/LIVE_GAME_PLAN.md`, built together. Read that document first — it has the
research, the card tiering, the broadcast-delay problem and the decisions. This is the build.

**A new branch off `main`.** `overnight-rebuild` is merged and behind; do not continue on it.

Rules unchanged: **no push, no merge.** All 310 tests stay green. Commit and tag per item.

---

## The requirement that shapes everything

**The whole feature must be runnable and testable on a Tuesday, with no live game.**

That is not a testing convenience — it is the architecture. Football happens two days a week, and a
feature you can only exercise on a Sunday gets debugged in front of ten people who are drinking.

So the feed is an **interface with two implementations from the first commit**:

| Source | What it does |
|---|---|
| **`LiveFeed`** | polls ESPN for a real in-progress game |
| **`ReplayFeed`** | reads a recorded game from a fixture file and emits its plays on a timer, as though they were happening now |

Everything above the interface — detection, queueing, the delay offset, the socket events, the UI —
cannot tell the difference. A recorded game replayed at 20× is a complete end-to-end test of the
whole feature, on any day, in about ten minutes.

Build `ReplayFeed` **first**, before the live poller. If it comes second it will end up subtly
different and useless.

---

## The other requirement: the existing game must not change

**This is additive.** A room that never attaches a game must play exactly as it does today.

- An auto-call goes through **the same declaration path a Ref uses** — same `isActionInProgress`
  guard, same round lifecycle, same `finalizeRound`. Do not fork the game loop. This codebase has
  been bitten repeatedly by two paths that were meant to do the same thing.
- The Ref can declare manually at any moment, including while a detection is queued. A manual
  declaration wins and clears the queued one.
- Detaching the game, or the feed dying, leaves a perfectly normal game of Shotgun Formation.
- **No existing test may need changing.** If one does, you have altered behaviour — stop and say so.

---

## 1. The feed layer

`server/feed/` — a new directory. Server-side only; the client never talks to ESPN.

**The interface.** Something close to: `start()`, `stop()`, and an event per new play carrying a
normalised play object. Normalise at this boundary so nothing downstream ever sees ESPN's shapes.

**`ReplayFeed`** reads a fixture and emits plays on a timer, honouring the real gaps between plays,
with a speed multiplier. Must support jumping to a point in the game so a test can start at a
two-minute drill rather than the opening kickoff.

**`LiveFeed`** polls ESPN. `{league}` is `nfl` or `college-football` — one code path, league is a
parameter:

- `site.api.espn.com/apis/site/v2/sports/football/{league}/scoreboard` — the game list
- `sports.core.api.espn.com/v2/sports/football/leagues/{league}/events/{id}/competitions/{id}/plays?limit=300`
- `.../competitions/{id}/drives` — needed for 3-and-out

Rules:
- **One poller per GAME, not per room.** Eight rooms watching the same game share one subscription,
  refcounted. When the last room detaches, the poller stops.
- ~5s interval while live. Exponential backoff on error. Stop on game final.
- **Dedupe on ESPN's play id.** A play fires once, ever.
- **Treat every field as optional.** These endpoints are undocumented and unversioned; a shape change
  must degrade to "no detections" with a loud log line, never a crash and never a wrong call.
- Register the poller's state with the Session 14 teardown so a reaped room cannot leave one running.

**Fixtures.** A script that pulls a completed game's plays and drives to `fixtures/{league}/{id}.json`.
Capture at least: two NFL games (one high-scoring, one 13–10 slog), two college games (one Power
conference, one Group of Five with thin data), and one game with overtime.

Tag `phase-15-feed`.

---

## 2. The detector — a pure function

`server/feed/detect.js`. **Plays in, cards out. No sockets, no timers, no server state.** This is the
piece that decides whether the feature works, and purity is what makes it testable.

Signature roughly: given the new play, plus enough prior context (the current drive, the previous
play), return zero or more `{ cardId, confidence, playId, reason }`.

`cardId` **must match `client/src/data/cards.js` exactly** — `Sacks` plural, `Blocked Kicks` plural,
`Fake Punt/FG` no spaces. Those ids are the wire values and mismatches fail silently.

### Auto-call — Tier A

Touchdown · Field Goal · Sacks · Turnover · Safety · 2 PT Conversion · Missed FG · Missed PAT ·
Turnover on Downs · Defensive TD · Special Teams TD · Big Play 20+ · Big Play 50+ ·
**First Down** · **Penalty**

**First Down and Penalty are auto-called by owner decision.** They are the volume that keeps a dull
game alive. See the plan's pacing section for what that costs.

### Suggest to the Ref — Tier B

3 n Out (drive-level: three plays, no first down, ends in a punt) · Blocked Kicks · Onside Attempt ·
Onside Recovered · Fake Punt/FG · Penalty Calls TD Back · **Disqualified, college only** (targeting
is a formal reviewed foul that lands in the play text).

### Never — Tier C

Doink · Record Broken · Disqualified in the NFL. Say so in the UI rather than leaving people
wondering.

### Tests

This is where the session's real effort goes.

- **Unit tests per card**, driven by hand-built play objects. Both directions: it fires when it
  should, and it does not fire on the near-miss (a 19-yard gain is not Big Play 20+; a touchdown
  called back is not a Touchdown).
- **Whole-game replays** over the fixtures, asserting the full list of cards a real game produces.
- **A frequency report** — run every fixture, print per-card counts per game. **This is a deliverable,
  not a debug aid.** It is how the owner sets the dials with real numbers instead of estimates, and
  it is the answer to "what does 40 first downs actually feel like." Put it in the report.
- **The thin-data fixture must produce silence, not garbage.**

Tag `phase-15-detector`.

---

## 3. Attaching a game, and picking one

### The picker

Two leagues, and they are not the same problem.

- **NFL:** a flat list of the day's games is enough — 13 or so.
- **College:** 50 to 100+ on a Saturday, and **the scoreboard endpoint truncates by default** — you
  need `groups=50&limit=500` for the full Division I slate. So: filter by conference (`groups` takes
  a conference id), ranked games first, and search by team name. Default view: in-progress and ranked.

Show enough to pick confidently — teams, score, quarter, clock, and whether it has started.

### Attaching

Ref-only. `attachGame({ league, gameId })` / `detachGame`. The room's header shows score, period and
clock. **In this session, attaching does not call anything** — see the sequencing note below.

Room state to carry: league, game id, and the per-card auto/suggest/off settings. **No delay setting**
— see item 4.

Attaching should be two taps: pick the game, done. Anything that turns this into a setup form is
working against the point of the feature.

Tag `phase-15-attach`.

---

## 4. The broadcast delay — one constant, no settings

The feed runs **20–55 seconds ahead of television** (antenna ~19s, cable ~38s, YouTube TV and Hulu
~53s). Firing on detection would announce the touchdown before anyone in the room sees it.

**`BROADCAST_DELAY_MS = 45_000`. A single named server-side constant. No Ref setting, no provider
picker, no calibration UI, no per-room override.**

This is deliberate and it is the owner's call: the point of the whole feature is to take work off the
Ref, and a delay they have to configure before kickoff hands it straight back. **Do not build a
settings screen for this, and do not add one "just in case."**

If it needs tuning later it is a one-line change to the constant. Note in a comment that the failure
modes are asymmetric — firing late is barely noticeable, firing early spoils the play — so the
direction to move it is **up**.

Build the queue, since the detector needs somewhere to put things:

- Detections are queued and released 45s after detection.
- **Stale drop:** anything older than ~90s at release time is discarded, not fired late.
- **Depth limit**, and count both drops. Surface those counts to the Ref — a room constantly backed
  up should be visible, not silently losing calls.

Tag `phase-15-delay-queue`.

---

## ⚠️ Sequencing — what this session must NOT do

**Nothing detected may declare a card this session.** The detector runs, the queue fills, everything
is logged and visible — and the release step calls nothing. That is Phase 3.

The reason: the whole value of Phases 1 and 2 is being able to run this against real recorded games,
repeatedly, and read what it *would* have done, before it can affect anyone's night. Wiring the
declaration in at the same time destroys that. It is one line to connect later.

What ships: a room can watch a real game, the header is live, and the Ref sees a running feed of what
the system detected and would have called — with the delay applied.

---

## Then

Report: the fixtures captured, the per-card frequency table across all of them (NFL and college
separately), anything in Tier A that turned out not to be reliably detectable, anything in Tier B that
turned out to be better than expected, and how the thin-data college fixture behaved.

The frequency table is the thing the owner is waiting on. Lead with it.
