# Artifacts

Run outputs: videos, stills and scenario results. **Not committed** — the videos
alone are ~11 MB each. Every one is reproducible with the commands below.

## The demo — the feed calling a game at real speed

```bash
ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
node scripts/record-demo.mjs                 # ~11 min; DEMO_MINUTES=n to change
```

IND 31 – ATL 25 from Q1 10:15 (`DEMO_FROM=12`), at **1×**, three real players in
a real room with auto-calling on. Records three viewpoints and writes:

| File | What |
|---|---|
| `video/page@*.webm` | three recordings: Ref, an ordinary player, a third seat |
| `still-01-attached.png` | live score header, the one-off "the feed is calling" line |
| `still-02-first-call.png` | the first round the feed started on its own |
| `still-03-assigning.png` | a player handing out drinks |
| `still-04-results.png` | round results on the board |
| `still-05-multi-card.png` | back-to-back rounds from one play (only if one occurs) |
| `still-06-dial.png` | the per-card dial |
| `still-07-paused.png` | auto-calling paused, game still attached |
| `still-08-resumed.png` | resumed |
| `demo-manifest.json` | room code, the cards called, what each still shows |

Each still is captured twice: `*.png` is the Ref's window, `*-player.png` is an
ordinary player's, since the two see deliberately different things.

The videos have no audio and are one file per browser context. Playwright names
them by internal id, so `demo-manifest.json` records which room they belong to.

## The picker, against a real past slate

```bash
FEED_DEMO_DATE_NFL=20251109 FEED_DEMO_DATE_COLLEGE=20251108 \
  ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
node scripts/demo-picker.mjs
```

There is no live football most of the week, so the picker is empty most of the
week. `FEED_DEMO_DATE_NFL` / `FEED_DEMO_DATE_COLLEGE` point the scoreboard at a
real past day — real endpoint, real shapes, real teams and scores. **Read from
the server's environment only**, never from the client, so a browser cannot ask
for another day and production cannot drift into one. Unset, it is inert.

| File | What |
|---|---|
| `picker-nfl.png` | a full NFL Sunday, 12 games |
| `picker-college-ranked.png` | college, ranked-only (the default view), 14 games |
| `picker-college-all.png` | the whole Saturday slate, 45 games |
| `picker-college-search.png` | searching "ohio" — one result, rank badge, score |

## The scenario checks

```bash
ALLOW_REPLAY_ATTACH=1 BROADCAST_DELAY_MS=4000 PORT=3002 node server.js
node scripts/verify-scenarios.mjs
```

Every check in `docs/MANUAL_TEST_LIVE_FEED.md`, plus a plain game with no feed
attached, driven over real sockets against a real server. Prints pass/fail with
what was observed and writes `scenario-results.json`.
