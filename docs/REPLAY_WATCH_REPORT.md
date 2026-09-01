# Replay watch — what would have happened

Five real fixtures, run through the detector with **kick and punt returns now
counting as Big Play** (`422f8b4`). The zero-play fixture is excluded; it is a
degrade-path regression case, not a game.

Transcripts are in `transcripts/` (gitignored — they are run artifacts).

---

## 1. What returns added

Measured against the previous commit, not from memory.

| Game | Auto-calls before | After | Δ |
|---|---:|---:|---:|
| IND 31 – ATL 25 | 77 | **86** | +9 |
| CAR 7 – NO 17 | 45 | **50** | +5 |
| SF 26 – LAR 42 | 66 | **71** | +5 |
| OSU 38 – PSU 14 | 48 | **49** | +1 |
| SMU 26 – MIA 20 | 67 | **72** | +5 |
| **mean** | **60.6** | **65.6** | **+5.0** |

Every added card is a kickoff or punt return of 20+ yards. The returns are
clustered at 20–31 yards — ordinary returns, not spectacular ones — which is
why IND–ATL gained nine: it has fifteen kickoffs.

**OSU–PSU gained only one.** College kickoffs are overwhelmingly touchbacks, so
this change is close to NFL-only in practice. Worth knowing before assuming it
lands evenly across both leagues.

**The decision to see:** a long kick-return touchdown now fires **Special Teams
TD + Big Play 50+** — two cards, one play, run sequentially. None occurs in these
five fixtures, so it is untested against real data. It looks right to me — that
is a huge moment and deserves two rounds — but it is a decision, not an accident.

---

## 2. CAR 7 – NO 17, quarter by quarter

*(You wrote 401772636 for the slog; that id is IND–ATL, the overtime game. The
24-point slog is 401772877, and it is what this walks.)*

**50 calls across 166 plays.** Per quarter: **15, 13, 11, 11**. The quarters get
quieter as the game dies, which is exactly right — and the floor never drops
below eleven.

### Q1 — 15 calls

Opens immediately: the game's first play is a 25-yard kickoff return, so the
room drinks before Carolina has run a snap. Then a slow, competent Panthers
drive that keeps producing: a 4-yard run to the sticks, a defensive offside, a
6-yard scramble on 3rd-and-3, an 11-yard catch. **Five calls in the opening
four minutes, none of them dramatic** — this is exactly the "carrying a dull
game" case, and it works.

At **9:31 Bryce Young is intercepted — and nothing fires**, correctly: roughing
the passer wiped it out. ESPN reports the play as `isTurnover: false` and the
down as 1st-and-10 Carolina, so the negation needs no cleverness from us. The
room hears nothing about a turnover that did not happen.

**7:59 the first touchdown.** Dowdle from five yards. The First Down that came
with it is suppressed as redundant — one card, one moment.

New Orleans answer: a sack, then **a 52-yard bomb to Olave (Big Play 50+)**, then
three first downs walking it to the two — and it ends in a 20-yard field goal.
Six calls in that drive alone. The quarter closes with another 27-yard kickoff
return and a first down.

### Q2 — 13 calls

**The 62-yard Olave touchdown at 9:21** is the loudest moment of the half, and it
is a clean single card. Around it the quarter is penalties and sacks: three
false starts and holds, two sacks. **A run of six plays with nothing** between
2:19 Q1 and 14:42 Q2 across the quarter break — the longest drought in the game,
and it is a punt exchange, which is the correct thing to be silent about.

### Q3 — 11 calls

The quietest stretch of real football. A blocked field goal (**suggested**, not
called — Tier B), a Bryce Young aborted-snap fumble recovered by New Orleans
(**Turnover**), and six first downs, most of them Kamara grinding out 4 and 16
yards. Nothing scores all quarter. **The card feed is the only thing happening**,
which is precisely the argument for auto-calling first downs.

### Q4 — 11 calls

An interception at 13:00, a **30-yard touchdown to Johnson at 10:20** immediately
followed by a 26-yard kickoff return, roughing the passer at 9:32, then New
Orleans running out the clock with three straight third-down conversions
(**three First Downs in the last five minutes**) while the game is already
decided.

### Reading it back

The gaps are short. The longest silence in the entire game is **ten plays**, and
it straddles a quarter break — so in real time it is the ad break, when nobody is
watching the phone anyway. In live football that is under three minutes.

The rhythm is roughly **a call every three plays**, and in a game with three
touchdowns it never feels empty. My honest read: **this carries the dull game,
and it is not relentless.** The risk in this fixture is not too little.

---

## 3. False-negative sweep

I went through all **575 blank plays** across the five transcripts, flagged every
one containing an eventful word, and read them. **Three real classes of miss.**
These are not hypotheses — each is confirmed against the raw ESPN record.

### ① College interceptions never fire Turnover — **high confidence**

**The most serious finding in this report.**

| Game | Interceptions in the text | Flagged `isTurnover` |
|---|---:|---:|
| OSU – PSU | 1 | **0** |
| SMU – MIA | 2 | **0** |
| all three NFL games | 5 | 4 (the fifth was correctly negated) |

ESPN's college feed gives the play `type: "Interception"` and sets
`isTurnover: false`. Our Turnover rule reads only `isTurnover`, so **every college
interception is silently missed** — three across two games, including a
game-ending pick at Q5 0:00 in SMU–MIA.

Should have been: **Turnover**. Confidence: high — the type is literally
`Interception`.

### ② A sack that ends in a fumble does not fire Sacks — **high confidence**

IND–ATL Q3 11:40:

> `(Shotgun) D.Jones sacked at ATL 30 for -10 yards (J.Walker). FUMBLES (J.Walker), and recovers at ATL 31.`

Type is `Fumble Recovery (Own)`, so our sack rule — which matches on the type —
never sees it. The quarterback was sacked; the room should drink.

Should have been: **Sacks**. Confidence: high.

### ③ College accepted penalties are under-flagged, ~1 per game — **medium**

| Game | Accepted penalties in text | Flagged `isPenalty` |
|---|---:|---:|
| OSU – PSU | 4 | 3 |
| SMU – MIA | 15 | 14 |
| all three NFL games | 23 | **23** |

The NFL flag is perfect. College misses about one a game. The example is a punt
with `PENALTY OSU Kick Catch Interference 15 yards`, enforced, arriving as
`isPenalty: false`.

Should have been: **Penalty**. Confidence: medium — one per game is a small
sample and I would want more college fixtures before calling it systematic.

### Not misses, though they looked like it

- **`TURNOVER ON DOWNS` in the SMU–MIA play text** with `isTurnover: false` — but
  the drive-level rule caught it, so the card did fire. Detected by a different
  route, not missed.
- Every `J.Downs` / `C.Downs` hit — player names. The detector is right to ignore
  them, and this is exactly why the play-text rule for turnover-on-downs was
  removed.
- Declined penalties, fair catches, touchbacks — correctly silent.

**Common thread:** all three real misses are places where we trust a **boolean
flag** over the **play type**, and college sets the flags less reliably than the
NFL. That is the shape of the next bug too, and it is worth fixing before Part B
rather than after.

---

## 4. Suspicious calls

**None.** My sweep flagged three, all of which are false alarms in the sweep's own
regexes rather than the detector:

> `J. Sayin pass to C. Tate for 45 yds, for a TD (J. Fielding KICK)`

College writes *"for a TD"* and *"for 45 yds"*, not *"touchdown"* and *"yards"*.
The detector fired **Touchdown + Big Play 20+** off `scoringPlay` and
`statYardage`, which is correct and is why it reads the abbreviated college
format without trouble.

Every other call across all five games is justified by its play text.

---

## 5. The two extremes, per game

Droughts are measured in **consecutive plays with nothing**, ignoring clock
stoppages, because a clock-based gap is meaningless across a quarter break or
college overtime.

| Game | Busiest 5 minutes | Longest drought |
|---|---|---|
| IND 31 – ATL 25 | **14 calls** from Q1 9:24 — a turnover, a sack, three big plays, two TDs, a missed PAT | **5 plays**, 1m21s (Q1 4:00→2:39): two incompletions and a punt |
| CAR 7 – NO 17 | **8 calls** from Q2 4:09 — four penalties, three first downs, a big play | **10 plays** across the Q1→Q2 break: a punt exchange |
| SF 26 – LAR 42 | **10 calls** from Q2 3:46 — a TD, two big plays, a sack, five first downs | **6 plays**, 2m44s (Q2 10:41→7:57): a stalled red-zone drive |
| OSU 38 – PSU 14 | **9 calls** from Q2 0:29 — two TDs, a turnover, a 50+ | **6 plays**, 1m34s (Q1 6:15→4:41): touchback then three-and-out |
| SMU 26 – MIA 20 | **11 calls** from Q2 1:03 — a TD, four big plays, a FG, three first downs | **8 plays**, 2m13s (Q2 6:53→4:40): punt, then a stalled drive |

### What the extremes say

**The busy end is the one to watch, not the quiet end.** Fourteen calls in five
minutes of IND–ATL is a round every 21 seconds, and with a 21-second Standard
round that queue never drains — the stale-drop and depth limits will be doing
real work there, and the room will be drinking continuously. Every one of those
fourteen is legitimate; it was genuinely a wild five minutes. But it is the case
where "alive" tips into "relentless", and it is the five minutes to watch at 1×
before deciding.

**The quiet end is a non-problem.** The worst drought in any of the five games is
ten plays, and it spans a quarter break. Nothing here suggests a room would ever
be left waiting.

**If you want one dial:** demoting **Big Play 20+** to suggest removes 5.7 calls a
game on average and hits the busy clusters hardest, because that is where big
plays bunch. It leaves the dull-game floor — first downs — untouched, which is
the opposite trade to demoting First Down.

---

## Recommendation before Part B

Fix the three false negatives first. They are all in the same class — trusting a
flag where the type is more reliable — and they are cheap:

1. Turnover from `type: "Interception"` as well as `isTurnover`
2. Sacks from `"sacked"` in the text when the type is a fumble recovery
3. Penalty from the text when college leaves `isPenalty` false

Each needs a failing test from these fixtures first. None of them changes Part A;
all three change what the owner would see in a live game.
