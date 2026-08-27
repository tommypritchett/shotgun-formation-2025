# Session 14 — former players scoped, and deploy prep

Branch `overnight-rebuild`. Five items, six commits, four tags. **Nothing pushed.**
Suite: **284 → 305 passing**, 37 files. Clean-checkout rehearsal passes under
`NODE_ENV=production`.

| Item | Tag | Commit |
|---|---|---|
| 1 — `formerPlayers` scoped to its room | `phase-14-former-players-scoped` | `330cded` |
| 2 — `gameStarted` carries one room | `phase-14-scoped-game-stats` | `ac61b2b` |
| 3 — log hygiene | `phase-14-log-hygiene` | `51a0339` |
| 4 — the two config values | `phase-14-config` | `c5b9fbf` |
| 5 — deploy prep | (docs) | `1e4b40d`, `3720c84` |

---

## 1. What the `formerPlayers` migration touched

Nested to **`formerPlayers[roomCode][playerName]`** behind three accessors —
`formerPlayersIn`, `rememberFormerPlayer`, `forgetFormerPlayer`. Every site moved:

| Site | Before → after |
|---|---|
| `handleJoinRoom` lookup | `formerPlayers[name]` + `entry.roomCode === roomCode` → `formerPlayersIn(roomCode)[name]`. **The room check is now the lookup.** |
| post-rejoin delete | `delete formerPlayers[name]` → `forgetFormerPlayer(roomCode, name)` |
| `leaveGame` write | → `rememberFormerPlayer(roomCode, entry)` |
| `requestGameState` candidates | `Object.values(formerPlayers).filter(p => p.roomCode === roomCode)` → `Object.values(formerPlayersIn(roomCode))` |
| fast-reconnect delete | → `forgetFormerPlayer(roomCode, returning.name)` |
| `disconnect` write | → `rememberFormerPlayer(roomCode, entry)` |
| teardown | a scan over every name on the server → `delete formerPlayers[roomCode]` |
| `purgeRoomState`'s test seam | updated with it |

**The `roomCode` field is dropped** from the entries. It existed only to re-derive the scope
the nesting now enforces, and nothing reads it — verified by grep after the migration.

**Scoping the map alone would not have fixed the bug.** The `disconnect` handler built its
snapshot from

```js
Object.entries(playerStats).filter(([id, stats]) =>
  stats.name === leavingPlayer.name || id === socket.id)
```

with no room narrowing — the one site of five that never got `roomEntriesForName` — and then
took the highest-`totalDrinks` match, copying **that stranger's hand and totals** into this
player's entry. Narrowed with the existing helper. The socket's own entry is now added
explicitly, because `startGame` does not stamp a `name` onto `playerStats`; the name arrives
further down in that same handler. That is what the old `|| id === socket.id` clause was
carrying, and it is still load-bearing on a first disconnect. Dropping it would have been a
silent regression that the two-Mike tests would not have caught.

---

## 2. Can `:1973`'s index-0 path still fire? No — it could not fire at all

The run sheet asked me to confirm the name path is the one taken and index 0 is only a legacy
fallback. **The reality is different and worse than described.** The fallback was written:

```js
const returning = claimed || (claimedName ? null : returning);
```

`returning` referencing itself inside its own initializer. That is a TDZ error, not a
fallback. A `requestGameState` with no `playerName` threw
`Cannot access 'returning' before initialization` and the client received **nothing at all** —
no `gameStarted`, no error, silence. Reproduced directly before fixing.

I introduced this in Session 12. Fixed to `possibleFormerPlayers[0]`, which is what was
intended.

**Who it affected:** every current client sends a name — five `requestGameState` emit sites in
`App.js`, all with `playerName` — so this only ever fired for a stale cached bundle. Which is
precisely who is holding one in the minutes after a deploy.

---

## 3. `gameStarted` — there were five sites, not four

The run sheet lists four, and `FOLLOW_UPS.md` F1 has listed the same four since Session 8.
There are **five**. The room-wide kickoff broadcast in `startGame` writes the field in ES6
shorthand:

```js
io.to(roomCode).emit('gameStarted', { hostId, hands, playerStats });
```

`playerStats`, not `playerStats: playerStats` — so it never matched the grep every previous
audit used, and it is the **largest** of the five, because it goes to the whole room rather
than one socket. All five now use `buildRoomStats(room)`.

F1 is marked done in `FOLLOW_UPS.md`. **F2's deletion is now provable and was deliberately not
done** — deleting client code the day before a deploy is not a trade worth making.

---

## 4. The transports finding — the run sheet is right, and not sufficient

Verified against the installed packages rather than taken on trust. `socket.io-client` 4.8.1,
`engine.io-client` 6.6.2. `tryAllTransports` appears in the source **once**, in `_onError`,
and is **not in the defaults object** — so it is `undefined` unless passed, and the "try the
next transport" branch never runs. Confirmed by hand against a polling-only server:

```
OLD  ['websocket','polling'], no tryAllTransports   -> failed: websocket error
NEW  ['polling','websocket'] + tryAllTransports     -> connected
     ['websocket','polling'] + tryAllTransports     -> connected
```

The shipped configuration does **not** fall through to the polling entry sitting in its own
list. A phone on a network that blocks WebSocket upgrades failed to connect at all.

**The part the run sheet misses:** reordering alone does not help a returning player.
`rememberUpgrade: true` makes the client open on WebSocket whenever a previous connection
upgraded — which is everyone who has played once. Move from home wifi to a network that blocks
WebSocket and you are back in the same dead end regardless of list order. `tryAllTransports:
true` is the option that actually closes it, and it is in. That is the third line above.

Chose to **match the server's order** (`['polling', 'websocket']`) rather than drop the option,
so the two lists read the same. The options moved to `client/src/lib/socket-options.js` so the
tests exercise the same object the app imports rather than a copy.

`maxHttpBufferSize` 1e8 → 1e6, as asked.

---

## 5. Log hygiene

193 → 178 `console.log` calls. Only the loops:

- `Heartbeat acknowledged by <id>` — once per socket per 10 seconds, forever, idle lobby
  included. Gone; the listener stays, silent.
- The eight-line `ASSIGN DRINKS DEBUG` block — the client flushes a delta every 700ms per
  pouring player. Replaced with one outcome line.
- The per-player chatter inside the pour loop, and the two near-identical per-player dumps in
  `finalizeRound`.

Measured: 12 pours plus a finalize went from **282 log lines to under 120**. The boot line
printing the running commit SHA stays and is now pinned by a test.

`tests/log-volume.test.js` budgets an idle lobby and a round of pouring, so this fails when
the log gets loud again whichever line is responsible.

**One thing I had to fix in the harness to make that test real.** The fake player never
answered the server's heartbeat, so the idle-lobby budget passed against the very loop it
exists to catch. It now acks exactly as `App.js` does.

---

## 6. The rehearsal, under `NODE_ENV=production`

Fresh `git clone` of `overnight-rebuild` at `c5b9fbf` into a temp directory, then
`NODE_ENV=production npm run build`, then `node server.js`.

| Check | Result |
|---|---|
| Build completes | ✅ `react-scripts` is in `client/package.json` **dependencies**, confirmed rather than assumed |
| `GET /` | ✅ 200, serves `<title>Shotgun Formation</title>` |
| `GET /socket.io/?EIO=4&transport=polling` | ✅ 200 |
| LAN address in the built bundle | ✅ none — `10.0.0.*` and `192.168.*` both absent |
| URL the bundle will use | ✅ `https://shotgunformation.onrender.com` |
| `tryAllTransports` present in the bundle | ✅ |
| `client/.env.local` / `client/build` tracked | ❌ both gitignored, 0 files tracked |
| LAN address in any tracked file | ❌ none outside `tests/` and `docs/` |

**Worth knowing:** your local `client/build` *does* have `http://10.0.0.42:3002` baked in,
because `client/.env.local` exists on your machine. It cannot reach production — neither the
env file nor the build directory is tracked, and Render builds from source. The rehearsal was
run from a clean clone precisely to prove that.

`DEPLOY.md` is rewritten. The old one was badly stale: it claimed this branch touched
`server.js` only and that `App.js` was byte-identical to `main`, which stopped being true
several sessions ago. It also described a `pre-push` hook that no longer exists — it was
deleted during the Session 8 deploy attempt and never restored, so **nothing in git is
blocking a push**. The owner's post-deploy check is at the end of the new document in his own
words.

---

## Reported, not fixed

1. **The bundle is 416 kB gzipped**, against ~72 kB on `main`. The avatars and card art are
   inlined as base64 data URIs in `components/Avatars.js`. One-time cost, cached after — but
   it is the number most likely to be felt on the cellular join in the post-deploy check.
   Moving that art to real image files is the fix. Flagged in `DEPLOY.md`.
2. **Every player's hand is visible to every client in the room.** `buildRoomStats` spreads
   the whole `playerStats` entry, including `standard` and `wild`, and `updatePlayerStats` is
   a room-wide broadcast. This session made that payload *smaller* (one room instead of all
   rooms) but did not change what a room-mate can see. Pre-existing, live on `main` today,
   and not something to start changing the day before a deploy.
3. **Still no end-to-end browser test of a real game.** Every claim about what a real phone
   shows during a real round is read from source or checked by hand. `MANUAL_TEST.md` remains
   the only thing covering that gap.

---

## Where the run sheet was wrong

- **`gameStarted` has five emit sites, not four.** The fifth is written in ES6 shorthand and
  has evaded the grep since Session 8.
- **The `requestGameState` index-0 fallback could not fire at all.** It was a TDZ
  self-reference that threw. My bug, from Session 12.
- **The transports fix needs `tryAllTransports`, not just reordering.** `rememberUpgrade:
  true` re-creates the failure for every returning player.

---

## State

- Branch `overnight-rebuild`, HEAD `3720c84`, tree clean, **nothing pushed, nothing merged,
  `main` untouched at `e994b5f`**.
- Local servers restarted: game server on **:3002** running `3720c84`, CRA dev server back up
  on **:3000**. (I killed the CRA one by mistake mid-session and restarted it; it compiled
  clean.)
- `docs/SPEC.md` updated: the `formerPlayers` shape, the `gameStarted` payload, the teardown
  note, and the socket options.
- `FOLLOW_UPS.md`: F1 closed, F2 unblocked.
- The merge and the deploy are yours.
