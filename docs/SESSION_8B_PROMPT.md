# Session 8, part 2 — resume at item 2

Continuing `docs/SESSION_8_PROMPT.md`. Items 0 and 1 are done and committed (HEAD `6fd4642`,
113 tests green). `PAUSE.md` has your own handoff — read it first.

Same rules throughout: **no push, no merge, never touch `main`**. Failing test before every
behavioural fix. All 113 tests stay green. Commit and tag per item.

---

## Item 2 — a rejoining player blanks everyone else's hand  ← start here

Your parked hypothesis, from `PAUSE.md`: **`server.js:688` emits the whole `playerStats`
object where every other `updatePlayerHand` call site emits `{ standard, wild }`.** That
would give every client a payload whose `standard`/`wild` are `undefined`, blanking the hand
until `finalizeRound` re-broadcasts a correct one — which matches exactly what the owner saw,
including the cards returning at round end.

Prove it before you fix it. **Failing test first:** 4 players, host declares a card, one
player drops and rejoins mid-round, assert every *other* player still holds their cards
**and can still assign drinks**. That second assertion is the one that matters — a hand that
renders but can't be played is the actual reported symptom.

If the hypothesis is wrong, say so plainly and keep digging; don't bend the test to fit it.

Tag `phase-8b-hand-blank`.

## Items 3–6 — as written in `SESSION_8_PROMPT.md`

3. Mid-round refresh still can't pour. The `:3002` server is confirmed current, so this is a
   real remaining defect, not a stale build. Suspect arrival order: the replayed
   `distributeDrinks` racing the new `roundState` listener, or a later `updatePlayers` /
   `gameStarted` resetting distribution state after them.
4. Ref can be handed to a disconnected player — guard both server and client, and check the
   automatic reassignment paths for the same hole.
5. Revert the board to Standings after ~20s idle; cancel on any new round or manual tab tap.
6. Record the Round Results anonymity decision in `FOLLOW_UPS.md` as a **product decision**,
   not tech debt.

---

## New — make the avatar system take any number of avatars

The owner has a 10-character sheet (Shotgun, Beer Bong, Double Fist, Keg Stand, Party Bucket,
Chugger, Tailgate Toast, Beer Splash, Funnel Force, Victory Pour). **I am producing the
cropped avatars separately and will hand you a replacement `Avatars.js`.** You are not
cutting images.

What you do now is make the code stop caring how many there are:

- `client/src/components/Avatars.js` currently exports 8 data URIs. Refactor every consumer
  to derive the count from the map — no hardcoded `8`, no `% 8`, no fixed-length array.
  Dropping in a 10-entry map must require zero other edits.
- Keep the deterministic name→index hash so a person is the same character every game.
- **Collision handling:** with ≤ N players and N avatars, no two players in a room may share
  an avatar — offset on collision rather than letting the hash repeat.
- Above N players, sharing is unavoidable. Add a **per-player accent ring** derived from the
  same name hash, so two players on the same character are still instantly distinguishable.
  Ring colour comes from a small fixed palette that works on the dark tiles — do not use the
  amber/neon/red accents, those are reserved for deck semantics.
- The game currently allows up to 13 players; 10 avatars means repeats from 11 on. That's
  expected and the ring is the mitigation.

Test it: 13 players, assert every avatar assignment is deterministic by name, that the first
10 are unique, and that ring colours differ wherever a character repeats.

Tag `phase-8b-avatars`.

## Finish with

`SESSION_8_REPORT.md` — what each bug actually was, which hypotheses were wrong (yours and
mine), test counts, and anything that became Tier B. Then stop: committed, tagged, nothing
pushed.

Two dependency decisions are parked in `PAUSE.md` awaiting the owner — surface them at the
top of the report rather than deciding them yourself.
