# The walkthrough recordings

Three recorded sets, all driven from real recorded games at 1× so the pacing on
camera is the pacing in the room. Nothing here is mocked: it is the real server,
the real client bundle, the real detector, six real browser seats playing.

| Set | Game | Runtime | Folder |
|---|---|---|---|
| NFL | IND 31 – ATL 25, from play 11 | ~13 min | `artifacts/walkthrough-nfl/` |
| College | SMU 26 – MIA 20, from play 95 | ~13 min | `artifacts/walkthrough-college/` |
| Long drive | IND 31 – ATL 25, from play 103 | ~27 min | `artifacts/long-drive-nfl/` |

Each folder holds:

- `1-PRIMARY-ref-Ref.webm` — the Ref's seat. The only one that sees the picker
  open, the league switch and the game attaching.
- `2-secondary-player-<name>.webm` — a player's seat, chosen because it holds
  the most cards this stretch will actually call.
- `timeline.txt` — one line per event, stamped from the start of recording, so
  the videos can be jumped through rather than watched hoping.
- `manifest.json` — the room, the fixture, the primary seat, every round.

## Reproducing

```bash
# 1. Server, with the replay seam on
ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js

# 2. Any one of the three
caffeinate -dimsu node scripts/record-walkthrough.mjs nfl
caffeinate -dimsu node scripts/record-walkthrough.mjs college
caffeinate -dimsu node scripts/record-walkthrough.mjs long-drive
```

**Use `caffeinate`.** A run was lost to the machine idling to sleep: the replay
timers stall, everything queued is dropped as stale on wake, and the loop finds
its deadline already passed and exits with nothing recorded. The footage is
there and it is an hour of six seats doing nothing.

## Re-running just the post-processing

Playwright names videos `page@<hash>.webm` and only flushes them when the
context closes, so the last thing a recording does is rename six anonymous
files. That used to be the only place it happened, which meant a stopped
waiter cost the whole artifact.

It is now a separate, idempotent step. Against any recording folder:

```bash
node scripts/finalise-recording.mjs artifacts/walkthrough-college
```

It maps each video to its seat by creation order against the seat list in
`pending.json` — written when the seats are created, long before anything can
go wrong — renames the two viewpoints worth keeping, deletes the other four,
and reports the timeline. `timeline.txt` is appended as the run goes, so it
survives a run that dies part-way.

If `pending.json` is missing it refuses and leaves the files alone. Wrong names
on the footage would be worse than no names.
