# Replay watch — what would have happened

Five real fixtures, run through the detector with **kick and punt returns now
counting as Big Play** (`422f8b4`). The zero-play fixture is excluded; it is a
degrade-path regression case, not a game.

Transcripts are in `transcripts/` (gitignored — they are run artifacts).

---

## 1. What returns added, and what the flag fixes added

| Game | Before returns | After returns | After type-over-flag | Total Δ |
|---|---:|---:|---:|---:|
| IND 31 – ATL 25 | 77 | 86 | **87** | +10 |
| CAR 7 – NO 17 | 45 | 50 | **50** | +5 |
| SF 26 – LAR 42 | 66 | 71 | **70** | +4 |
| OSU 38 – PSU 14 | 48 | 49 | **51** | +3 |
| SMU 26 – MIA 20 | 67 | 72 | **75** | +8 |
| **mean** | **60.6** | **65.6** | **66.6** | **+6.0** |

Returns contributed +5.0 a game; the flag fixes a further +1.0 net — three
college turnovers and two college penalties and two sacks added, two false
penalties (offsetting/declined) removed.

Every returns card is a kickoff or punt return of 20+ yards, clustered at 20–31
— ordinary returns, not spectacular ones — which is why IND–ATL gained nine: it
has fifteen kickoffs.

**OSU–PSU gained only one from returns.** College kickoffs are overwhelmingly
touchbacks, so that change is close to NFL-only in practice; the flag fixes are
the opposite, landing almost entirely on college.

**The decision to see:** a long kick-return touchdown now fires **Special Teams
TD + Big Play 50+** — two cards, one play, run sequentially. None occurs in these
five fixtures, so it is untested against real data. It looks right — that is a
huge moment — but it is a decision, not an accident.

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

## 3. False-negative sweep — FIXED

I read all **575 blank plays** across the five transcripts and found three real
misses. All three are now fixed (`type over flag`), and the sweep re-run finds
**zero remaining false negatives**: 457 blanks, 3 flagged, all three correctly
silent (two declined penalties, one offsetting).

They were one fault, not three. Every rule that leaned on a boolean was trusting
a field ESPN sets reliably in the NFL and unreliably in college:

| Flag | NFL | College |
|---|---|---|
| `isTurnover` on an interception | 3 of 3 set (`Pass Interception Return`) | **0 of 3** set (`Interception`) |
| `isPenalty` on an accepted penalty | **23 of 23** | misses ~1 a game |
| anything saying "this was a sack" | absent when the play is typed as a fumble recovery | same |

The fix reads the **type first, the flag second, and the text only where neither
carries the event** — with negation still beating all three, because a pick wiped
out by roughing is re-typed `Penalty` while a sack wiped out by holding keeps the
word "sacked" in its text.

### What the audit turned up beyond the three

Cross-referencing every play type against its flags across all five games:

- **`Fumble Recovery (Own)` correctly does not set `isTurnover`** — recovering
  your own fumble is not a turnover. The type-based rule is written to match
  `(Opponent)` only, so it does not break this.
- **`Sack Opp Fumble Recovery` was already firing both Sacks and Turnover.** Only
  `Fumble Recovery (Own)` hid a sack.
- **Scoring flags are solid in both leagues** — every touchdown type has
  `scoringPlay` set, 31 of 31. No change needed, and none made.
- **A pre-existing bug the new tests caught: offsetting penalties were firing
  `Penalty`.** Offsetting means the down is replayed and nothing stands, so
  nothing should fire. Two false calls removed across the fixtures.
- **`Safety` has no occurrence in any fixture**, so it remains covered by unit
  test only and unverified against real data.

### One regression I caused and fixed

The first cut vetoed any play whose text contained "declined". CAR–NO Q2 4:09
carries **two** penalties — one enforced, one declined — and it silently lost a
call that had been working. Enforcement now wins, and that play is a test.

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


---

# Real-data card coverage

Added after the sweep. Ten real games now — five original, five captured
specifically to exercise cards that had never fired.

## The table

| Card | Mode | Fired | Verdict |
|---|---|---:|---|
| First Down | auto | 280 | |
| Penalty | auto | 110 | |
| Big Play 20+ | auto | 108 | |
| Touchdown | auto | 54 | |
| Sacks | auto | 39 | |
| 3 n Out | suggest | 31 | |
| Field Goal | auto | 28 | |
| Turnover | auto | 20 | |
| Big Play 50+ | auto | 13 | |
| Turnover on Downs | auto | 12 | |
| Onside Attempt | suggest | 3 | |
| Missed FG | auto | 2 | thin |
| Defensive TD | auto | 2 | **was zero — works** |
| Blocked Kicks | suggest | 2 | thin |
| Safety | auto | 1 | **was zero — works** |
| Special Teams TD | auto | 1 | **was zero — works** |
| Penalty Calls TD Back | suggest | 1 | **was zero — works** |
| Onside Recovered | suggest | 1 | **was zero — works** |
| Disqualified | suggest | 1 | **was zero — WAS BROKEN, fixed** |
| 2 PT Conversion | auto | 1 | thin |
| Missed PAT | auto | 1 | thin |
| **Fake Punt/FG** | suggest | **0** | **no signal exists** |
| Doink, Record Broken | never | 0 | Ref-only by design |

## Fixtures captured to close the gaps

| Game | Covers |
|---|---|
| CIN 20 – NE 26 (`nfl/401772781`) | Defensive TD, Penalty Calls TD Back |
| TEN 24 – SEA 30 (`nfl/401772886`) | Special Teams TD, Onside Attempt |
| ARI 27 – CAR 22 (`nfl/401772730`) | Onside Recovered |
| IOWA 16 – ORE 18 (`college/401752898`) | Safety |
| MSST 21 – UGA 41 (`college/401752762`) | Disqualified (targeting) |

## One card was broken, exactly as 2 PT was

**`Disqualified` could never have fired.** The rule required the words
"disqualified" or "ejected". ESPN writes neither. The real play reads:

> `PENALTY MSU Targeting (#13 J.Manning) 15 yards from UGA24 to UGA39, 1ST DOWN.`
> `NO PLAY. The previous play is under automatic review - "Targeting". CALL UPHELD`

Targeting **upheld on review** is the ejection — that is what the review decides.
Fixed to read the review outcome, and to stay silent on `CALL OVERTURNED`, which
is a real distinction: overturned means no ejection.

Same shape as 2 PT Conversion: passing its unit tests, structurally incapable of
firing, and only findable by running real games through.

## One card has no signal at all

**`Fake Punt/FG` cannot fire, and no fix is available from this feed.** The word
"fake" does not appear in ESPN play text in **111 games** scanned across both
leagues. A fake reads as an ordinary rush or pass on fourth down, and there is no
structural marker distinguishing it from a scramble.

The plan half-anticipated this ("sometimes the description says 'fake'; sometimes
it just reads as a run on fourth down"). It is worse than that — it never says
it. **Recommend treating it as Ref-only**, like Doink and Record Broken, so the
UI can say so plainly rather than leaving a card that silently never appears. I
have not changed its mode, since mode changes are the owner's.

## The five that turned out to work

Defensive TD, Special Teams TD, Safety, Penalty Calls TD Back and Onside
Recovered all fired correctly on the first real play that exercised them. No
changes needed.

## Standing guard

`tests/card-coverage.test.js` now fails if any machine-called card has never
fired against a fixture. `Fake Punt/FG` is listed as a documented gap with its
reason; removing a card from that list without a fixture that exercises it fails
the test. This is the check that would have caught 2 PT and Disqualified years
earlier than reading transcripts did.

## Pacing across ten games

Mean auto-calls per game is now **67.2**, range **50 to 87**. The five new
fixtures sit at 52–75, so the original five were representative; the spread
between a slog and a shootout remains the thing that matters more than the mean.

## Sweep across all ten

923 blank plays, 8 containing an eventful word, **all 8 correctly silent** —
four declined penalties, two offsetting, and an Oregon player recovering his own
fumble. Zero false negatives.
