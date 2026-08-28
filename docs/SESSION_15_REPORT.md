# Session 15 — the live game feed and the detector

Branch `live-game-feed`, off `main` at `55b091c`. Four commits, four tags.
**Nothing pushed.** Suite **310 → 419 passing**, 44 files. **No existing test was
modified.**

---

## The frequency table

Real 2025 games, run through the real detector. This is the number the pacing
decision rests on.

### NFL

| Card | Mode | IND 31 - ATL 25 | CAR 7 - NO 17 | SF 26 - LAR 42 | Mean |
|---|---|---:|---:|---:|---:|
| First Down | auto | 52 | 42 | 52 | **48.7** |
| Big Play 20+ | auto | 20 | 9 | 10 | **13.0** |
| Penalty | auto | 10 | 7 | 8 | **8.3** |
| Touchdown | auto | 7 | 3 | 10 | **6.7** |
| Sacks | auto | 9 | 4 | 1 | **4.7** |
| 3 n Out | suggest | 3 | 5 | 2 | **3.3** |
| Turnover | auto | 3 | 2 | 2 | **2.3** |
| Big Play 50+ | auto | 3 | 2 | 0 | **1.7** |
| Field Goal | auto | 3 | 1 | 0 | **1.3** |
| Turnover on Downs | auto | 2 | 1 | 1 | **1.3** |
| Blocked Kicks | suggest | 0 | 1 | 1 | **0.7** |
| 2 PT Conversion | auto | 1 | 0 | 0 | **0.3** |
| Missed FG | auto | 1 | 0 | 0 | **0.3** |
| Missed PAT | auto | 1 | 0 | 0 | **0.3** |
| Onside Attempt | suggest | 0 | 0 | 1 | **0.3** |
| **TOTAL cards** | | 115 | 77 | 88 | **93.3** |
| **of which auto-called** | | 112 | 71 | 84 | **89.0** |
| **plays** | | 191 | 166 | 179 | **178.7** |
| **multi-card plays** | | 22 | 10 | 9 | **13.7** |
| **negated plays** | | 6 | 6 | 7 | **6.3** |
| **suppressed by negation** | | 1 | 0 | 0 | **0.3** |

### College

| Card | Mode | OSU 38 - PSU 14 | SMU 26 - MIA 20 | KYW 7 - WFLA 28 | Mean |
|---|---|---:|---:|---:|---:|
| First Down | auto | 34 | 44 | 0 | **26.0** |
| Big Play 20+ | auto | 7 | 20 | 0 | **9.0** |
| Penalty | auto | 3 | 14 | 0 | **5.7** |
| Touchdown | auto | 7 | 4 | 0 | **3.7** |
| 3 n Out | suggest | 2 | 4 | 0 | **2.0** |
| Sacks | auto | 4 | 2 | 0 | **2.0** |
| Field Goal | auto | 1 | 4 | 0 | **1.7** |
| Big Play 50+ | auto | 3 | 0 | 0 | **1.0** |
| Turnover | auto | 1 | 1 | 0 | **0.7** |
| Missed FG | auto | 0 | 1 | 0 | **0.3** |
| Turnover on Downs | auto | 0 | 1 | 0 | **0.3** |
| **TOTAL cards** | | 62 | 95 | 0 | **52.3** |
| **of which auto-called** | | 60 | 91 | 0 | **50.3** |
| **multi-card plays** | | 12 | 20 | 0 | **10.7** |
| **negated plays** | | 3 | 14 | 0 | **5.7** |

*(The third college column is the empty-feed game. Its zeros are the point —
see "the degrade path" below.)*

### What the table says that the plan did not

**It is heavier than planned. ~89 auto-called rounds per NFL game, not ~70.**
The plan estimated ~40–42 first downs; the real number across three games is
**42–52, mean 48.7**. Add Big Play 20+ at a mean of 13 — a card the plan did not
cost at all — and the volume is about 27% above the estimate.

At 89 rounds across three-and-a-half hours that is **a round every 2 minutes 20
seconds**, all game. Worth knowing before the first live night, because it is
your decision and the arithmetic changed. Two dials exist if it turns out to be
too much, and they need no code:

- **Big Play 20+ → suggest** takes it from 89 to ~76 and costs the least, since
  a 20-yard gain is the least eventful thing on the list.
- **First Down → suggest** takes it to ~40 and is the real lever.

**Penalty came in lower than the plan's ~12–13, at 8.3.** Not a miss: ESPN sets
`isPenalty: false` on a *declined* penalty, so the detector counts accepted ones
only, which is the right number to drink to.

**Multi-card plays are not rare: ~14 a game in the NFL, ~11 in college.** So
sequential rounds are an ordinary event, roughly one every ninety seconds of
game action, not an edge case. Every one of those is two rounds back-to-back
under the current settings. That is the strongest argument in the table for
demoting Big Play 20+, since Touchdown + Big Play 50+ and Penalty + First Down
are the two commonest pairs.

---

## Fixtures captured

All real, completed 2025 games. Captured through the same normaliser the live
poller uses, so what the tests assert is what production will produce.

| League | Game | Plays | Why |
|---|---|---:|---|
| nfl | SF 26 - LAR 42 | 179 | high-scoring, 10 TDs |
| nfl | CAR 7 - NO 17 | 166 | 24-point slog; has a real blocked FG |
| nfl | IND 31 - ATL 25 | 191 | overtime, 5 periods |
| college | OSU 38 - PSU 14 | 146 | Power conference, major network |
| college | SMU 26 - MIA 20 | 206 | overtime; 14 penalties, the negation cases |
| college | KYW 7 - WFLA 28 | **0** | **a real game with an empty feed** |

Plus `fixtures/cases/multi-card.json`: four plays lifted verbatim from those
games for the addendum's cases, each naming the game and sequence it came from.

---

## The addendum: negation and co-occurrence

You asked which signal I used and how reliable it looked. **Three signals, and
they are not equally good.**

**1. `isTurnover`, `scoringPlay` and `scoreValue` are already post-enforcement.
Fully reliable.** A pass intercepted and then wiped out by roughing the passer
arrives from ESPN with `isTurnover: false`. I checked the actual record for that
play (CAR/NO seq 31800) rather than assuming. So Turnover, Touchdown, Field Goal
and Safety need no negation handling at all — ESPN has already done it.

**2. Down and distance are also post-enforcement, in both leagues. This is the
best signal in the feed.** An 11-yard completion on 3rd-and-11 negated by
holding arrives as `3-11 → 3-21`. So First Down, derived from `end.down === 1`
for the same team, is **inherently negation-aware with no text parsing at all**.
That is the answer to the addendum's main question: for First Down I did not
need a negation rule, because the authoritative field already encodes it.

**3. `statYardage` is NOT a gain when a penalty was accepted. This is where
negation actually bites.** A 20-yard pass interference on an **incomplete pass**
arrives with `yards: 20` (IND/ATL, real play). A yardage-only rule reads that as
Big Play 20+ — a card for a play on which nobody gained anything. So yardage
cards are suppressed on a negated play, and that is the only place suppression
is applied.

**The "No Play" text marker exists in both leagues** — NFL writes `- No Play.`,
college writes a trailing `NO PLAY` — and it matched `isPenalty` closely across
the fixtures (14 of 14 in SMU/MIA, 6 of 7 in CAR/NO). But **text is the weakest
thing in the feed**, so it is used *only to suppress, never to fire*. Suppressing
wrongly costs one missed Big Play; firing wrongly puts a card on the table for a
play that did not happen.

**How reliable, plainly:** the cost of the suppression rule is measurable and
tiny. Across all six fixtures exactly **one** play was suppressed — the 20-yard
DPI. I would not claim more confidence than that sample supports; what I can say
is that the rule cannot produce a *wrong* call, only a missed one, and that is
the right side to err on.

**Co-occurrence** is ordered by an explicit priority table, bigger event first,
so a stale drop loses the First Down and keeps the Touchdown. Cards release
sequentially through the normal single-round path — no forked game loop and no
multi-card round. A test runs a whole game twice and asserts identical output,
because "deterministic" is worth nothing if it is not checked.

---

## Tier A that turned out not to be reliably detectable

**Turnover on Downs is not a play-level event.** A failed fourth down is an
ordinary incompletion or short run: `isTurnover` is false and nothing in the text
distinguishes it. It is named only as a drive result, so it moved to
`detectDrive`. My first attempt matched the word "downs" in play text, which
finds **players called Downs** — J.Downs, C.Downs — in two of the six fixtures.
That is a test in the suite now.

**2 PT Conversion nearly shipped broken.** The try is not a play of its own: it
is appended to the touchdown's text, and the play still carries `scoreValue: 6`
for the touchdown. A `scoreValue === 2` rule can never match. The only signal is
ESPN's wording, `ATTEMPT SUCCEEDS` / `ATTEMPT FAILS`.

Both bugs were invisible to hand-built plays and obvious the moment a real game
ran through — which is the case for fixtures in one line.

**Genuinely rare rather than broken:** Safety, Defensive TD and Special Teams TD
produced zero across six games. Those are real frequencies, not silence; each is
covered by a unit test with a hand-built play.

---

## Tier B that turned out better than expected

**Blocked Kicks and 3 n Out are both stronger than the plan assumed.** Blocked
kicks have their own play type (`Blocked Field Goal`) rather than needing a text
match, and fired correctly in two of six games. 3 n Out came out clean at 2–5 per
game from `offensivePlays === 3` plus a punt result — no penalty-inside-the-drive
handling needed. Both are defensible as auto-call candidates after a live game.

**Disqualified in college is exactly as good as hoped.** Targeting is a formal,
reviewed, named foul and lands in the play text with the ejection. None occurred
in the two college fixtures, so this is verified by unit test only, and it is
correctly refused for the NFL.

---

## The degrade path

**The plan's premise did not hold.** It asked for a Group of Five game with thin
data. I sampled FCS slates across three dates and play-by-play was **complete** —
text, yardage and downs present on every play of every game. ESPN's lower-division
coverage is better than the plan assumed.

Rather than synthesise thin data I went looking for a real failure and found a
better one: **KYW 7 - WFLA 28, a completed game for which ESPN carries zero
plays.** The feed exists, the game happened, the endpoint returns an empty list.
That is the degrade path, and it is not invented.

It produces **silence, not garbage**: the detector returns `[]`, the replay feed
ends cleanly with reason `no plays` rather than hanging, and the room is told the
feed ended. Separately, a test strips each field in turn from a full game and
asserts detection degrades to *fewer* detections rather than wrong ones, and that
nothing throws.

---

## Where the plan and run sheet were wrong

1. **`groups=50` is not the full Division I slate.** It returns **4 events**.
   FBS is `groups=80` (45 events on 2025-11-01) and FCS is `81`. I also could not
   reproduce the truncation the plan warns about: the default with no `groups` and
   no `limit` already returned all 45.
2. **`gameStarted`-style estimates of pacing were low** — see the table.
3. **The thin-data premise** — see above.
4. **`CLAUDE.md` rule 1 says "do not edit `server.js`."** That rule is scoped to
   the `ui-rebuild` branch and has been superseded since Session 13; this session
   required new socket events, which the run sheet specifies. Flagging it because
   the rule is still written as absolute in `CLAUDE.md` and should probably be
   re-scoped.

---

## One real bug found by the fixtures

The pipeline cleared its release tick when the feed ended — so a game going
final threw away **up to 45 seconds of queued detections**, which are exactly the
plays the room has not seen on television yet. The end of a close game is the
worst possible place to lose calls. It now keeps releasing until the queue
drains.

---

## Sequencing: nothing declares a card

Held to strictly. The queue fills, the delay applies, everything is logged with
the raw ESPN play id, and the release step broadcasts `playAutoCalled` with
`wouldHaveCalled: true`. A test asserts that after a full replay **no card was
declared and no round started**. Phase 3 is one line at the release site.

---

## State

- Branch `live-game-feed`, HEAD `94f7b8f`, tree clean, **nothing pushed**.
  `main` untouched at `55b091c`.
- Tags: `phase-15-feed`, `phase-15-detector`, `phase-15-attach`,
  `phase-15-delay-queue`.
- 419 tests, 44 files. No existing test modified. Client builds; the built bundle
  loads in Chromium with no console error.
- The suite is now ~5 minutes. The two slow attach tests use a `BROADCAST_DELAY_MS`
  env seam — the same pattern as `ROOM_IDLE_TIMEOUT_MS`, exercising the real code
  path on a short clock rather than keeping a second copy of the number.

### Worth knowing before Phase 3

- **A live poller keeps the Render instance awake**, which is what the plan
  flagged and what has already suspended the service twice. This effectively
  requires the paid instance.
- **`docs/SESSION_15_REPORT.md` numbers come from six games.** Enough to set the
  dials from data rather than estimates, not enough to call them settled. The
  frequency script takes any fixture you add, so a wider sample is a capture away.
