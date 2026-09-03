# Sessions 1–14: what was decided, and what we got wrong on the way

This is the compressed history of the work that took Shotgun Formation from an
untested single-file server to the state it was in before the live-game feed
began (Session 15). It exists so the fourteen session reports it replaces can be
deleted without losing anything that would change a future decision.

**It deliberately keeps the wrong turns.** Roughly half the value in those
reports is not the fix — it is the diagnosis that turned out to be wrong, and
why. A record of only the outcomes would make this project look far more
straightforward than it was, and would let the same mistakes back in.

> Superseded by this file: `SESSION_3_REPORT.md`, `SESSION_4_REPORT.md`,
> `SESSION_7_REPORT.md`, `SESSION_8_REPORT.md`, `SESSION_9_REPORT.md`,
> `SESSION_10_REPORT.md`, `SESSION_11_REPORT.md`, `SESSION_12_REPORT.md`,
> `OVERNIGHT_REPORT.md`, `NIGHT_LOG.md`, `PAUSE.md`,
> `docs/SESSION_13_REPORT.md`, `docs/SESSION_14_REPORT.md`.
>
> **Not** superseded, and still live: `DECISIONS.md` (the reasoning behind D1–D10
> is longer than any summary of it), `FOLLOW_UPS.md`, `docs/SPEC.md`,
> `DEPLOY.md`, `MANUAL_TEST.md`, `PLAYTEST.md`, `docs/AUDIT_PRE_LAUNCH.md`.

---

## The one pattern worth internalising

**In nine of the fourteen sessions, at least one premise in the run sheet was
wrong.** Not vague — specifically, verifiably wrong, in a way that would have
sent the work to the wrong file. In several cases the wrong premise was mine
from a previous session.

| Session | The premise | What was actually true |
|---|---|---|
| 3 | Phase C is a payload leak — room B's stale player showing in room A's stats | **Cross-room score theft.** A reconnect awarded room A's Mike room B's Mike's drinks, *and deleted room B's entry*. Two rooms corrupted from one reconnect, silently |
| 4 | The elimination fallback at `App.js:2051` is dead — safe to delete in the rebuild | **Reachable by construction.** The `updatePlayerStats` writer is gated on `name`, but three other writers are not, and `gameStarted` ships unnamed entries straight into state |
| 7 | A player who never confirms loses their pours (a timer problem) | The client always emitted at timer expiry. **Leaving** lost them — the round's assignments lived only in local state |
| 7 | Remove all three `document.body.style.zoom` calls | There were **four** |
| 8 | `server.js:688` emits the whole stats object (my own parked hypothesis) | Wrong. That line is the most defensive emit in the file. The bug was **a stale closure in the client** |
| 8 | The pour-replay bug is an event-ordering race | Ordering was fine. **The client was rejecting the server's replay outright** |
| 8 | "A 4th player rejoined and everyone's cards vanished" | The rejoin was a red herring. **Any** roster change blanked every hand, because a `[]`-deps effect froze `players` at the empty first render |
| 9 | `SPEC.md` and `PHYSICAL_GAME_PLAN.md` both claim 156 cards with one First Down | `PHYSICAL_GAME_PLAN.md` **has never existed in this repository**, in any commit. No "156" claim exists in any tracked document, ever. 150 was already correct |
| 10 | The avatars have white edges from a bad matte | Measured 0.6% near-white edge pixels across all ten — noise, not a matte. A white cut runs 20–60%. Most likely a stale bundle in the browser |
| 10 | Items 2 and 3 are two bugs; the swap allowance is implicated | **One bug**, in a three-case switch. The server was never involved in the swap |
| 11 | "Pour two of four, refresh, the outstanding drinks are gone, reported as zero" | The pours were **never lost** — the server asked for them **twice**. A 4-drink card could be poured six times. The structural diagnosis was right; the symptom was inverted |
| 13 | The Ref reloads and comes back with the whistle | Not with other players connected — the disconnect handler correctly promotes someone the moment the Ref drops |
| 14 | `gameStarted` has four emit sites | **Five.** The fifth is ES6 shorthand and had evaded the grep since Session 8 |
| 14 | The `requestGameState` index-0 fallback needs guarding | It **could not fire at all** — a TDZ self-reference that threw. My bug, from Session 12 |
| 14 | The transports fix is a reordering | Needs `tryAllTransports`; `rememberUpgrade: true` re-creates the failure for every returning player |

The habit that caught these was writing the failing test **first**, from the
report's own words, and watching what colour it came back. Several came back
green — which is what "your diagnosis is wrong" looks like.

---

## Standing decisions

Full reasoning is in `DECISIONS.md`; this is the index.

- **D1** — Vitest at the **root** only, as a devDependency. Jest would have
  collided with `react-scripts`' own Jest config in `client/`. Render never
  installs it.
- **D2** — The harness **spawns `server.js` as a child process** rather than
  requiring it. `server.js` calls `listen()` at module load and exports nothing;
  requiring it would have meant refactoring the entrypoint purely for
  testability. Cost: tests cannot read server internals.
- **D3** — Consequently, tests assert on **observable socket behaviour**, never
  on internal structure. No debug/state-dump endpoint was added, because that
  would be a new production surface.
- **D7** — The wild-swap allowance is keyed by **player name**, not socket id, so
  it survives a reconnect. Keying by socket id is not a weaker guard, it is a
  guard with a one-line bypass — a client can reconnect at will.
- **D10** — The stats scoping fix reaches into the reconnection identity
  machinery, further than the one-liner it looked like. Flagged at the time as
  the change most wanting owner review.

Two product decisions worth restating because they keep coming back:

- **First Down is Ref-only.** The box carries five because a card can be lost;
  they are spares, not hands. Dealing them to players would be wrong. The app was
  already right, and nothing needed implementing (Session 9).
- **The printed deck (160) and the app deck (150) are different things**, and
  conflating them caused a whole session's confusion. `SPEC.md` §3.1 separates
  them.

---

## What each session actually changed

**Overnight / Sessions 1–2** — First tests ever. Server concurrency: five bugs in
the same family, all "global state that should be room-scoped". Found
cross-room scoreboard leakage as a fifth, unasked-for fix (D5).

**Session 3** — The swap guard, and the scoping fix that turned out to be score
theft rather than a payload leak. Also flagged two things that were true and
uncomfortable: the room-code collision retry shipped with **no test behind it**
(forcing a real collision needs ~1,200 simultaneous rooms), and it is an
unbounded `while` loop on a single-threaded server. And `main` tracked **857
files under `node_modules/`**, so the deploy could fail for reasons unrelated to
any of the work.

**Session 4** — Deploy blocker cleared. Established that the "dead" elimination
fallback is reachable, and that `gameStarted` leaks the module-global
`playerStats` at four sites — the same leak Session 3 had scoped everywhere
else and walked past here.

**Sessions 5–7** — The UI port. Fonts were never actually loading. Four
`document.body.style.zoom` calls, not three. `client/src/App.css` (1,007 lines)
became dead and was deliberately *left* so the old UI could be diffed against the
new one. Screenshots became a deliverable — and ~9 MB of permanent git weight,
flagged at the time.

**Session 8** — The session that made the case for client-side tests. Three
sessions of green server tests could not see that the client was throwing the
server's pour replay away. Standings double-convert had a **third** site nobody
flagged. Round Results now falls back to Standings after 20s. Avatars moved out
of `client/src/assets/` because CRA was walking ~9 MB of PNGs on every hot
reload for files no bundle referenced.

**Session 9** — Icons regenerated from the real logo source. The 16px honesty
note: at that size the wordmark is unreadable and the mark alone is the only
option. Also: broke the dev server and fixed it — the module resolver had been
broken since 19 Aug, which is the most likely explanation for the phantom
avatar edges reported in Session 10.

**Session 10** — Mostly a session of *disproving* things. The avatar replacement
never arrived; the art on disk measured clean, including in the bundle actually
being served.

**Session 11** — Ref handoff. The whistle could be handed to a player who wasn't
there. Pours already given were asked for again.

**Session 12** — Reconnect rejoin, split pours, ending a round early. Noted but
did not fix: a host tapping Leave Game **deletes the room even when disconnected
players still hold seats and drinks there** — real behaviour nobody chose. The
10+ card case needed eight consecutive browser deals to fail to reproduce, which
is exactly why it shipped.

**Session 13** — Host lifecycle, Ref visibility, Lock In, and the room reaper.
Two unguarded `playerStats` reads in `leaveGame` were guarded **without a repro
test** — pinned as source tripwires and explicitly to be treated as latent
rather than proven.

**Session 14** — `formerPlayers` scoped per room, `gameStarted` scoped, log
hygiene, transports. Rehearsed under `NODE_ENV=production`.

---

## Still open, carried forward

- The room-code collision retry has never been observed, only read. Three lines,
  unbounded loop, no test.
- `leaveGame` deleting a room out from under disconnected players.
- Dead client handlers (`playerDisconnected`, `playerReconnected`, `roundEnded`)
  and dead server emits (`roundState`, `wildCardSelection`). See `SPEC.md` §6.
- `client/src/App.css`, 1,007 lines, dead since the port and kept only for
  diffing. It should go once the new UI is settled.
- `screenshots/` — ~9 MB, permanent in git history whether or not the working
  tree keeps it.
