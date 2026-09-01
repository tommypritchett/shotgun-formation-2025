# Live game tracking — implementation plan

Attach a room to a real NFL **or college** game, detect plays from a live feed, and let the app call
cards the Ref would otherwise have to catch. The Ref stays in charge.

Written against the shipped app at `850fb81`. Nothing here is built.

---

## The two things that decide whether this is fun

Everything else is engineering. These two are the design.

### 1. The feed is ~20–55 seconds AHEAD of the television

This is the whole problem. Measured at the 2026 Super Bowl:

| How people watch | Behind the live feed |
|---|---|
| Antenna (over the air) | ~19s |
| Cable / satellite | ~38s |
| YouTube TV | ~53s |
| Hulu + Live TV | ~53s |

A data feed is near-real-time. So a naive implementation **announces the touchdown before anybody
in the room sees it.** That does not just spoil the play — it inverts the game. The drink is
supposed to be a reaction to what you all just watched.

**The fix: a fixed 45-second delay. One constant, no setting, no UI.**

**OWNER'S DECISION, 2026-08-28**, and it is the right one: the entire point of this feature is to take
work off the Ref. Making them configure a delay before the game starts hands the work straight back.
Ship a number that is good enough for everyone and tune it centrally if it turns out wrong.

45s sits sensibly in the range — 7s of slack past cable, a little early for YouTube TV, generous for
an antenna.

**One thing to know when tuning it later: the failure modes are not symmetric.** Firing *late* means
you drink a few seconds after you saw the play, which nobody minds. Firing *early* spoils the play,
which is the thing that ruins the feature. So if it ever needs moving, move it **up**. Keep it as a
single named constant so that is a one-line change rather than a redesign.

**The split room stays a known limitation.** People play this from different houses on different
providers, and one number cannot be right for all of them. Not worth solving; worth writing down.

### 2. Auto-calling changes the pacing of the game completely

An NFL game has roughly 150 plays. **First Down fires about 40 times.** Today the Ref calls maybe a
dozen actions in a quarter, because a human only catches what they notice and only bothers when the
table is ready.

Wire every detectable event to a round and the game becomes unplayable — constant rounds, no gaps,
the deck churning, and everyone drinking far more than the game was designed around.

**OWNER'S DECISION, 2026-08-28: auto-call everything detectable, First Down and Penalty included.**
The reasoning is sound and overrides my recommendation: a lot of games are dull, and a deck that only
fires on touchdowns and turnovers leaves a 10–3 slog with nothing happening for an hour. Volume is
the point.

The real 2025 numbers, so nobody is surprised:

| Event | Per game (both teams) | Source |
|---|---|---|
| First downs | **~40–42** | 20–21 per team |
| Accepted penalties | **~12–13** | 6.25 per team |
| Touchdowns, FGs, turnovers, sacks | ~15–20 combined | |

So roughly **70 auto-called rounds per game**, versus a dozen or so a human Ref calls in a quarter.

Worth knowing rather than acting on: **First Down is "everyone drinks one," so ~40 of them is ~40
prompts per person across three-and-a-half hours.** Owner's call, and a fair one — people pace
themselves, and a game that never prompts anybody is the worse failure. Phase 2's frequency report
prints the real per-game counts so the dials can be set from data if anyone wants to.

**What this does need is queue discipline, not curation.** Detections cluster — a scoring drive can
produce five first downs in ninety seconds. The existing per-room `isActionInProgress` guard already
stops two rounds overlapping, so the question is what happens to a detection that arrives while a
round is live:

- **Queue it**, don't drop it. Depth-limited.
- **Drop it if it goes stale.** A detection older than ~90 seconds is discarded rather than fired
  late — calling a first down that happened two minutes ago is just confusing.
- Report both counts to the Ref so a room that is constantly backed up is visible rather than silently
  losing calls.

Per-card auto/suggest/off toggles still ship, defaulted to auto for everything detectable. The dial
exists so the table can tune after a real game, not because the default should be timid.

---

## The feed

**ESPN's undocumented endpoints.** Free, no API key, no signup, and they return exactly what this
needs:

| Endpoint | Use |
|---|---|
| `site.api.espn.com/apis/site/v2/sports/football/{league}/scoreboard` | list today's games, for the "pick your game" screen |
| `sports.core.api.espn.com/v2/sports/football/leagues/{league}/events/{id}/competitions/{id}/plays?limit=300` | play-by-play with stable play IDs, type IDs and text |
| `.../competitions/{id}/drives` | drive-level — needed for 3-and-out |
| `cdn.espn.com/core/{league}/playbyplay?xhr=1&gameId={id}` | the live XHR variant the site itself uses |

**`{league}` is `nfl` or `college-football`.** Same host, same shapes, same play objects — college is
a parameter, not a second integration. Build the adapter league-agnostic from day one rather than
retrofitting it; that is the whole cost of supporting both.

**The honest risk is not legal, it is stability.** These are undocumented and unversioned. ESPN can
change a field name mid-season and the feature silently stops detecting. Build for that:

- Treat every field as optional. A shape change must degrade to "no detections" and a Ref who can
  still call everything by hand — never a crash, and never a wrong call.
- A single feed adapter module behind an interface, so swapping to a paid provider later is one
  file. The paid options (SportsDataIO, Sportradar) start around $100/month, which is not a serious
  option for a game you play with friends, but the seam costs nothing to leave.
- Log detections with the raw play ID so a missed call can be diagnosed on Monday.

**Polling:** every ~5 seconds while a watched game is live. **One poller per GAME, not per room** —
eight rooms watching the Chiefs must share one subscription. Dedupe on ESPN's play ID so a play is
never fired twice. Back off hard on errors, and stop entirely when no room is watching.

**This will keep your Render instance awake**, which kills the cold start but burns free-tier hours
faster — the thing that just suspended you twice. This feature effectively requires the paid
instance. Factor that in before starting.

---

## What can actually be detected

Your deck, sorted by whether a machine can see it. This is the part to get honest about early,
because it sets expectations for the whole feature.

### Tier A — reliable from structured data

Play type plus score change. High confidence, safe to auto-call.

Touchdown · Field Goal · Sacks · Turnover (interception, fumble lost) · Safety ·
2 PT Conversion · Missed FG · Missed PAT · Turnover on Downs · Defensive TD ·
Special Teams TD · Big Play 20+ · Big Play 50+ · First Down · Penalty

Big Play 20+/50+ come straight off yards gained. First Down and Penalty are detectable and
deliberately *not* auto-called, per the pacing section.

**OWNER'S DECISION, 2026-09-01: kickoff and punt RETURNS count as Big Play 20+/50+.** A
28-yard kickoff return is a real 28-yard gain and it feels like a big play to the room;
"from scrimmage" is a stats convention, not a fan one.

The distinction that makes this safe, verified against every kicking play in the fixtures:

| Play type | What ESPN's `statYardage` holds |
|---|---|
| Kickoff, Punt | the **return** — a touchback or fair catch arrives as `0` |
| Field goal, PAT | the **kick's own length** — a 43-yard FG arrives as `43` |

So a 57-yard kick returned 28 yards fires Big Play **20+**, not 50+. Reading the kick
distance instead would recreate the bug where a 43-yard field goal fired as a 43-yard big
play. Placed kicks stay excluded for that reason, and blocked kicks stay out because their
yardage is not attributable to anyone.

Deliberately **not** extended to interception or fumble returns: those already fire Turnover,
and often Defensive TD as well, and a third card on a pick-six is not the intent.

**Consequence to know about:** a long kick-return touchdown now fires **Special Teams TD +
Big Play 50+** — two cards, one play, run sequentially. That is a huge moment and the pairing
looks right, but it is a decision rather than an accident.

Cost measured across the five real fixtures: **+1 to +9 cards a game**, mean +5.

### Tier B — derivable, medium confidence → suggest, never auto-fire

- **3 n Out** — drive-level: three plays, no first down, ends in a punt. Clean logic, but it needs
  the drives endpoint and careful handling of penalties inside the drive.
- **Blocked Kicks** — text match on the play description.
- **Onside Attempt / Onside Recovered** — kickoff play type with short yardage, plus text.
- **Fake Punt/FG** — the description sometimes says "fake"; sometimes it just reads as a run on
  fourth down.
- **Penalty Calls TD Back** — needs sequence reasoning: a touchdown followed by a negating penalty.
  The hardest of these and the most likely to misfire.

These surface to the Ref as *"3rd and out — call it?"* with a countdown. Ref taps yes or ignores it.

### Tier C — not detectable. Ref-only, forever.

- **Doink** — hitting the upright is commentary, not structured data.
- **Record Broken** — no structured signal exists.
- **Disqualified** — in the NFL, ejections appear inconsistently if at all. **In college this is
  Tier B**: targeting is a formal, reviewed, named foul that lands in the play text with the
  ejection, so it can be suggested reliably. A rare case where college data is *better*.

Say this plainly in the UI rather than letting people wonder why it never fires. These staying manual
is fine — they are the 40-point cards, they should feel like an event, and a human calling them is
part of the fun.

---

## What college changes

The feed is the same, so this is mostly product, not engineering.

**The game picker is the real work.** An NFL Sunday has about 13 games. A college Saturday has 50 to
100+, and the scoreboard endpoint **truncates by default** — you need `groups=50&limit=500` to get
the full Division I slate. So the picker needs to be a real screen: filter by conference (`groups`
takes a conference id — SEC is 8), sort ranked games first, and search by team name. Defaulting to
"ranked and in-progress" is probably the right first view. For the NFL, a flat list of today's games
is enough.

**Play-by-play quality varies far more.** Power conference games on major networks are as good as
NFL data. Group of Five and FCS games can be thin, delayed, or missing fields entirely. The detector
must degrade to silence rather than guess — and if a game's feed is sparse, the room should be told
the game is being watched but detection is unreliable, instead of quietly calling nothing.

**Overtime is a different shape.** College OT is possessions from the 25 with no game clock, and
two-point conversions become mandatory from the third period. Anything that assumes four quarters and
a running clock needs to not fall over — the app's own quarter tracking is independent of the real
game, so this is mainly about the header display and not misreporting the period.

**Pacing differs by league, so the auto-call defaults probably should too.** College games run more
plays and score more; some conferences far more. Phase 2's replay should be run over a set of college
games separately from NFL, and the per-card frequencies compared — do not assume one default set
fits both.

---

## How it fits the existing app

The shipped architecture is the constraint, and most of it helps.

- **The Ref stays authoritative.** An auto-call should go through the *same path* as a Ref
  declaration, not a parallel one — same `isActionInProgress` guard, same round lifecycle, same
  `finalizeRound`. Anything else forks the game loop, and this codebase has been bitten before by
  two paths that were supposed to do the same thing.
- **One process, all state in memory.** The poller is server-side, per game, and its state belongs
  alongside `rooms` — including in the teardown that Session 14 finally made complete. A watched
  game whose last room is reaped must stop polling.
- **The Ref can always override.** Manual declaration must work at any moment, including during a
  queued auto-call. The Ref taking over cancels the pending one.
- **A game ending detaches the room** and tells everyone, rather than silently going quiet.

New wire events, roughly: `attachGame`, `detachGame`, `gameFeedUpdate` (score/clock for the header),
`playSuggested` (Ref only), `playAutoCalled`. Keep the existing declaration events untouched.

---

## Phases

Four, and each ships something usable on its own.

### Phase 1 — watch a game, change nothing about play

Attach a room to a live game, NFL or college. Show score, quarter and clock in the header. **No
detection, no auto-calls.** Ref can detach.

The college game picker belongs here — it is the largest piece of UI in the whole feature and it is
worth building while the stakes are zero.

This proves the polling, the shared per-game subscription, reconnect behaviour, and teardown, while
being impossible to get wrong in a way that ruins a party. It is also genuinely nice on its own —
the score in the header is useful even if nothing else ever lands.

### Phase 2 — the detector, entirely offline ⭐

**This is the phase that decides whether the feature works, and it needs no live game.**

Write the detection engine as a **pure function**: play-by-play JSON in, list of cards out. No
server, no sockets, no timing.

Then capture archived play-by-play from real 2025 games — the same ESPN endpoints serve completed
games — and build a fixture set. **Fixtures from both leagues**, and deliberately including one
thin-data Group of Five game so the degrade path is exercised. Assert what the detector *would* have
called, game by game.

Why this matters more than it sounds: **you can only test this live on a Sunday.** A pure function
with archived fixtures turns a once-a-week test cycle into a once-a-minute one, and it is the only
way to know your Tier B logic is right before it embarrasses you in front of ten people. Run a whole
season through it and count how often each card fires — that is also how you validate the pacing
numbers above rather than guessing them.

Ships nothing to users. Do it anyway.

### Phase 3 — suggestions to the Ref, with the delay offset

The detector goes live, but **every detection is a suggestion**, and the Ref confirms. Broadcast
delay offset and the ±5s calibration nudge land here.

A season could reasonably stop here. The Ref stops missing things, nothing fires without a human,
and the offset gets proven in real rooms before anything is automatic.

### Phase 4 — auto-call the curated set

Tier A auto-fires, per-room opt-in, with the minimum gap between rounds. Ref override always
available.

---

## Decisions — settled 2026-08-28

1. **Paid Render instance: yes.** A live poller makes it structural rather than optional.
2. **Auto-call everything detectable**, First Down and Penalty included. Tier B suggests to the Ref.
   Tier C stays manual. See the pacing section for the arithmetic and the queue rules that go with it.
2b. **Broadcast delay is a fixed 45 seconds, with no setting.** The Ref configures nothing. Tune the
   constant centrally if real play says otherwise, and tune it upward.
3. **Both leagues, NFL and college**, with a real game picker.
4. **The existing game is untouched.** This is additive: same declaration path, same round lifecycle,
   same rules. A room that never attaches a game plays exactly as it does today, and a room can detach
   at any moment and carry on by hand.
5. **The physical deck is unaffected.** The two tracks stay independent, as they have been throughout.
