# Session 14 — one room, one set of former players. Then we ship.

**This is the last session before production.** Everything the owner reported across Sessions 10–13
is fixed and manually verified on real devices. What is left is the last of the cross-room
name-collision class, one known payload leak, and the small stuff that makes the first live night
diagnosable.

Rules unchanged: **no push, no merge, never touch `main`.** All 284 tests stay green. Commit and tag
per item. Leave `.claude/settings.local.json` alone.

---

## 1. `formerPlayers` belongs to a room, not to the server

**Owner's rule, verbatim:** *"Former players should only be relevant if referencing an active game
code, and each room should only look at former players of their game room number."*

Both halves matter, and the second one is the part that is easy to drop.

### What it is today

`server.js:38` — `const formerPlayers = {};` keyed by **player name, globally across every room**.
Each entry carries a `roomCode` field, and some call sites check it while others don't.

That makes the map a single global namespace for names. Two concurrent games both containing a
"Mike" collide: the second Mike to drop **overwrites** the first Mike's entry — his drinks, his
shotguns and his hand. When the first Mike comes back his saved state is gone, so he is admitted as a
brand-new player on zero, while the other Mike can be handed cards that were never drawn from his own
room's deck.

This is the same defect class that `roomEntriesForName` (`:258`) was written to kill. It is the last
member of that family still standing.

### The shape to move to

**Nest it: `formerPlayers[roomCode][playerName]`.**

Not a composite string key. Nesting is what makes the owner's two rules structural rather than
something every future call site has to remember:

- *"each room only looks at its own"* — a scoped lookup is the only lookup available.
- *"only relevant if the room is active"* — `formerPlayers[roomCode]` is absent once the room is
  gone, so a dead room cannot resurrect anybody.
- Teardown becomes `delete formerPlayers[roomCode]` — one line that cannot miss an entry, replacing
  the scan at `:101-105`.

Drop the now-redundant `roomCode` field from the entries, or keep it only if a test depends on it —
say which and why.

### Every site to move

Do not miss one; a half-migrated map is worse than the current state.

| Line | What it does |
|---|---|
| `:841` | `const formerPlayer = formerPlayers[playerName]` — reconnect lookup in `handleJoinRoom` |
| `:946` | `delete formerPlayers[playerName]` after a successful rejoin |
| `:1811` | `leaveGame` writes the leaver's entry |
| `:1973` | `Object.values(formerPlayers).filter(p => p.roomCode === roomCode)` — becomes `Object.values(formerPlayers[roomCode] \|\| {})` |
| `:2154` | `delete formerPlayers[returning.name]` on the fast reconnect path |
| `:2230` | `disconnect` writes the entry |
| `:101-105` | teardown scan — collapses to one delete |
| `:84` | the test state-injection helper |

**Also check `:1973` while you are there.** It picks `possibleFormerPlayers[0]` — Session 12 added a
name to the `requestGameState` payload, so confirm the name path is the one actually taken and index 0
is only a legacy fallback. If it can still fire for a client that sends a name, that is a bug.

### And the write that feeds it is still unscoped

`server.js:2215-2217`, in the `disconnect` handler:

```js
const allPlayerEntries = Object.entries(playerStats).filter(([id, stats]) =>
  stats.name === leavingPlayer.name || id === socket.id
);
```

**No room narrowing.** Four other sites (`:861, 904, 2020, 2058`) use `roomEntriesForName(ownedSocketIds, name)`;
this one was missed. It then takes the highest-`totalDrinks` match and copies **that stranger's hand
and totals** into `formerPlayers`.

So scoping the map alone does not fix the bug — this filter would still pull another room's Mike into
this room's entry. Narrow it with the existing helper, in the same commit.

### Tests

- Two rooms, a "Mike" in each with different totals. Both disconnect, both reconnect. Each gets **his
  own** drinks, shotguns and hand. Run it in both disconnect orders.
- Same name in two rooms where only one has disconnected — the connected Mike is untouched.
- A room is reaped → `formerPlayers` has no key for it, and a player from that room rejoining by URL
  is treated as new rather than resurrected onto a dead room.
- Regression: single-room disconnect/reconnect still restores drinks and hand exactly as today.

Tag `phase-14-former-players-scoped`.

---

## 2. `gameStarted` still ships every room's stats to every client

`FOLLOW_UPS.md` **F1**, open since Session 8 and correctly deferred each time. It is the right time now:
this is the last session before the deploy, and it is the last thing making another game's data visible
inside a client.

Four sites still send the module-global map:

`server.js:994`, `:1087`, `:1953`, `:2137` — all `playerStats: playerStats`.

`buildRoomStats(room)` already exists, is already tested, and is already the shape the client expects.
Point all four at it.

Two things this fixes at once:
- Another game's players stop landing in your client's state, where `App.js` writes the `gameStarted`
  payload **straight into `playerStats` with no name filter** and the scoreboard's name resolution then
  reads them.
- The payload stops growing with every game the server has ever hosted. `playerStats` has no
  per-room deletion outside teardown, so on a long-lived instance this is what eventually makes joining
  hang on a phone — and it would be diagnosed as a network problem.

**Test:** two rooms, both started. Room A's `gameStarted.playerStats` contains nobody from room B.

**Do not delete the elimination fallback in `App.js` this session.** `FOLLOW_UPS.md` F2 says fixing F1
makes it provably unreachable, and that is true — but deleting client code the day before a deploy is
not a trade worth making. Record in the report that the deletion is now justified, and leave it.

Tag `phase-14-scoped-game-stats`.

---

## 3. Make the log usable on the first live night

When a friend says *"it broke around 11"*, Render's log buffer is bounded and not searchable. Right now
11pm will be tens of thousands of lines of noise.

- **`:710`** — `console.log(\`Heartbeat acknowledged by ${socket.id}\`)` fires **every 10 seconds per
  connected socket**, forever, including an idle lobby. Delete it.
- **`:1622` onward** — the `ASSIGN DRINKS DEBUG` block is ~8 lines per call, and the client flushes every
  700ms per pouring player. Six players through one 21-second round is on the order of a thousand lines.
  Delete the block; keep at most one line recording the outcome.
- There are **195 `console.log` calls** in `server.js`. Do not do a general cleanup — that is a diff
  nobody can review the day before shipping. Just kill the two hot loops above, plus anything else that
  fires per-tick or per-draw.

**Keep the boot line printing the running commit SHA.** It is the single most useful line in the file
and it has already caught a stale server once.

Tag `phase-14-log-hygiene`.

---

## 4. Two config values, one character each

- **`server.js:25`** — `maxHttpBufferSize: 1e8` is **100 MB per message**, 100× the Socket.IO default.
  Nothing this app sends is anywhere near that, and on a 512 MB instance a couple of oversized messages
  are an out-of-memory kill. Set `1e6`.
- **`client/src/App.js:127`** — `transports: ['websocket', 'polling']`. socket.io-client is pinned at
  **4.8.1**, where `tryAllTransports` defaults to **false**: if the first transport fails to open, the
  client does **not** fall back to the next. WebSocket-first therefore means a phone on a network that
  blocks WebSocket upgrades fails to connect at all rather than degrading. The server's own order
  (`:21`) is polling-first and correct.

  Either drop the option entirely and let the client do its normal upgrade dance, or match the server.
  Say which you chose. **Verify against the installed version rather than my claim** — if 4.8.1 behaves
  differently from what I have described, say so and change nothing.

Tag `phase-14-config`.

---

## 5. Make the deploy a single command

The owner runs the merge and the push. Your job is to leave it so there is nothing to work out at the
time.

- Bring `DEPLOY.md` current: the expected HEAD sha, the commands, and what to check after.
- Re-run the **clean-checkout rehearsal** — clone to a temp directory, `npm run build`, `node server.js`,
  and confirm it serves. **Run the build with `NODE_ENV=production` set**, since that is what Render does
  and the previous rehearsal did not cover it. `react-scripts` is in `client/package.json` `dependencies`
  so this should pass; confirm it rather than assume it.
- Confirm again that **no tracked file contains a LAN or localhost address**, and that
  `client/.env.local` is still gitignored and absent from the tree.
- Put the post-deploy check at the end of `DEPLOY.md` in the owner's words: open the live site, DevTools →
  Network → **WS** filter → reload → the socket URL must be `wss://shotgunformation.onrender.com/...` and
  must not contain `10.0.0.42`. Then join once from a phone on **cellular**, off the home wifi. Then two
  rooms both with a game started, and the server stays up.

Do **not** merge, push, or deploy. Leave the tree clean on `overnight-rebuild`.

---

## Then

Short report: what the `formerPlayers` migration touched, whether `:1973`'s index-0 path can still fire,
the transports finding, the rehearsal result under `NODE_ENV=production`, and test counts. Anything that
differed from the account above, including where this prompt was wrong.

Then stop. The merge and the deploy are the owner's.
