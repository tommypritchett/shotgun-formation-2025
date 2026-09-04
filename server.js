const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path'); // Import the path module
const fs = require('fs');
// Live game tracking. Additive: a room that never attaches a game plays exactly
// as it did before, and every one of these modules is inert until `attachGame`.
const { Watchers } = require('./server/feed/watchers');
const { ReplayFeed } = require('./server/feed/replay-feed');
const { LiveFeed, listGames } = require('./server/feed/live-feed');
const { runPipeline } = require('./server/feed/pipeline');
const { modeFor, AUTO, SUGGEST, MODES } = require('./server/feed/cards');
const { pathFor } = require('./server/feed/routing');
const app = express();
const server = http.createServer(app);


// Set keep-alive timeout to ensure connections stay open longer
server.keepAliveTimeout = 65000;  // 65 seconds
server.headersTimeout = 66000;    // Slightly longer than keepAliveTimeout

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  },
  transports: ['polling', 'websocket'], // Match client priority
  pingInterval: 8000, // More frequent pings for mobile (optimized)
  pingTimeout: 30000, // Shorter timeout for faster mobile detection
  connectTimeout: 45000, // Shorter connect timeout for mobile
  // 1 MB. This was 1e8 — 100 MB per message, 100x the socket.io default.
  // Nothing this app sends is remotely near it, and on a 512 MB instance a
  // couple of oversized messages are an out-of-memory kill.
  maxHttpBufferSize: 1e6,
  // Additional mobile optimizations
  allowEIO3: true, // Better compatibility
  serveClient: false, // Reduce overhead
  cookie: false // Reduce cookie overhead
});


const PORT = process.env.PORT || 3001; // Default to 3001 if not on Heroku
const cors = require('cors');
const rooms = {};  // Store rooms and players
const playerStats = {};  // Store drink and shotgun counts for each player
const roundResults = {};  // Store drink assignments for each round
/**
 * Disconnected players, NESTED BY ROOM: `formerPlayers[roomCode][playerName]`.
 *
 * This used to be one global slot per NAME across the whole server. Two games
 * each with a Mike shared that slot, so the second Mike to drop overwrote the
 * first Mike's drinks, shotguns and hand; the first then came back to an entry
 * stamped with the other room's code, failed the room check, and was admitted
 * as a brand-new player on zero.
 *
 * Nesting makes the owner's two rules structural rather than something every
 * call site has to remember: a scoped lookup is the only lookup available, and
 * a room that is gone has no key here at all, so it cannot resurrect anybody.
 */
const formerPlayers = {};
const usedCards = {};  // Store used cards for each room to enable deck replenishment

// ✅ ROUND-AWARE RECONNECTION: Track active rounds and declared cards
// Round lengths in seconds. These are the ONLY source of truth: `startTimer`
// counts down from them and `activeRounds.timeRemaining` is measured against
// them, so a reconnecting player is told the same time everyone else sees.
const ROUND_DURATIONS = { standard: 21, wild: 11, firstDown: 6 };

/** Ten drinks make a shotgun. The one place that number lives on the server. */
const DRINKS_PER_SHOTGUN = 10;

const activeRounds = {};  // Track which rooms have active rounds: { roomCode: { declaredCard, timeRemaining, startTime } }
const socketIdMappings = {};  // Track old->new socket ID mappings during active rounds: { roomCode: { oldSocketId: newSocketId } }

/**
 * A room closes when NOBODY has been active in it for this long.
 *
 * It does NOT close when the host leaves. The person who made the room is the
 * one most likely to put their phone down, hand it to somebody, or step
 * outside; closing on their exit takes a game away from nine other people who
 * are still holding cards. Room membership belongs to the table.
 *
 * Both values are overridable from the environment so the reaper can be tested
 * on a short clock against the real code path, rather than a test keeping its
 * own copy of half an hour.
 */
const ROOM_IDLE_TIMEOUT_MS = Number(process.env.ROOM_IDLE_TIMEOUT_MS) || 30 * 60 * 1000;
const ROOM_REAP_INTERVAL_MS = Number(process.env.ROOM_REAP_INTERVAL_MS) || 60 * 1000;

/**
 * Everything the server holds for one room, deleted in one place.
 *
 * Room state is spread across seven maps keyed three different ways — by room
 * code, by socket id, and by player NAME — so partial teardown is the default
 * failure. A leaked `formerPlayers` entry hands a stale hand and stale totals
 * to the next player who happens to reuse that name — which is why the map is
 * nested by room code and dropped whole, rather than scanned.
 *
 * Takes its maps as an argument so the teardown can be tested on its own.
 *
 * @returns {boolean} whether the room existed
 */
const purgeRoomState = (roomCode, state) => {
  const rooms = state.rooms || {};
  const playerStats = state.playerStats || {};
  const roundResults = state.roundResults || {};
  const formerPlayers = state.formerPlayers || {};
  const usedCards = state.usedCards || {};
  const activeRounds = state.activeRounds || {};
  const socketIdMappings = state.socketIdMappings || {};
  const room = rooms[roomCode];

  // Every socket id this room has ever used: its current players, the old ids
  // they reconnected FROM, and anyone the round results still remember.
  const ids = new Set();
  ((room && room.players) || []).forEach((p) => { if (p && p.id) ids.add(p.id); });
  Object.entries(socketIdMappings[roomCode] || {}).forEach(([oldId, newId]) => {
    ids.add(oldId);
    ids.add(newId);
  });
  Object.keys(roundResults[roomCode] || {}).forEach((id) => ids.add(id));
  ids.forEach((id) => { delete playerStats[id]; });

  // Nested by room, so this cannot miss an entry the way the old name-keyed
  // scan could.
  delete formerPlayers[roomCode];

  delete roundResults[roomCode];
  delete activeRounds[roomCode];
  delete socketIdMappings[roomCode];
  delete usedCards[roomCode];
  // A reaped room must not leave a poller running against ESPN.
  if (state.watchers && typeof state.watchers.releaseAllForRoom === 'function') {
    state.watchers.releaseAllForRoom(roomCode);
  }

  delete rooms[roomCode];
  return Boolean(room);
};

/** Close a room for good, stopping its round timer first so it cannot tick on. */
const destroyRoom = (roomCode, reason) => {
  const round = activeRounds[roomCode];
  if (round && round.intervalId) clearInterval(round.intervalId);
  const existed = purgeRoomState(roomCode, {
    rooms, playerStats, roundResults, formerPlayers, usedCards, activeRounds, socketIdMappings,
    watchers,
  });
  if (existed) console.log(`🧹 Room ${roomCode} closed: ${reason}`);
  return existed;
};

/**
 * When this room was last worth keeping alive.
 *
 * Anyone still connected means "right now" — sitting between rounds is not
 * idleness. Otherwise it is the most recent departure across EVERY player, not
 * just the host, so the clock only runs once the whole table has gone.
 */
const roomLastActiveAt = (room) => {
  if (!room) return 0;
  const players = room.players || [];
  if (players.some((p) => !p.disconnected)) return Date.now();
  const departures = players.map((p) => p.disconnectedAt || 0).filter(Boolean);
  if (departures.length) return Math.max(...departures);
  // Nobody in the roster at all: everyone used Leave rather than dropping.
  return room.emptiedAt || room.createdAt || 0;
};

/** The one thing that closes rooms. */
const reapIdleRooms = () => {
  const now = Date.now();
  Object.keys(rooms).forEach((roomCode) => {
    const idleFor = now - roomLastActiveAt(rooms[roomCode]);
    if (idleFor >= ROOM_IDLE_TIMEOUT_MS) {
      destroyRoom(roomCode, `nobody active for ${Math.round(idleFor / 60000)} minutes`);
    }
  });
};

const roomReaper = setInterval(reapIdleRooms, ROOM_REAP_INTERVAL_MS);
if (roomReaper.unref) roomReaper.unref();

/**
 * Note that a room now has nobody in its roster. It is NOT closed here; the
 * reaper closes it once the idle window has passed with nobody back.
 */
const markRoomEmpty = (roomCode) => {
  const room = rooms[roomCode];
  if (!room) return;
  room.emptiedAt = Date.now();
  console.log(`Room ${roomCode} is empty. Holding it for ${ROOM_IDLE_TIMEOUT_MS}ms in case anyone comes back.`);
};

/**
 * Move the whistle to somebody who is actually here.
 * @returns {string|null} the new host id, or null if nobody is left to take it
 */
const handOverWhistle = (roomCode, message) => {
  const room = rooms[roomCode];
  if (!room) return null;
  const stillHere = activePlayers(room);
  if (stillHere.length === 0) return null;
  room.host = stillHere[0].id;
  io.to(roomCode).emit('newHost', { newHostId: room.host, message });
  console.log(`🏈 Whistle moved to ${stillHere[0].name} (${room.host}) in room ${roomCode}: ${message}`);
  return room.host;
};


/**
 * Give the whistle back to whoever created the room, when they come back.
 *
 * Three rules, and the distinction between them is the whole feature:
 *
 *  - The whistle moved because they DROPPED (disconnect, dead phone, closed
 *    tab). Coming back restores it. That is what this is for.
 *  - The whistle moved because they HANDED IT OVER. That was a decision, and a
 *    reconnect must not undo it, so `assignNewHost` clears the claim.
 *  - They LEFT on purpose. They chose to go, so leaving clears the claim too
 *    and rejoining makes them an ordinary player.
 *
 * It also must not fight the Session 13 rule that the first person back to an
 * abandoned game becomes Ref: if somebody else got there first they hold the
 * whistle until the original host actually returns, which is exactly what this
 * does — nothing happens until that name reconnects.
 *
 * Never mid-round. Taking the whistle out of a stand-in's hands while a round
 * is live would strand the table, so a restore that lands during a round is
 * parked on the room and applied at the next clean moment.
 */
const restoreOriginalHostIfDue = (roomCode, socketId, playerName) => {
  const room = rooms[roomCode];
  if (!room || !room.originalHostName) return false;
  if (room.originalHostName !== playerName) return false;
  if (room.host === socketId) return false;          // already holding it

  if (room.isActionInProgress) {
    // Park it. `finishPendingHostRestore` picks this up at round end.
    room.pendingHostRestoreId = socketId;
    console.log(`🏈 ${playerName} is back in ${roomCode}; whistle returns at the end of this round`);
    return false;
  }

  room.host = socketId;
  room.pendingHostRestoreId = null;
  io.to(roomCode).emit('newHost', {
    newHostId: socketId,
    message: `${playerName} is back. The whistle returns to them.`,
  });
  console.log(`🏈 Whistle restored to original host ${playerName} (${socketId}) in room ${roomCode}`);
  return true;
};

/** Apply a whistle restore that had to wait for a round to finish. */
const finishPendingHostRestore = (roomCode) => {
  const room = rooms[roomCode];
  if (!room || !room.pendingHostRestoreId) return;
  const id = room.pendingHostRestoreId;
  room.pendingHostRestoreId = null;
  // They may have dropped again while the round ran.
  const player = room.players.find((p) => p.id === id && !p.disconnected);
  if (!player || room.host === id) return;
  room.host = id;
  io.to(roomCode).emit('newHost', {
    newHostId: id,
    message: `${player.name} is back. The whistle returns to them.`,
  });
  console.log(`🏈 Whistle restored to original host ${player.name} (${id}) in room ${roomCode} after the round`);
};

/**
 * The host gave the whistle away, or walked. Either way the claim is spent.
 * Called from `assignNewHost`, `leaveGame` and `leaveRoom`.
 */
const clearOriginalHostClaim = (roomCode, why) => {
  const room = rooms[roomCode];
  if (!room || !room.originalHostName) return;
  console.log(`🏈 ${roomCode}: original-host claim by ${room.originalHostName} cleared (${why})`);
  room.originalHostName = null;
  room.pendingHostRestoreId = null;
};

// Enable CORS for all routes
app.use(cors());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'client/build')));

// Define a route for the root path to serve the React app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'), (err) => {
      if (err) {
          console.error('Error serving index.html:', err);
          res.status(err.status).end();
      }
  });
});

// Catch-all handler: for any request that doesn't match above, send back the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'), (err) => {
      if (err) {
          console.error('Error serving catch-all route:', err);
          res.status(err.status).end();
      }
  });
});

// Generate random room code
const generateRoomCode = () => {
  // Generate a 5-digit number only room code
  return Math.floor(10000 + Math.random() * 90000).toString();
};

// How many times to try for a free room code before giving up. There are 90,000
// 5-digit codes, so 50 consecutive collisions means the space is genuinely
// close to full: with even half of it in use the odds are (1/2)^50, about one
// in a quadrillion. Anything short of that returns on the first or second try.
const ROOM_CODE_ATTEMPTS = 50;

/**
 * Find a room code not already in use, or null if the space is full.
 *
 * The cap is the point. This used to be `while (rooms[roomCode])` with no
 * bound, and on a single-threaded server that does not fail slowly — it pins
 * the event loop and freezes every game on the box at once, which is the same
 * blast radius as the crash bug this branch started out fixing.
 */
const allocateRoomCode = (rooms) => {
  for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
    const roomCode = generateRoomCode();
    if (!rooms[roomCode]) return roomCode;
  }
  return null;
};

/**
 * ── Live game tracking ────────────────────────────────────────────────────
 *
 * One poller per GAME, shared by every room watching it, refcounted by
 * `watchers`. Registered with `purgeRoomState` above, so a room the reaper
 * closes takes its subscription down with it.
 *
 * ⚠️ NOTHING HERE DECLARES A CARD THIS SESSION. Detections are queued, held for
 * the broadcast delay, and then broadcast to the room as "this is what I would
 * have called". Phase 3 swaps that one call for the Ref's own declaration path.
 */
/**
 * A room's per-card override, falling back to the shipped tiering.
 *
 * The dial the owner tunes after a real game night, so moving a card between
 * modes must never need a code change.
 */
const modeOf = (room, cardId) => {
  const override = room && room.cardModes ? room.cardModes[cardId] : undefined;
  return override || modeFor(cardId);
};

/**
 * Dev-only: list a PAST day's games instead of today's.
 *
 * There is no live football most of the week, so the picker is empty most of the
 * week — which makes it impossible to look at, screenshot or demo. Setting
 * `FEED_DEMO_DATE=20251109` on the server points the scoreboard at a real 2025
 * Sunday: real endpoint, real response shapes, real teams and scores, just not
 * today.
 *
 * It is read from the SERVER's environment, never from the client, so a browser
 * cannot ask for a different day and production cannot drift into one by
 * accident. Unset — which is how production runs — this is inert and the client
 * gets today.
 */
const demoDate = (value) => (/^\d{8}$/.test(value || '') ? value : null);

/**
 * Per league, because they do not play on the same day: an NFL Sunday and a
 * college Saturday are different dates, and pointing both at one of them shows
 * an empty list for the other.
 */
const FEED_DEMO_DATES = {
  'nfl': demoDate(process.env.FEED_DEMO_DATE_NFL) || demoDate(process.env.FEED_DEMO_DATE),
  'college-football': demoDate(process.env.FEED_DEMO_DATE_COLLEGE) || demoDate(process.env.FEED_DEMO_DATE),
};
const FEED_DEMO_DATE = FEED_DEMO_DATES.nfl || FEED_DEMO_DATES['college-football'];
if (FEED_DEMO_DATE) {
  console.log(`🏈 game picker is in DEMO mode: nfl=${FEED_DEMO_DATES.nfl || 'today'}, `
    + `college=${FEED_DEMO_DATES['college-football'] || 'today'}`);
}

/**
 * The two team abbreviations for a live game, for the header.
 *
 * One request, best effort: if it fails the header simply has no names, which
 * is a cosmetic loss and must never stop a game being watched.
 */
const teamsForGame = async (league, gameId) => {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary?event=${gameId}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const body = await res.json();
    const competitors = body?.header?.competitions?.[0]?.competitors || [];
    const side = (which) => (competitors.find((c) => c.homeAway === which) || {}).team?.abbreviation || null;
    return { home: side('home'), away: side('away') };
  } catch {
    return null;
  }
};

const watchers = new Watchers({
  createFeed: ({ league, gameId, entry, replayFixture, speed }) => {
    // A fixture turns the whole feature into something runnable on a Tuesday.
    const feed = replayFixture
      ? new ReplayFeed(replayFixture, { speed: speed || 1 })
      : new LiveFeed({ league, gameId });

    // Name the teams. A replay carries them; a live game is asked once, and a
    // failure there costs the header its labels and nothing else.
    if (replayFixture && Array.isArray(replayFixture.teams)) {
      const side = (which) => (replayFixture.teams.find((t) => t.homeAway === which) || {}).abbreviation;
      entry.state.home = side('home') || null;
      entry.state.away = side('away') || null;
    } else {
      teamsForGame(league, gameId).then((teams) => {
        if (!teams) return;
        entry.state.home = teams.home;
        entry.state.away = teams.away;
        for (const roomCode of entry.rooms) {
          io.to(roomCode).emit('gameFeedUpdate', { league, gameId: entry.gameId, ...entry.state });
        }
      }).catch(() => {});
    }

    const tell = (event, payload) => {
      for (const roomCode of entry.rooms) io.to(roomCode).emit(event, payload);
    };

    const pipeline = runPipeline(feed, {
      onState: (state) => {
        entry.state = { ...entry.state, ...state };
        tell('gameFeedUpdate', { league, gameId: entry.gameId, ...entry.state });
      },
      onDetected: (detections, play) => {
        entry.stats.detected += detections.length;
        for (const d of detections) {
          // Diagnosable on Monday: the raw play id is in every line.
          console.log(`🏈 ${league}/${entry.gameId} detected ${d.cardId} (${d.mode}) from play ${d.playId}: ${d.reason}`);
          // Suggest-or-not is a PER-ROOM decision, because the dial is. Reading
          // the global default here made the dial's middle setting a no-op: a
          // card whose default is auto was skipped at release time (which reads
          // the room) and never suggested either, so "suggest" silently meant
          // "off" — for most of Tier A. It must also be `=== SUGGEST` and not
          // `!== AUTO`, or every card the Ref switched OFF becomes a prompt.
          let suggestedAnywhere = false;
          // Ref only — the room does not see a suggestion until it is taken.
          for (const roomCode of entry.rooms) {
            const room = rooms[roomCode];
            if (!room || !room.host) continue;
            if (modeOf(room, d.cardId) !== SUGGEST) continue;
            suggestedAnywhere = true;
            io.to(room.host).emit('playSuggested', {
              league, gameId: entry.gameId, cardId: d.cardId, reason: d.reason,
              playId: d.playId, period: play ? play.period : null,
            });
          }
          // Counted per detection, not per room: the Ref is shown how much the
          // feed spotted, and two rooms watching does not make it twice.
          if (suggestedAnywhere) entry.stats.suggested += 1;
        }
      },
      onRelease: (detection) => {
        // Every room watching this game gets the round, through the SAME path a
        // Ref uses. If the Ref has paused auto-calling, the detection is simply
        // dropped rather than held — it will be stale by the time they unpause.
        //
        // Returning false asks the pipeline to re-offer this one shortly. That
        // happens only when a room wanted the card and was mid-round: busy is
        // temporary and worth a few seconds' patience, whereas "nobody holds
        // it" and "the card is switched off" never become true by waiting.
        let firedAnywhere = false;
        let busyAnywhere = false;
        for (const roomCode of entry.rooms) {
          const room = rooms[roomCode];
          if (!room) continue;
          if (room.autoCallPaused) {
            io.to(roomCode).emit('playSkipped', {
              league, gameId: entry.gameId, cardId: detection.cardId, reason: 'auto-calling is paused',
            });
            continue;
          }
          if (modeOf(room, detection.cardId) !== AUTO) continue;

          const path = pathFor(detection.cardId);
          const result = path === 'firstDown' ? declareFirstDown(roomCode)
            : path === 'standard' ? declareStandardCard(roomCode, detection.cardId)
              : declareWildCard(roomCode, detection.cardId);

          if (result.ok) {
            firedAnywhere = true;
            entry.stats.released += 1;
            // Prefer ESPN's human summary of the play; the detector's reason is a
            // fallback and reads like a type name.
            tellRoundSource(roomCode, 'feed', detection.cardId, detection.summary || detection.reason);
            io.to(roomCode).emit('playAutoCalled', {
              league, gameId: entry.gameId,
              cardId: detection.cardId, playId: detection.playId, reason: detection.reason,
              declared: true,
            });
            console.log(`🏈 ${league}/${entry.gameId} CALLED ${detection.cardId} in ${roomCode} (play ${detection.playId})`);
          } else {
            // Busy or nobody held it. Not an error — the round the Ref or an
            // earlier detection started simply won, which is the correct
            // outcome of the single-round guard.
            if (result.reason === 'busy') {
              // Do not tell the room yet. It may well fire in a moment, and a
              // "skipped" line followed by the round itself reads as a bug.
              busyAnywhere = true;
              continue;
            }
            entry.stats.skipped = (entry.stats.skipped || 0) + 1;
            io.to(roomCode).emit('playSkipped', {
              league, gameId: entry.gameId, cardId: detection.cardId, reason: result.reason,
            });
            console.log(`🏈 ${league}/${entry.gameId} skipped ${detection.cardId} in ${roomCode}: ${result.reason}`);
          }
        }
        // Only ask for a retry if waiting could actually change the outcome.
        if (!firedAnywhere && busyAnywhere) return false;
        return true;
      },
      onEnd: (info) => {
        // Drain rather than fire late. Whatever is still queued belongs to a
        // game that has stopped; releasing it minutes later is worse than
        // losing it.
        const dropped = entry.queueRef ? entry.queueRef.clear('the feed ended').dropped : 0;
        tell('gameFeedEnded', {
          league, gameId: entry.gameId,
          reason: info ? info.reason : null,
          dropped,
        });
        console.log(`🏈 ${league}/${entry.gameId} feed ended (${info ? info.reason : '?'}), dropped ${dropped} queued`);

        // Then let go of the room — but not mid-round. A round the feed started
        // is a round people are drinking to; cutting it off at the final
        // whistle would strand them. Wait for it to finish, then detach.
        const roomsToRelease = [...entry.rooms];
        const detachWhenIdle = () => {
          const stillPlaying = roomsToRelease.filter((code) => {
            const room = rooms[code];
            return room && room.isActionInProgress;
          });
          if (stillPlaying.length) {
            setTimeout(detachWhenIdle, 1000).unref?.();
            return;
          }
          for (const code of roomsToRelease) {
            const room = rooms[code];
            if (!room) continue;
            room.watching = null;
            room.autoCallPaused = false;
            watchers.release(code);
            io.to(code).emit('gameDetached', { roomCode: code, dropped, reason: 'the game finished' });
            console.log(`🏈 room ${code} detached: the game finished`);
          }
        };
        setTimeout(detachWhenIdle, 1000).unref?.();
      },
    });

    // Held so detaching, the game going final, or the feed dying can DRAIN the
    // queue rather than letting it fire into a room minutes later.
    entry.queueRef = pipeline.queue;

    feed.start();
    return feed;
  },
});

/** Stop every poller when the process goes down, so nothing outlives it. */
process.on('SIGTERM', () => watchers.stopAll('server shutting down'));

/** The disconnected-player snapshots belonging to ONE room. */
const formerPlayersIn = (roomCode) => formerPlayers[roomCode] || {};

/** Remember a player who has just left this room. */
const rememberFormerPlayer = (roomCode, entry) => {
  if (!formerPlayers[roomCode]) formerPlayers[roomCode] = {};
  formerPlayers[roomCode][entry.name] = entry;
};

/** Forget one, once they are back. */
const forgetFormerPlayer = (roomCode, playerName) => {
  if (formerPlayers[roomCode]) delete formerPlayers[roomCode][playerName];
};

/**
 * The socket ids this room currently owns.
 *
 * `playerStats` is ONE global map keyed by socket id across every room on the
 * server, so any lookup into it by player NAME must be narrowed to this set —
 * otherwise it matches a same-named player in a completely different game. Two
 * Sunday parties both having a Mike is not exotic.
 *
 * Take this snapshot BEFORE the reconnect paths touch `room.players`: they
 * filter the old entry out (`handleJoinRoom`) or overwrite its id in place
 * (`requestGameState`), and the old id is exactly what the lookup needs.
 */
const roomSocketIds = (room) => new Set((room && room.players ? room.players : []).map(p => p.id));

/**
 * Entries in the global `playerStats` map that belong to this player name AND
 * to this room. `ownedIds` comes from `roomSocketIds`.
 */
const roomEntriesForName = (ownedIds, playerName) =>
  Object.entries(playerStats).filter(
    ([socketId, stats]) => stats.name === playerName && ownedIds.has(socketId)
  );

/**
 * Build the `updatePlayerStats.players` payload for ONE room.
 *
 * `room.players` is the authority on who is in the room — a disconnected player
 * stays in it, with their id, until they rejoin — so the payload is built from
 * it directly rather than by filtering the global map.
 *
 * This used to scan all of `playerStats` and additionally keep stale entries
 * whose name matched a current member. That match was on NAME ALONE with no
 * room association, so room B's disconnected Mike leaked into room A's payload
 * whenever room A also had a Mike. Those stale entries were also inert: they
 * were sent with `name: undefined`, and the client only keeps entries that
 * carry a name (App.js:1268). Nothing the client uses was lost by dropping them.
 */
const buildRoomStats = (room) => {
  const scoped = {};

  room.players.forEach(player => {
    const stats = playerStats[player.id];
    if (!stats) return;

    scoped[player.id] = {
      ...stats,
      name: player.name,
      // Left exactly as `player.disconnected` — including `undefined` for a
      // player who has never dropped — so the wire payload is unchanged.
      disconnected: player.disconnected
    };
  });

  return scoped;
};

/**
 * The wild-card swap allowance: ONE swap per player per quarter.
 *
 * Lives on the room as `room.wildSwapQuarter = { [playerName]: quarterNumber }`.
 * Two deliberate choices:
 *
 *  - Keyed by player NAME, not socket id. Socket ids change on every reconnect,
 *    so a socket-keyed allowance would hand a free reroll to anyone who drops
 *    and rejoins — which is the exact exploit this guard exists to close, and a
 *    client can reconnect at will. Names are unique among a room's active
 *    players (`handleJoinRoom` refuses a duplicate) and the reconnection
 *    machinery already treats name as identity (`formerPlayers` is keyed by it).
 *  - Stores the quarter the swap was spent in rather than a boolean, so the
 *    allowance resets the moment `room.quarter` advances, with no bookkeeping
 *    to forget.
 */
const currentQuarter = (room) => room.quarter || 1;

const hasSpentSwapThisQuarter = (room, playerName) =>
  Boolean(room.wildSwapQuarter) && room.wildSwapQuarter[playerName] === currentQuarter(room);

const recordSwap = (room, playerName) => {
  if (!room.wildSwapQuarter) room.wildSwapQuarter = {};
  room.wildSwapQuarter[playerName] = currentQuarter(room);
};

/**
 * Record what a player was told to pour this round, so a reconnect can replay it.
 *
 * Keyed by player NAME, not socket id, for the same reason as the swap
 * allowance: the id changes on every reconnect and the name does not.
 *
 * This exists because the prompt CANNOT be re-derived from the player's hand.
 * `playStandardCard` and `wildCardConfirmed` emit `distributeDrinks` and then
 * immediately remove the played cards and draw replacements, so by the time
 * anyone reconnects the hand no longer shows what they played. The old
 * reconnect code filtered the current hand anyway, which meant a refreshing
 * player either got nothing (usually) or — if the replacement draw happened to
 * redeal the same card type — a prompt for an amount they never played.
 */
const rememberPendingPour = (roomCode, playerName, payload) => {
  const round = activeRounds[roomCode];
  if (!round || !playerName) return;
  if (!round.pending) round.pending = {};
  round.pending[playerName] = payload;
};

/**
 * Is this player finished with the round?
 *
 * ⚠️ POURING EVERYTHING IS NOT BEING DONE. Session 12 treated a zero balance as
 * finished, and that was wrong: the round ended the instant the last drink
 * landed. Pouring is not a statement that you have finished — people pour, look
 * at the board, change their mind and undo. Session 11 exists precisely so undo
 * works for the whole round, and ending on the last pour takes that away and
 * makes the round feel snatched.
 *
 * Finished means:
 *   - they were never asked to pour (hold no copy of the declared card) —
 *     automatic, they have no action and must not have to press anything; or
 *   - they explicitly locked in.
 *
 * A pending entry exists only for players who were told to pour, so its mere
 * presence is what distinguishes "had something to do" from "had nothing".
 */
const playerIsDoneThisRound = (roomCode, playerName) => {
  const round = activeRounds[roomCode];
  if (!round) return true;
  if ((round.lockedIn || {})[playerName]) return true;
  // Asked to pour at all? Then only Lock In finishes them.
  return !(round.pending || {})[playerName];
};

/** Has this player already declared themselves done for this round? */
const playerHasLockedIn = (roomCode, playerName) =>
  Boolean(((activeRounds[roomCode] || {}).lockedIn || {})[playerName]);

/**
 * End the round the moment there is nothing left to wait for.
 *
 * Owner request: if everyone has locked in — or has nothing to give — the round
 * should not wait out the clock.
 *
 * FIRST DOWN IS EXCLUDED. Nobody owes anything on a First Down, so the rule
 * below is satisfied the instant the round opens and it would finalize before
 * anybody read it. It is a six-second "everyone drinks" beat whose whole value
 * is the display time, so it always runs its full duration.
 *
 * DISCONNECTED PLAYERS ARE SKIPPED. Somebody whose phone died must not hold
 * nine people hostage for 21 seconds. Their debt lapses exactly as it does when
 * the clock runs out today.
 */
const maybeFinishRoundEarly = (roomCode) => {
  const round = activeRounds[roomCode];
  const room = rooms[roomCode];
  if (!round || !room || round.finalized) return false;
  if (round.declaredCard === 'First Down') return false;

  const here = activePlayers(room);
  if (here.length === 0) return false;
  if (!here.every(p => playerIsDoneThisRound(roomCode, p.name))) return false;

  console.log(`⏱️ Room ${roomCode}: everyone is done — ending the round early`);
  // Clear the countdown, or it fires into the next round.
  if (round.intervalId) clearInterval(round.intervalId);
  finalizeRound(roomCode);
  return true;
};

/** What this player still owes this round, or null if nothing is outstanding. */
const pendingPourFor = (roomCode, playerName) => {
  const round = activeRounds[roomCode];
  if (!round || !round.pending) return null;
  const owed = round.pending[playerName];
  if (!owed) return null;
  if ((owed.drinkCount || 0) <= 0 && (owed.shotguns || 0) <= 0) return null;
  return owed;
};

/**
 * Settle part of what a player owes.
 *
 * `pending` means WHAT YOU STILL OWE, not what you were originally told. It was
 * written once when the card was played and never touched again, while the
 * running count of what had actually been poured lived only in the browser —
 * so a refresh mid-pour made the server replay the ORIGINAL amount and a
 * 4-drink card could be poured six times.
 *
 * Negative amounts are undo, and add back. Nothing is allowed below zero: the
 * shotgun fold and undo both round-trip through here and a stray negative
 * would make `pendingPourFor` think the debt was settled.
 */
const settlePendingPour = (roomCode, playerName, drinks, shotguns) => {
  const owed = (activeRounds[roomCode] || {}).pending?.[playerName];
  if (!owed) return;
  owed.drinkCount = Math.max(0, (owed.drinkCount || 0) - (drinks || 0));
  owed.shotguns = Math.max(0, (owed.shotguns || 0) - (shotguns || 0));
  console.log(`🧾 ${playerName} now owes ${owed.drinkCount} drinks, ${owed.shotguns} shotguns this round`);
};

/**
 * The players who are actually here.
 *
 * Disconnected players stay in `room.players` (with `disconnected: true`) so
 * their drinks survive a dropped phone. That means every "pick a player"
 * lookup has to say whether it wants an ACTIVE one — and the ones that decide
 * who holds the whistle always do. A Ref who is not in the building stops the
 * game dead, because only the Ref can declare.
 */
const activePlayers = (room) =>
  (room && room.players ? room.players : []).filter(p => !p.disconnected);

/**
 * Make sure a live game has a Ref, and that it is somebody who is here.
 *
 * When the host disconnects, an active player is promoted — unless there are
 * none, in which case the old code emitted `gameOver` and left `room.host`
 * pointing at a dead socket id. The room is deliberately kept alive for
 * reconnections, so the first person back found a live game with no Ref, no
 * way to declare, and no way out.
 *
 * Owner's rule: if the game is still active, the first player to rejoin
 * becomes the Ref. Called on BOTH rejoin paths, since they are genuinely
 * different routes (see the T1.1 room-join fix).
 *
 * @returns {boolean} whether the whistle was handed over
 */
const ensureRefIsPresent = (roomCode, candidate) => {
  const room = rooms[roomCode];
  if (!room || !room.gameStarted || !candidate) return false;

  const refIsHere = room.players.some(p => p.id === room.host && !p.disconnected);
  if (refIsHere) return false;

  room.host = candidate.id;
  io.to(roomCode).emit('newHost', {
    newHostId: room.host,
    message: `${candidate.name} is the Ref.`,
  });
  console.log(`🏈 Room ${roomCode} had no Ref present — ${candidate.name} takes the whistle`);
  return true;
};

/**
 * Table size.
 *
 * The printed box promises "3-10 PLAYERS", and until now the app enforced no
 * upper bound at all -- the only check was the minimum at `startGame`. Matching
 * the box is cheaper than explaining the gap, and 10 is also where the avatar
 * sheet stops being able to give everyone their own character.
 *
 * A disconnected player still holds their seat: they own drinks and are
 * expected back, so they count against the cap.
 */
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

/**
 * Claim the right to finalize this round. Returns false if somebody already has.
 *
 * `finalizeRound` has no idempotency guard of its own. Today that is harmless
 * only because it has exactly ONE caller — the else branch of startTimer's
 * interval. The moment a second caller exists (a round that ends early because
 * everyone has poured), there is a race: the last player settles at t=20.9
 * while the timer fires at t=21.0, the round finalizes twice, every total is
 * doubled and two results screens are broadcast.
 *
 * So this lands BEFORE the early-end path does. Checked and set synchronously,
 * on the round itself, so it dies with the round.
 */
const claimRoundFinalize = (roomCode) => {
  const round = activeRounds[roomCode];
  if (!round) return true;          // no round tracked; the timer path still owns it
  if (round.finalized) {
    console.log(`⛔ Round in ${roomCode} is already finalized — ignoring the second call`);
    return false;
  }
  round.finalized = true;
  return true;
};

// Finalize round logic
const finalizeRound = (roomCode) => {
    // Get the room from the rooms object
    const room = rooms[roomCode];  
    if (!room) {
      console.log(`Room ${roomCode} not found for finalization.`);
      return;
    }

    // Exactly once per round. See claimRoundFinalize.
    if (!claimRoundFinalize(roomCode)) return;

 
    // ✅ ROUND-AWARE: Merge round results for socket ID changes with transitive resolution
    if (socketIdMappings[roomCode] && roundResults[roomCode]) {
      console.log(`🔄 Merging round results for socket ID mappings in room ${roomCode}`);
      console.log(`🔄 Socket mappings:`, Object.entries(socketIdMappings[roomCode]).map(([old, new_]) => `${old.slice(-4)}→${new_.slice(-4)}`));
      console.log(`🔄 Round results before merge:`, Object.entries(roundResults[roomCode]).map(([id, data]) => `${id.slice(-4)}:${data.drinks}d,${data.shotguns}s`));
      
      // Build transitive mapping chains to find final socket IDs
      const finalSocketMappings = {};
      
      // For each socket ID in round results, find its final destination
      Object.keys(roundResults[roomCode]).forEach(socketId => {
        let currentId = socketId;
        const visited = new Set();
        let resolutionPath = [currentId.slice(-4)];
        
        // Follow the chain to the final socket ID
        while (socketIdMappings[roomCode][currentId] && !visited.has(currentId)) {
          visited.add(currentId);
          const nextId = socketIdMappings[roomCode][currentId];
          resolutionPath.push(nextId.slice(-4));
          currentId = nextId;
        }
        
        if (currentId !== socketId) {
          finalSocketMappings[socketId] = currentId;
          console.log(`🔗 Socket chain for results: ${resolutionPath.join(' → ')}`);
        }
      });
      
      // Merge all results to their final socket IDs
      Object.entries(finalSocketMappings).forEach(([oldSocketId, finalSocketId]) => {
        if (roundResults[roomCode][oldSocketId]) {
          const oldData = roundResults[roomCode][oldSocketId];
          
          if (!roundResults[roomCode][finalSocketId]) {
            // Simple transfer
            roundResults[roomCode][finalSocketId] = { ...oldData };
            console.log(`✅ Transferred: ${oldSocketId.slice(-4)}(${oldData.drinks}d,${oldData.shotguns}s) → ${finalSocketId.slice(-4)}`);
          } else {
            // Merge existing data
            const finalData = roundResults[roomCode][finalSocketId];
            roundResults[roomCode][finalSocketId] = {
              drinks: (finalData.drinks || 0) + (oldData.drinks || 0),
              shotguns: (finalData.shotguns || 0) + (oldData.shotguns || 0)
            };
            console.log(`✅ Merged: ${oldSocketId.slice(-4)}(${oldData.drinks}d,${oldData.shotguns}s) + ${finalSocketId.slice(-4)}(${finalData.drinks}d,${finalData.shotguns}s) = ${roundResults[roomCode][finalSocketId].drinks}d,${roundResults[roomCode][finalSocketId].shotguns}s`);
          }
          
          delete roundResults[roomCode][oldSocketId];
        }
      });
      
      console.log(`🔄 Round results after merge:`, Object.entries(roundResults[roomCode]).map(([id, data]) => `${id.slice(-4)}:${data.drinks}d,${data.shotguns}s`));
    }
    
    // Update player stats for the entire game by summing the round results
    room.players.forEach((player) => {
      const playerId = player.id;
      const roundResult = roundResults[roomCode][playerId] || { drinks: 0, shotguns: 0 };
      // (Two near-identical dumps of the same object used to print here.)


      // Update total drinks and shotguns for the player
      playerStats[playerId].totalDrinks = (playerStats[playerId].totalDrinks || 0) + roundResult.drinks;
      playerStats[playerId].totalShotguns = (playerStats[playerId].totalShotguns || 0) + roundResult.shotguns;
    // Log player stats for each player
    console.log(`Updated stats for player ${playerId}:`, playerStats[playerId]);
    });

    // ✅ ENHANCED: Include player names in stats data (scoped to this room)
    const playersWithNames = buildRoomStats(room);

    console.log(`📊 SENDING COMPLETE DATA: ${Object.keys(playersWithNames).length} players with names:`, 
      Object.entries(playersWithNames).map(([id, stats]) => `${stats.name || 'UNNAMED'}(${id.slice(-4)}): ${stats.totalDrinks} drinks`)
    );

    // Emit the final round results and updated player stats to everyone in the room
    io.to(roomCode).emit('updatePlayerStats', {
       players: playersWithNames,  // ✅ Now includes names for ALL players
       roundResults: roundResults[roomCode],  // Send combined round results
       roundFinalized: true  // ✅ NEW: Flag to indicate official round end
    });
 
    // Reset the declaredCard for all players
    io.to(roomCode).emit('declaredCard', null);  // Reset the declared card to null
 
    // ✅ ROUND-AWARE: Clear active round tracking when round ends
    if (activeRounds[roomCode]) {
      delete activeRounds[roomCode];
      console.log(`✅ Active round cleared for room ${roomCode}`);
    }
    
    // ✅ ROUND-AWARE: Clear socket ID mappings when round ends
    if (socketIdMappings[roomCode]) {
      delete socketIdMappings[roomCode];
      console.log(`✅ Socket ID mappings cleared for room ${roomCode}`);
    }
 
    // Clear round results for the next round
    roundResults[roomCode] = {};
    console.log(`Round results cleared for room ${roomCode}.`);
    room.isActionInProgress = false;
    // A clean moment. If the original host came back mid-round, this is where
    // the whistle goes home — never out of a stand-in's hands mid-round.
    finishPendingHostRestore(roomCode);

 
    // Update player hands for the next round
    room.players.forEach((player) => {
      const playerHand = playerStats[player.id];
 
      // Send updated hand back to each player
      io.to(player.id).emit('updatePlayerHand', { standard: playerHand.standard, wild: playerHand.wild });
      console.log(`New hand for player ${player.id}:`, playerHand.standard);
    });

 };
  
  // Timer logic to broadcast remaining time to all clients in a room
  const startTimer = (roomCode, duration) => {
    let timeRemaining = duration;
  
    // Send the remaining time every second
    const interval = setInterval(() => {
     try {
      if (rooms[roomCode]) {
        if (timeRemaining > 0) {
          timeRemaining--;
          io.to(roomCode).emit('updateTimer', timeRemaining);  // Emit remaining time to all clients
        } else {
          // Timer has hit zero, finalize the round
          clearInterval(interval);  // Stop the timer
          console.log('Timer hit 0, finalizing round', roomCode);
  
          // Finalize the round and send results
          finalizeRound(roomCode);  // Call the finalizeRound function when time is up
        }
      } else {
        clearInterval(interval);  // Stop the timer if the room is deleted
      }
     } catch (err) {
      // A malformed payload often detonates HERE, seconds after the emit that
      // caused it, where nothing in the log connects the two. Name the room so
      // the morning-after read is possible, and stop this room's timer rather
      // than throwing on every tick forever.
      console.error(`💥 Round timer threw for room ${roomCode} — clearing it:`);
      console.error(err && err.stack ? err.stack : err);
      clearInterval(interval);
      if (rooms[roomCode]) rooms[roomCode].isActionInProgress = false;
      finishPendingHostRestore(roomCode);
     }
    }, 1000);

    // Kept so an early end can stop the countdown rather than leaving an
    // orphaned timer to fire into the next round.
    if (activeRounds[roomCode]) activeRounds[roomCode].intervalId = interval;
  };


/** Module scope: the declaration path above calls this, and that path is now
 *  shared with the live feed rather than living inside a socket handler. */
const logPlayerHands = (roomCode) => {
  const room = rooms[roomCode];
  if (!room) return;

  console.log(`Player hands in room ${roomCode}:`);
  room.players.forEach((player) => {
    const hand = playerStats[player.id];
    if (hand && hand.standard && hand.wild) {
      console.log(`${player.name}'s hand:`);
      console.log('Standard cards:', hand.standard.map(card => card.card).join(', '));
      console.log('Wild cards:', hand.wild.map(card => card.card).join(', '));
    } else {
      console.log(`${player.name}'s hand is empty or not assigned properly.`);
    }
  });
};
/**
 * ── The declaration path ──────────────────────────────────────────────────
 *
 * Lifted verbatim out of the three socket handlers so the live feed can call
 * exactly what the Ref calls. NOT a parallel implementation: the handlers are
 * now thin wrappers around these, so if a round starts, nothing downstream can
 * tell whether a human or the feed started it — same `isActionInProgress`
 * guard, same `activeRounds` entry, same broadcasts, same `startTimer`, same
 * `finalizeRound`.
 *
 * One thing changed in the move: the busy branch returns instead of emitting,
 * because the feed has no socket to emit to. The wrapper does the emitting for
 * the Ref, so the wire is unchanged.
 *
 * @returns {{ ok: boolean, reason?: 'busy'|'noCard' }}
 */
const declareFirstDown = (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
  
    // Ensure roundResults[roomCode] is initialized
    if (!roundResults[roomCode]) {
      roundResults[roomCode] = {};
    }

    // Check if an action is already in progress
  if (room.isActionInProgress) return { ok: false, reason: 'busy' };
  room.isActionInProgress = true;

  // ✅ ROUND-AWARE: Track active round state
  activeRounds[roomCode] = {
    declaredCard: 'First Down',
    startTime: Date.now(),
    timeRemaining: ROUND_DURATIONS.firstDown
  };

  // Send the declared card to all players in the room
  io.to(roomCode).emit('declaredCard', 'First Down');  // Broadcast the first down
    
  // Add 1 drink to every player's stats
    room.players.forEach((player) => {
      const playerId = player.id;
      
      // Ensure roundResults[roomCode][playerId] is initialized
      if (!roundResults[roomCode][playerId]) {
        roundResults[roomCode][playerId] = { drinks: 0, shotguns: 0 };
      }
  
      // Increment the drinks for this round
      roundResults[roomCode][playerId].drinks += 1;
  });
  
    // Emit a message to all players that it's a First Down and they should drink once
    io.to(roomCode).emit('firstDownMessage', 'First Down! Everyone drinks once!');
    
    // ✅ ENHANCED: Include player names in First Down stats update (this room only)
    const playersWithNames = buildRoomStats(room);

    // Emit updated player stats for the round
    io.to(roomCode).emit('updatePlayerStats', {
      players: playersWithNames,  // ✅ Now includes names for ALL players
      roundResults: roundResults[roomCode],
    });
  
    console.log(`First Down - Everyone drinks once in room ${roomCode}`);

    startTimer(roomCode, ROUND_DURATIONS.firstDown);

  return { ok: true };
};

const declareStandardCard = (roomCode, cardType) => {
  let noCardResult = false;
    const room = rooms[roomCode];
    if (!room) return;

      // Check if an action is already in progress
  if (room.isActionInProgress) return { ok: false, reason: 'busy' };
  
      // Set the action as in progress
      room.isActionInProgress = true;
      console.log(`Action status ${room.isActionInProgress} `);

    console.log(`Host in room ${roomCode} has declared ${cardType}.`);

    let anyPlayerHasCard = false;
    room.players.forEach((player) => {
      const playerHand = playerStats[player.id];
      if (playerHand.standard.some(card => card.card === cardType)) {
        anyPlayerHasCard = true;
      }
    });
  
    if (!anyPlayerHasCard) {
      // If no one has the card, inform the room and reset the action status
      io.to(roomCode).emit('noCard', 'No one had this card');
      room.isActionInProgress = false;
      finishPendingHostRestore(roomCode);
      noCardResult = true;
  
      // Show the message for 5 seconds, then clear it
      setTimeout(() => {
        io.to(roomCode).emit('noCard', '');  // Clear the message
      }, 5000);
  
      return;
    }

    // ✅ ROUND-AWARE: Track active round state only once the round is really on.
    // Setting this before the "does anyone hold it" check left a phantom round
    // behind on every noCard declaration.
    activeRounds[roomCode] = {
      declaredCard: cardType,
      startTime: Date.now(),
      timeRemaining: ROUND_DURATIONS.standard
    };

     // Send the declared card to all players in the room
  io.to(roomCode).emit('declaredCard', cardType);  // Broadcast the declared card

    logPlayerHands(roomCode);

    room.players.forEach((player) => {
      const playerHand = playerStats[player.id];
      const playerCards = playerHand.standard.filter(card => card.card === cardType);

      if (playerCards.length > 0) {
        let totalDrinksForPlayer = 0;
        playerCards.forEach(card => {
          totalDrinksForPlayer += card.drinks;
        });
      
        // After calculating total drinks, check if the player has 10 or more drinks
        let shotguns = Math.floor(totalDrinksForPlayer / 10);  // Calculate how many full shotguns
        let remainingDrinks = totalDrinksForPlayer % 10;  // Remaining drinks after shotguns
      
        // Update player stats for total shotguns and drinks
        if (shotguns > 0) {
          playerStats[player.id].shotguns = (playerStats[player.id].shotguns || 0) + shotguns;
          console.log(`Player ${player.id} got ${shotguns} shotgun(s).`);
        }
      
        // Update player's drink count for the remaining drinks
        playerStats[player.id].drinks = remainingDrinks;
      
        io.to(player.id).emit('distributeDrinks', {
          playerId: player.id,
          cardType,
          drinkCount: remainingDrinks,  // Only emit the remaining drinks after shotguns
          shotguns,  // Emit the number of shotguns if any
        });

        // Remember it: the cards are about to be removed from the hand, so this
        // is the last moment the amount is knowable.
        rememberPendingPour(roomCode, player.name, {
          cardType,
          drinkCount: remainingDrinks,
          shotguns
        });

        // Store used cards before removing them
        if (!usedCards[roomCode]) usedCards[roomCode] = { standard: [], wild: [] };
        usedCards[roomCode].standard.push(...playerCards);
        
        playerHand.standard = playerHand.standard.filter(card => card.card !== cardType);
        const newCards = rooms[roomCode].deck.standardDeck.splice(0, playerCards.length);
        playerHand.standard.push(...newCards);
        console.log(`${player.id} played ${playerCards.length} ${cardType} card(s) and is prompted to give out ${totalDrinksForPlayer} drinks.`);
        
        // Check if deck needs replenishment after cards are drawn
        checkAndReplenishDecks(roomCode);

    }
    });

    startTimer(roomCode, ROUND_DURATIONS.standard);

  return noCardResult ? { ok: false, reason: 'noCard' } : { ok: true };
};

const declareWildCard = (roomCode, wildcardtype) => {
    const room = rooms[roomCode];
    if (!room) return;

    // Check if an action is already in progress
  if (room.isActionInProgress) return { ok: false, reason: 'busy' };

    // `player` used to be logged here. It was only ever decorative — the work
    // below loops over everyone holding the card — and the feed has no player
    // to name, so the declaration path does not take one.
    console.log(`Wild card declared: ${wildcardtype} in room ${roomCode}`);
    
    // Set the action as in progress
    room.isActionInProgress = true;

    // ✅ ROUND-AWARE: Track active round state for wild cards
    activeRounds[roomCode] = {
      declaredCard: wildcardtype,
      startTime: Date.now(),
      timeRemaining: ROUND_DURATIONS.wild
    };

    // Notify all players about the wild card action
    io.to(roomCode).emit('declaredCard', wildcardtype);  // Broadcast the declared card
    console.log(`Broadcast declared card ${wildcardtype} to all players`);

    // Loop through each player in the room
    room.players.forEach((currentPlayer) => {
        const playerHand = playerStats[currentPlayer.id];
        if (!playerHand) {
            console.log(`Player hand not found for player: ${currentPlayer.id}`);
            return;
        }
        
        const playerCards = playerHand.wild.filter(card => card.card === wildcardtype);
        console.log(`Checking player ${currentPlayer.id} for wild card ${wildcardtype}`);

        if (playerCards.length > 0) {
            let totalDrinksForPlayer = 0;
            
            playerCards.forEach(card => {
              totalDrinksForPlayer += card.drinks;
              console.log(`Player ${currentPlayer.id} has a wild card: ${wildcardtype} with ${totalDrinksForPlayer} total drinks`);
            });
          
            // After calculating total drinks, check if the player has 10 or more drinks
            let shotguns = Math.floor(totalDrinksForPlayer / 10);  // Calculate how many full shotguns
            let remainingDrinks = totalDrinksForPlayer % 10;  // Remaining drinks after shotguns
          
            // Update player's total shotguns and remaining drinks
            if (shotguns > 0) {
              playerStats[currentPlayer.id].shotguns = (playerStats[currentPlayer.id].shotguns || 0) + shotguns;
              console.log(`Player ${currentPlayer.id} can give out ${shotguns} shotgun(s) from wild card.`);
            }
          
            // Update player's drink count for the remaining drinks
            playerStats[currentPlayer.id].drinks = remainingDrinks;
          
            // Emit the remaining drinks and shotguns to the player
            io.to(currentPlayer.id).emit('distributeDrinks', {
              playerId: currentPlayer.id,
              wildcardtype,
              drinkCount: remainingDrinks,  // Send remaining drinks after shotguns
              shotguns,  // Send number of shotguns if any
            });

            // Same as the standard path: record before the hand changes.
            rememberPendingPour(roomCode, currentPlayer.name, {
              wildcardtype,
              drinkCount: remainingDrinks,
              shotguns
            });
          
            // Store used wild cards before removing them
            if (!usedCards[roomCode]) usedCards[roomCode] = { standard: [], wild: [] };
            usedCards[roomCode].wild.push(...playerCards);
            
            // Update player hand by removing played wild cards and replenishing them
            playerHand.wild = playerHand.wild.filter(card => card.card !== wildcardtype);
            const newCards = rooms[roomCode].deck.wildDeck.splice(0, playerCards.length);
            playerHand.wild.push(...newCards);
          
            console.log(`${currentPlayer.id} played ${playerCards.length} ${wildcardtype} wild card(s) and is prompted to give out ${remainingDrinks} drinks and gives out ${shotguns} shotgun(s).`);
            
            // Check if deck needs replenishment after cards are drawn
            checkAndReplenishDecks(roomCode);
          }

            else {
            console.log(`Player ${currentPlayer.id} does not have the wild card ${wildcardtype}`);
        }
    });

    console.log(`Starting timer for wild card action in room ${roomCode}`);
    startTimer(roomCode, ROUND_DURATIONS.wild);
  return { ok: true };
};

const BUSY_MESSAGE = 'Action is in progress. Please wait until the round ends.';

/**
 * Say WHO started the round.
 *
 * `declaredCard` is a bare card name and cannot carry this without changing a
 * payload shape the client contract depends on, so attribution rides alongside
 * it. Emitted immediately after a successful declaration, in the same tick, so
 * it arrives in the same batch as `declaredCard`.
 *
 * Without it every automatic round reads as "THE REF DECLARED", which
 * misattributes the call and hides the whole feature from everyone who is not
 * holding the whistle.
 */
const tellRoundSource = (roomCode, by, cardId, reason = null) => {
  io.to(roomCode).emit('roundSource', { by, cardId, reason });
};

/**
 * The Ref just declared something by hand.
 *
 * A manual declaration always wins: anything the feed had queued for this
 * moment is dropped rather than stacked behind it, because by the time the
 * round the Ref started has finished, the queued play is old news.
 */
const refTookOver = (roomCode) => {
  const entry = watchers.forRoom(roomCode);
  if (!entry || !entry.queueRef) return;
  const { dropped } = entry.queueRef.clear('the Ref declared by hand');
  if (dropped > 0) {
    console.log(`🏈 Ref declared in ${roomCode}; dropped ${dropped} queued detection(s)`);
    io.to(roomCode).emit('queueCleared', { dropped, reason: 'the Ref called it' });
  }
};

  // connection logs 

  // Add this to your server.js file in the io.on('connection') section
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id} with transport: ${socket.conn.transport.name}`);
  
  // Set up a heartbeat mechanism to detect disconnected clients
  let heartbeatInterval;
  
  const startHeartbeat = () => {
    // Clear any existing interval
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    // Start a new interval
    heartbeatInterval = setInterval(() => {
      // This emit will be used to keep the connection alive
      socket.emit('heartbeat', { timestamp: Date.now() });
    }, 10000); // Send a heartbeat every 10 seconds (optimized for mobile)
  };
  
  // Start the heartbeat when a client connects
  startHeartbeat();
  
  // Handle heartbeat acknowledgement.
  //
  // Deliberately silent. This used to log a line per socket per 10 seconds,
  // forever, including an idle lobby — which is most of what a night's log
  // was. The listener stays so the event is consumed rather than falling
  // through to socket.io's unhandled path.
  socket.on('heartbeat-ack', () => {});
  
  // Clean up the interval when the socket disconnects
  socket.on('disconnect', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  });
  
    // Log errors
    socket.on('error', (error) => {
      console.error(`Error from socket ${socket.id}:`, error);
    });
  
    // Log disconnects and reasons
    socket.on('disconnect', (reason) => {
      console.log(`User disconnected: ${socket.id}. Reason: ${reason}`);
    });
  
    // Log reconnect attempts
    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Reconnect attempt ${attemptNumber} for socket ${socket.id}`);
    });
  
    // Log successful reconnections
    socket.on('reconnect', (attemptNumber) => {
      console.log(`User reconnected: ${socket.id} after ${attemptNumber} attempts`);
    });
  
    // Log failed reconnection attempts
    socket.on('reconnect_failed', () => {
      console.log(`Reconnection failed for socket ${socket.id}`);
    });
  });

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Create Room
  socket.on('createRoom', (playerName) => {
    // Find a free code. Without this, a collision silently overwrites a live
    // room and drops two groups into the same game.
    const roomCode = allocateRoomCode(rooms);
    if (!roomCode) {
      // Reuse the existing `error` event rather than inventing a new one: the
      // client already renders it, and the player is still sitting on the
      // screen they pressed the button from.
      console.error(`Could not allocate a free room code after ${ROOM_CODE_ATTEMPTS} attempts (${Object.keys(rooms).length} rooms open). Refusing to create a room for ${playerName}.`);
      io.to(socket.id).emit('error', 'Could not create a game right now. Please try again.');
      return;
    }
    // `originalHostName` is the whistle's home. By NAME, not socket id: ids
    // change on every reconnect, and the point of this is to survive one. It
    // is a CLAIM, not a permanent right — it is cleared the moment the host
    // gives the whistle away deliberately or leaves on purpose, so a reconnect
    // can never undo a choice somebody made. See restoreOriginalHostIfDue.
    rooms[roomCode] = { players: [{ id: socket.id, name: playerName }], host: socket.id,   isActionInProgress: false, wildSwapQuarter: {}, createdAt: Date.now(), originalHostName: playerName };
    playerStats[socket.id] = { drinks: 0, shotguns: 0, standard: [], wild: [] };  // Initialize player stats and hand
    usedCards[roomCode] = { standard: [], wild: [] };  // Initialize used cards storage for deck replenishment
        socket.join(roomCode);
    console.log(`Room ${roomCode} created by ${socket.id}`);
    io.to(socket.id).emit('roomCreated', roomCode);
    rooms[roomCode].players = deduplicatePlayers(rooms[roomCode].players);
    io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
  });

 // Validate and Join Room (for automatic reconnection)
socket.on('validateAndJoinRoom', (roomCode, playerName) => {
  console.log(`Validating room ${roomCode} for player ${playerName}`);
  
  // Check if room exists
  if (!rooms[roomCode]) {
    console.log(`Room ${roomCode} not found`);
    socket.emit('roomNotFound', { roomCode, message: 'Game room not found' });
    return;
  }
  
  // Room exists, proceed with joining
  console.log(`Room ${roomCode} found, proceeding with join for ${playerName}`);
  
  // Call the existing joinRoom logic
  handleJoinRoom(socket, roomCode, playerName);
});

// ✅ UTILITY: Deduplicate players array to prevent duplicate player icons
function deduplicatePlayers(players) {
  const unique = players.reduce((acc, player) => {
    const existingIndex = acc.findIndex(p => p.id === player.id);
    if (existingIndex === -1) {
      acc.push(player);
    } else {
      // Keep the player with more complete data
      if (player.name && !acc[existingIndex].name) {
        acc[existingIndex] = player;
      }
    }
    return acc;
  }, []);
  
  if (unique.length !== players.length) {
    console.log(`🔧 DEDUP: Removed ${players.length - unique.length} duplicate players`);
  }
  
  return unique;
}

// ✅ SIMPLIFIED: Join Room or game (clean reconnection logic)
function handleJoinRoom(socket, roomCode, playerName) {
  if (!rooms[roomCode]) {
    console.log(`❌ Room ${roomCode} not found`);
    socket.emit('error', 'Room not found');
    return;
  }

  console.log(`🎯 Player ${playerName} attempting to join room ${roomCode}`);

  // Snapshot the room's socket ids up front. Every name lookup into the global
  // `playerStats` map below is narrowed to these, so a same-named player in a
  // different game can never be mistaken for this one. It has to be taken here:
  // the reconnect path filters this player's old entry out of `room.players`
  // before the merge runs, and the old id is what the merge is looking for.
  const ownedSocketIds = roomSocketIds(rooms[roomCode]);

  // Check if this socket is already in the room to prevent duplicates
  const socketAlreadyInRoom = rooms[roomCode].players.find(p => p.id === socket.id);
  if (socketAlreadyInRoom) {
    console.log(`Socket ${socket.id} is already in room ${roomCode}, ignoring duplicate join request`);
    return;
  }

  // ✅ SIMPLE RECONNECTION: is this player one of THIS room's former players?
  // The room check used to be a field comparison on a globally-keyed entry.
  // It is now the lookup itself.
  console.log(`🔍 DEBUG: Former players in room ${roomCode}:`, Object.keys(formerPlayersIn(roomCode)));
  
  const formerPlayer = formerPlayersIn(roomCode)[playerName];
  if (formerPlayer) {
    console.log(`🔄 RECONNECTING: ${playerName} found in formerPlayers for room ${roomCode}`);
    
    // ✅ FIX: Remove any existing player entries with same name before adding
    rooms[roomCode].players = rooms[roomCode].players.filter(p => p.name !== playerName);
    
    // Restore player to active players list
    const restoredPlayer = { id: socket.id, name: playerName, disconnected: false };
    rooms[roomCode].players.push(restoredPlayer);
    console.log(`🔄 Removed old entries and added player ${playerName} with new socket ${socket.id}`);
    
    // ✅ ROUND-AWARE RECONNECTION: Handle mid-round reconnection specially
    if (activeRounds[roomCode]) {
      console.log(`🎯 MID-ROUND RECONNECTION: Player ${playerName} reconnecting during active round`);
      console.log(`🎯 Active round info:`, activeRounds[roomCode]);
      
      // Find the player's old socket ID from their disconnected entry, within
      // this room only — a disconnected same-named player in another game would
      // otherwise be adopted as this player's previous identity.
      const oldEntry = roomEntriesForName(ownedSocketIds, playerName)
        .find(([, stats]) => stats.disconnected);
      
      if (oldEntry) {
        const oldSocketId = oldEntry[0];
        console.log(`🎯 Found old socket ID for ${playerName}: ${oldSocketId.slice(-4)}`);
        
        // ✅ CRITICAL: Track socket ID mapping for round results preservation
        if (!socketIdMappings[roomCode]) {
          socketIdMappings[roomCode] = {};
        }
        socketIdMappings[roomCode][oldSocketId] = socket.id;
        console.log(`🎯 Created socket mapping: ${oldSocketId.slice(-4)} → ${socket.id.slice(-4)}`);
        
        // ✅ ISSUE 2 FIX: Send current declared card to reconnecting player
        socket.emit('declaredCard', activeRounds[roomCode].declaredCard);
        console.log(`🎯 Sent declared card "${activeRounds[roomCode].declaredCard}" to reconnected player ${playerName}`);
        
        // Send round state information
        const timeElapsed = Math.floor((Date.now() - activeRounds[roomCode].startTime) / 1000);
        const timeRemaining = Math.max(0, activeRounds[roomCode].timeRemaining - timeElapsed);
        
        if (timeRemaining > 0) {
          socket.emit('roundState', {
            timeRemaining: timeRemaining,
            roundInProgress: true,
            declaredCard: activeRounds[roomCode].declaredCard
          });
          console.log(`🎯 Sent round state to ${playerName}: ${timeRemaining}s remaining`);
        }
      }
    }
    
    // ✅ MERGE FIX: Preserve drinks accumulated while disconnected
    console.log(`🔍 DEBUG MERGE: Looking for disconnected stats for ${playerName}`);
    console.log(`🔍 DEBUG MERGE: All playerStats:`, Object.entries(playerStats).map(([id, stats]) => 
      `${id.slice(-4)}: ${JSON.stringify({totalDrinks: stats.totalDrinks, name: stats.name, disconnected: stats.disconnected})}`
    ));
    
    // ✅ STRICT NAME MATCH: entries for this player name IN THIS ROOM.
    // A name match alone spans every game on the server: it handed this player
    // a stranger's higher score, and then deleted the stranger's entry in the
    // cleanup below — corrupting both rooms at once.
    const allPlayerEntries = roomEntriesForName(ownedSocketIds, playerName);
    
    console.log(`🔍 DEBUG MERGE: All entries for player name "${playerName}":`, allPlayerEntries.map(([id, stats]) => 
      `${id.slice(-4)}: ${stats.totalDrinks || 0} drinks, disconnected: ${stats.disconnected}, name: ${stats.name}`
    ));
    
    // Find the entry with the highest totalDrinks for this specific player
    const maxDrinksEntry = allPlayerEntries.length > 0 
      ? allPlayerEntries.reduce((max, current) => {
          const currentDrinks = current[1].totalDrinks || 0;
          const maxDrinks = max ? max[1].totalDrinks || 0 : 0;
          return currentDrinks > maxDrinks ? current : max;
        })
      : null;
    
    console.log(`🔍 DEBUG MERGE: Max drinks entry:`, maxDrinksEntry ? 
      `${maxDrinksEntry[0].slice(-4)}: ${maxDrinksEntry[1].totalDrinks} drinks` : 'none'
    );
    
    // ✅ FIX: Use disconnected playerStats as authoritative source, NOT formerPlayers
    // formerPlayers is outdated if rounds happened while player was offline
    const finalDrinks = maxDrinksEntry ? maxDrinksEntry[1].totalDrinks || 0 : formerPlayer.totalDrinks || 0;
    const finalShotguns = maxDrinksEntry ? maxDrinksEntry[1].totalShotguns || 0 : formerPlayer.totalShotguns || 0;
    
    console.log(`🔄 MERGE STATS: ${playerName} - Using disconnected playerStats: ${finalDrinks} drinks (formerPlayers had ${formerPlayer.totalDrinks || 0} drinks)`);
    
    // Restore their game data with merged stats
    playerStats[socket.id] = {
      totalDrinks: finalDrinks,
      totalShotguns: finalShotguns,
      standard: formerPlayer.standard || [],
      wild: formerPlayer.wild || []
    };
    
    // ✅ STRICT CLEANUP: Only clean up entries that specifically belong to this player name
    allPlayerEntries.forEach(([oldSocketId, oldStats]) => {
      if (oldSocketId !== socket.id && oldStats.name === playerName) { // Extra safety check
        console.log(`🧹 CLEANUP: Removing old entry for ${playerName} (${oldSocketId.slice(-4)}) with ${oldStats.totalDrinks || 0} drinks, name: ${oldStats.name}`);
        delete playerStats[oldSocketId];
      }
    });
    
    forgetFormerPlayer(roomCode, playerName);
    console.log(`✅ Restored ${playerName} with merged data:`, playerStats[socket.id]);
    
    // ✅ RECONNECTION FIX: Check if reconnecting player has the declared card and can assign drinks
    if (activeRounds[roomCode]) {
      const declaredCard = activeRounds[roomCode].declaredCard;
    
      // Replay exactly what this player was told to pour when the card was
      // played. This CANNOT be re-derived from their current hand: the played
      // cards are removed and replaced the instant they are played, so the
      // hand no longer shows what was played. Filtering it gave a refreshing
      // player either nothing at all (usually) or, when the replacement draw
      // happened to redeal the same card type, a prompt for an amount they
      // never played.
      if (declaredCard !== 'First Down') {
        const pending = pendingPourFor(roomCode, playerName);
        if (pending) {
          socket.emit('distributeDrinks', { playerId: socket.id, ...pending });
          console.log(`🎯 REPLAY: sent {${pending.drinkCount}} drinks, {${pending.shotguns}} shotguns to reconnected ${playerName} for ${declaredCard}`);
        } else {
          console.log(`🎯 REPLAY: ${playerName} owes nothing this round for ${declaredCard}`);
        }
      }
    }
    
    // Join the socket to the room
    socket.join(roomCode);
    
    // Send game state directly
    if (rooms[roomCode].gameStarted) {
      // ✅ FIX: Send only card data in hands, not full playerStats
      const handData = {
        standard: playerStats[socket.id].standard || [],
        wild: playerStats[socket.id].wild || []
      };
      
      console.log(`🔧 DEBUG: Sending gameStarted to socket ${socket.id} for player ${playerName}`);
      console.log(`🔧 DEBUG: Hand data being sent:`, handData);
      console.log(`🔧 DEBUG: Standard cards count:`, handData.standard.length);
      console.log(`🔧 DEBUG: Wild cards count:`, handData.wild.length);
      
      // If everyone had dropped, the whistle is pointing at a dead socket.
      // First one back takes it — and it must happen before the payload below
      // is built, or hostId ships stale.
      ensureRefIsPresent(roomCode, { id: socket.id, name: playerName });
      socket.emit('gameStarted', {
        hostId: rooms[roomCode] ? rooms[roomCode].host : undefined,
        hands: { [socket.id]: handData },
        // THIS room's stats. It used to be the module-global map, which put
        // every other game on the server into this client's state and grew
        // with every game the process had ever hosted.
        playerStats: buildRoomStats(rooms[roomCode])
      });
      
      // ✅ FIX: Send complete players list so reconnected player sees everyone
      rooms[roomCode].players = deduplicatePlayers(rooms[roomCode].players);
      socket.emit('updatePlayers', rooms[roomCode].players);
      console.log(`📡 Sent complete players list to reconnected player ${playerName}`);
      
      // ✅ CRITICAL: Notify ALL players of the new socket ID mapping
      io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
      console.log(`📡 Notified all players of ${playerName}'s new socket ID: ${socket.id}`);

      
      // ✅ FIX: Send updatePlayerHand to ALL active players to refresh their cards
      rooms[roomCode].players.forEach((player) => {
        if (!player.disconnected && playerStats[player.id]) {
          const playerHand = {
            standard: playerStats[player.id].standard || [],
            wild: playerStats[player.id].wild || []
          };
          io.to(player.id).emit('updatePlayerHand', playerHand);
          console.log(`📡 Refreshed hand for ${player.name} (${player.id.slice(-4)}) after reconnection`);
        }
      });
      
      console.log(`📡 Sent gameStarted to reconnected player ${playerName} with socket ${socket.id}`);
      
      // ✅ REMOVED: Auto-refresh after reconnection to prevent infinite loops
      // Let client-side stealth detection handle refreshes when truly needed
    } else {
      socket.emit('joinedRoom', roomCode);
      socket.emit('updatePlayers', rooms[roomCode].players);
      console.log(`📡 Sent lobby state to reconnected player ${playerName}`);
    }
    // Deliberately on the RECONNECT branch only. Somebody joining fresh under
    // the original host's name is a different person as far as this is
    // concerned, and must not inherit the whistle.
    restoreOriginalHostIfDue(roomCode, socket.id, playerName);
    return;
  }

  // ✅ NEW PLAYER: the table is only so big. A disconnected player still holds
  // their seat -- they own drinks and are expected back.
  if (rooms[roomCode].players.length >= MAX_PLAYERS) {
    console.log(`❌ Room ${roomCode} is full (${rooms[roomCode].players.length}/${MAX_PLAYERS})`);
    socket.emit('error', `That game is full (${MAX_PLAYERS} players max).`);
    return;
  }

  // ✅ NEW PLAYER: Check if name is already taken by active player
  const existingActivePlayer = rooms[roomCode].players.find(p => p.name === playerName && !p.disconnected);
  if (existingActivePlayer) {
    console.log(`❌ Player name "${playerName}" is already taken by an active player`);
    socket.emit('error', `Player name "${playerName}" is already taken. Please choose a different name.`);
    return;
  }
  // ✅ NEW PLAYER: Handle as normal new player
  console.log(`🆕 NEW PLAYER: ${playerName} joining room ${roomCode}`);
  
  // Add to players list (check for duplicates first)
  const existingPlayer = rooms[roomCode].players.find(p => p.id === socket.id);
  if (!existingPlayer) {
    rooms[roomCode].players.push({ id: socket.id, name: playerName, disconnected: false });
  } else {
    console.log(`⚠️ Player ${socket.id} already exists in room, updating instead of adding`);
    existingPlayer.name = playerName;
    existingPlayer.disconnected = false;
  }
  
  // Initialize player stats
  playerStats[socket.id] = { 
    id: socket.id, 
    name: playerName, 
    totalDrinks: 0, 
    totalShotguns: 0, 
    standard: [], 
    wild: [] 
  };
  
  // Join socket to room
  socket.join(roomCode);
  
  // Handle game state
  if (rooms[roomCode].gameStarted) {
    // Game in progress - deal cards
    const room = rooms[roomCode];
    const { standardDeck, wildDeck } = room.deck;
    
    playerStats[socket.id].standard = standardDeck.splice(0, 5);
    playerStats[socket.id].wild = wildDeck.splice(0, 2);
    
    socket.emit('gameStarted', {
        hostId: rooms[roomCode] ? rooms[roomCode].host : undefined,
      hands: { [socket.id]: {
        standard: playerStats[socket.id].standard,
        wild: playerStats[socket.id].wild
      }},
      playerStats: buildRoomStats(room)
    });
    
    // ✅ FIX: Deduplicate and send complete players list so new player sees everyone
    room.players = deduplicatePlayers(room.players);
    socket.emit('updatePlayers', room.players);
    console.log(`📡 Sent complete players list to new player ${playerName}`);
    
    // ✅ NEW: Notify ALL players in the room about the new player joining
    socket.to(roomCode).emit('updatePlayers', room.players);
    console.log(`📡 Notified all existing players about new player ${playerName} joining`);
    
    // ✅ REMOVED: updatePlayerStats on join - only send on round completion
    console.log(`📡 Player join complete - stats will update on next round completion`);
    
    console.log(`📡 Sent gameStarted to new player ${playerName}`);
  } else {
    // Lobby - send lobby state
    socket.emit('joinedRoom', roomCode);
    rooms[roomCode].players = deduplicatePlayers(rooms[roomCode].players);
    io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    console.log(`📡 Sent lobby state to new player ${playerName}`);
  }
}

// Regular Join Room event (calls the extracted function)
socket.on('joinRoom', (roomCode, playerName) => {
  handleJoinRoom(socket, roomCode, playerName);
});

  // Leave Room
  socket.on('leaveRoom', (roomCode) => {
    if (rooms[roomCode]) {
      const players = rooms[roomCode].players;
      const playerIndex = players.findIndex(player => player.id === socket.id);

      if (playerIndex !== -1) {

        
    
        const leaver = players[playerIndex];
        if (leaver && rooms[roomCode].originalHostName === leaver.name) {
          clearOriginalHostClaim(roomCode, 'the original host left the lobby on purpose');
        }
        players.splice(playerIndex, 1);
        socket.leave(roomCode);
        delete playerStats[socket.id];  // Remove player stats
        console.log(`Player ${socket.id} left room ${roomCode}`);


        if (rooms[roomCode].players.length === 0) {
          // Empty is not dead. The reaper closes it once the idle window has
          // passed with nobody back.
          markRoomEmpty(roomCode);
        } else {
          if (rooms[roomCode].host === socket.id) {
            // The lobby used to close here. It no longer does: the whistle
            // moves and everyone else keeps their seat.
            handOverWhistle(roomCode, 'The host has left. A new host has been assigned.');
          }
          io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
        }
      }
    }
  });

  // Start Game
  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.players.length >= MIN_PLAYERS) {
      const { standardDeck, wildDeck } = generateDecks(room.players.length);

      // Log the decks in the terminal before shuffling and dealing out the cards
      //console.log('Standard Deck before dealing:', standardDeck);
    //  console.log('Wild Deck before dealing:', wildDeck);

      const hands = distributeCards(room.players, standardDeck, wildDeck);
      rooms[roomCode].deck = { standardDeck, wildDeck }; // Save remaining deck in room
    // Set the gameStarted flag to true for this room
    rooms[roomCode].gameStarted = true;
    rooms[roomCode].quarter = 1;  // Initialize quarter as 1
    // A new game is a new set of swap allowances, so a room that plays twice
    // does not start its second game with quarter 1 already spent.
    rooms[roomCode].wildSwapQuarter = {};

// Reset playerStats for THIS ROOM's players only. Wiping the whole map would
// delete every other room's players mid-game, which crashes finalizeRound.
room.players.forEach(player => {
    delete playerStats[player.id];
  });
   // Initialize playerStats for all players (total drinks and shotguns to 0)
   room.players.forEach(player => {
    playerStats[player.id] = {
      totalDrinks: 0,
      totalShotguns: 0,
      standard: hands[player.id].standard,  // Initial hand for the standard deck
      wild: hands[player.id].wild           // Initial hand for the wild deck
    };
  });
      // Ensure roundResults[roomCode] is initialized
      if (!roundResults[roomCode]) {
        roundResults[roomCode] = {};
      }
 
    // Emit the start game event with the player hands add the player stats here!!!!!!!!!!!!

     // Emit the start game event with player hands and player stats
     io.to(roomCode).emit('gameStarted', {
        hostId: rooms[roomCode] ? rooms[roomCode].host : undefined,
        hands,         // The player hands
        // THIS room's initial stats, all zero. Written in shorthand, this was
        // the module-global map — the fifth and largest of the sites that sent
        // every other game on the server to every client.
        playerStats: buildRoomStats(room)
      });

    // Log that the game has started
    console.log(`Game started in room ${roomCode}. GameStarted flag set to true.`);
  } else {
    console.log(`Unable to start game in room ${roomCode}. Ensure at least 3 players.`);
  }
  });

  // Handle assigning a new host
socket.on('assignNewHost', ({ roomCode, newHostId } = {}) => {
    const room = rooms[roomCode];
    if (!room) return;
  
    // Check if the current socket is the host
    if (room.host === socket.id) {
      // Assign the new host — but only to somebody who is actually here.
      const newHost = room.players.find(player => player.id === newHostId);
      if (!newHost || newHost.disconnected) {
        // Reuse the existing `error` event; the client already renders it.
        const why = newHost
          ? `${newHost.name} has dropped out — pick someone who is still in the game.`
          : 'That player is no longer in the game.';
        console.log(`⛔ Refused host handoff to ${newHostId}: ${newHost ? 'disconnected' : 'not in room'}`);
        io.to(socket.id).emit('error', why);
      } else {
        room.host = newHostId;
        // A deliberate handoff spends the original host's claim. Without this
        // the giver could drop, reconnect, and silently take back a whistle
        // they chose to give away.
        clearOriginalHostClaim(roomCode, 'the host handed the whistle over');
        io.to(roomCode).emit('newHost', { newHostId, message: `${newHost.name} is now the new host.` });
        console.log(`Host has been swapped to player: ${newHostId}`);
      }
    }
        // Update the hands of the remaining players
        room.players.forEach(player => {
            const playerHand = playerStats[player.id];
            io.to(player.id).emit('updatePlayerHand', { standard: playerHand.standard, wild: playerHand.wild });  
          });
  });

// Handle Next Quarter event
socket.on('nextQuarter', ({ roomCode } = {}) => {
    const room = rooms[roomCode];
    if (!room) return;

    // Increase the quarter count
    if (!room.quarter) {
        room.quarter = 1;  // Initialize the quarter if it's not defined
    }
    room.quarter += 1;

    console.log(`Quarter changed to ${room.quarter} in room ${roomCode}`);

    // Broadcast the updated quarter to all players in the room
    io.to(roomCode).emit('quarterUpdated', room.quarter);

    // When the new quarter starts, allow each player to swap a wild card
    room.players.forEach(player => {
        const playerHand = playerStats[player.id];

        // Send the current wild cards for selection
        io.to(player.id).emit('wildCardSelection', { wildCards: playerHand.wild });
    });
});

// Handle Wild Card Swap
/**
 * Swap ONE duplicate standard card at the quarter break.
 *
 * Same allowance as the wild swap, not a second one — `hasSpentSwapThisQuarter`
 * and `recordSwap` are shared, so a player gets one swap per quarter of either
 * kind. Two allowances would double everybody's rerolls, which is not what
 * "same one-per-quarter allowance" means.
 *
 * Only DUPLICATES qualify. A hand of five different standard cards has nothing
 * wrong with it; holding the same card twice is the dead weight this fixes. It
 * also keeps the swap from becoming a general reroll of anything you dislike.
 *
 * Mirrors wildCardSwap deliberately, including staying silent on a refusal:
 * the client closes its own modal on emit and listens for no reply, so an
 * error event here would be new surface nothing renders.
 */
socket.on('standardCardSwap', ({ roomCode, discardedCard } = {}) => {
  const room = rooms[roomCode];
  if (!room) return;

  const player = room.players.find((p) => p.id === socket.id);
  if (!player) return;

  if (hasSpentSwapThisQuarter(room, player.name)) {
    console.log(`⛔ Ignoring standard swap from ${player.name} in ${roomCode} — already swapped in quarter ${currentQuarter(room)}`);
    return;
  }

  if (!discardedCard || typeof discardedCard !== 'object') {
    console.log(`⛔ standardCardSwap from ${player.name} with no card — ignoring`);
    return;
  }

  const playerHand = playerStats[player.id];
  if (!playerHand || !Array.isArray(playerHand.standard)) return;

  const matches = playerHand.standard.filter(
    (c) => c && c.card === discardedCard.card && c.drinks === discardedCard.drinks
  );
  if (matches.length < 2) {
    console.log(`⛔ ${player.name} asked to swap ${discardedCard.card}, which they hold ${matches.length} of — duplicates only`);
    return;
  }

  const cardIndex = playerHand.standard.findIndex(
    (c) => c && c.card === discardedCard.card && c.drinks === discardedCard.drinks
  );
  if (cardIndex === -1) return;

  if (!room.deck || !Array.isArray(room.deck.standardDeck) || room.deck.standardDeck.length === 0) {
    console.log(`⛔ standardCardSwap in ${roomCode}: the standard deck is empty`);
    return;
  }

  if (!usedCards[roomCode]) usedCards[roomCode] = { standard: [], wild: [] };
  usedCards[roomCode].standard.push(discardedCard);

  const replacement = room.deck.standardDeck.pop();
  playerHand.standard[cardIndex] = replacement;

  recordSwap(room, player.name);
  checkAndReplenishDecks(roomCode);

  console.log(`Player ${player.name} swapped duplicate standard ${discardedCard.card} for ${replacement && replacement.card}`);
  io.to(socket.id).emit('updatePlayerHand', {
    standard: playerHand.standard,
    wild: playerHand.wild,
  });
});

socket.on('wildCardSwap', ({ roomCode, discardedCard } = {}) => {
    console.log("Wild card selected", discardedCard);

    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    console.log("Player", player);

    if (!player)
    return;

    // ONE swap per player per quarter. Silently ignore anything past the first:
    // the real client closes its own swap modal the instant it emits and never
    // waits for a reply (App.js:461), so a second swap is a replayed or
    // malformed message rather than a user action. An error event here would be
    // new surface no client listens for.
    if (hasSpentSwapThisQuarter(room, player.name)) {
      console.log(`⛔ Ignoring extra wild card swap from ${player.name} in room ${roomCode} — already swapped in quarter ${currentQuarter(room)}`);
      return;
    }

    const playerHand = playerStats[player.id];
    console.log("Player Hand", playerHand);

   // Find the index of the discarded card by comparing specific properties
   // The room, player and allowance guards above all pass before this, so a
   // swap with no card reached it and threw.
   if (!discardedCard || typeof discardedCard !== 'object') {
     console.log(`⛔ wildCardSwap from ${player.name} with no card — ignoring`);
     return;
   }
   const cardIndex = (playerHand.wild || []).findIndex(card => card && card.card === discardedCard.card && card.drinks === discardedCard.drinks);
   console.log("Card Index", cardIndex);

    if (cardIndex === -1) return;  // If card not found, do nothing

    // Store the discarded wild card 
    if (!usedCards[roomCode]) usedCards[roomCode] = { standard: [], wild: [] };
    usedCards[roomCode].wild.push(discardedCard);
    
    // Replace the discarded wild card with a new one from the wild deck
    const newWildCard = room.deck.wildDeck.pop();  // Take a new card from the wild deck
    playerHand.wild[cardIndex] = newWildCard;

    console.log("New Wild card in", playerHand.wild);

    // The swap really happened, so spend this player's allowance for the quarter.
    recordSwap(room, player.name);

    // Check if deck needs replenishment after card is drawn
    checkAndReplenishDecks(roomCode);

    // Log the wild card swap
    console.log(`Player ${socket.id} swapped wild card ${discardedCard} for ${newWildCard}`);

    // Send the updated hand back to the player
    io.to(socket.id).emit('updatePlayerHand', { 
        standard: playerHand.standard, 
        wild: playerHand.wild 
    });
});



// Handle First Down event
socket.on('firstDownEvent', ({ roomCode } = {}) => {
  refTookOver(roomCode);
  const result = declareFirstDown(roomCode);
  if (result.ok) tellRoundSource(roomCode, 'ref', 'First Down');
  if (result.reason === 'busy') io.to(socket.id).emit('actionInProgress', BUSY_MESSAGE);
});

  // Play Standard Card Event (Triggered by the host)
  socket.on('playStandardCard', ({ roomCode, cardType } = {}) => {
    refTookOver(roomCode);
    const result = declareStandardCard(roomCode, cardType);
    if (result.ok) tellRoundSource(roomCode, 'ref', cardType);
    if (result.reason === 'busy') io.to(socket.id).emit('actionInProgress', BUSY_MESSAGE);
  });
// Handle wild card selection
socket.on('wildCardSelected', ({ roomCode, playerId, wildcardtype } = {}) => {
    const room = rooms[roomCode];  // Now roomCode is available
    if (!room) return;
  
    // Broadcast the wild card selection to the host
     // Check if an action is already in progress
     if (room.isActionInProgress) {
        // Emit a message to the frontend asking the player to wait
        io.to(socket.id).emit('actionInProgress', 'Action is in progress. Please wait until the round ends.');
        return;
      }
    io.to(room.host).emit('wildCardSelected', { playerId, wildcardtype });
  });

// Listen for the confirmed wild card action from the host
socket.on('wildCardConfirmed', ({ roomCode, wildcardtype, player } = {}) => {
    void player;   // only ever used for a log line; the work loops over holders
    refTookOver(roomCode);
    const result = declareWildCard(roomCode, wildcardtype);
    if (result.ok) tellRoundSource(roomCode, 'ref', wildcardtype);
    if (result.reason === 'busy') io.to(socket.id).emit('actionInProgress', BUSY_MESSAGE);
});

// Handle drink and shotgun assignments for a round
socket.on('assignDrinks', ({ roomCode, selectedPlayerIds, drinksToGive, shotgunsToGive } = {}) => {
    const room = rooms[roomCode];
    if (!room) return;

    // Locked in means done. Anything after it is ignored — including an undo,
    // because locking in is the point at which the decision is final.
    const assigner = room.players.find(p => p.id === socket.id);
    if (assigner && playerHasLockedIn(roomCode, assigner.name)) {
      console.log(`⛔ ${assigner.name} already locked in this round — ignoring further pours`);
      return;
    }
  
    if (!roundResults[roomCode]) {
      roundResults[roomCode] = {};  // Initialize for each round
    }
    
    // The eight-line ASSIGN DRINKS DEBUG block that used to sit here was the
    // loudest thing on the server: the client flushes a delta every 700ms per
    // pouring player, so one 21-second round with six players ran to about a
    // thousand lines. One outcome line at the end of this handler replaces it.

    // ✅ SOCKET MAPPING FIX: Resolve selected player IDs through socket mappings with transitive resolution
    const resolvedPlayerIds = selectedPlayerIds.map(selectedPlayerId => {
      if (socketIdMappings[roomCode]) {
        // Implement transitive resolution for chained mappings (e.g., A→B→C should resolve A to C)
        let currentId = selectedPlayerId;
        const visited = new Set(); // Prevent infinite loops
        let resolutionPath = [currentId.slice(-4)];
        
        while (socketIdMappings[roomCode][currentId] && !visited.has(currentId)) {
          visited.add(currentId);
          const nextId = socketIdMappings[roomCode][currentId];
          resolutionPath.push(nextId.slice(-4));
          currentId = nextId;
        }
        
        if (currentId !== selectedPlayerId) {
          console.log(`🔄 Transitive socket ID resolution: ${resolutionPath.join(' → ')}`);
          return currentId;
        }
      }
      return selectedPlayerId;
    });
    
    // ✅ SOCKET MAPPING FIX: Resolve drinks and shotguns objects to use new socket IDs with transitive resolution
    const resolvedDrinksToGive = {};
    const resolvedShotgunsToGive = {};
    
    // Helper function for transitive resolution
    const resolveTransitively = (originalId) => {
      if (!socketIdMappings[roomCode]) return originalId;
      
      let currentId = originalId;
      const visited = new Set();
      let resolutionPath = [currentId.slice(-4)];
      
      while (socketIdMappings[roomCode][currentId] && !visited.has(currentId)) {
        visited.add(currentId);
        const nextId = socketIdMappings[roomCode][currentId];
        resolutionPath.push(nextId.slice(-4));
        currentId = nextId;
      }
      
      if (currentId !== originalId) {
        console.log(`🔄 Transitive resolution for drinks/shotguns: ${resolutionPath.join(' → ')}`);
      }
      
      return currentId;
    };
    
    Object.entries(drinksToGive || {}).forEach(([originalId, drinks]) => {
      const resolvedId = resolveTransitively(originalId);
      resolvedDrinksToGive[resolvedId] = drinks;
      if (originalId !== resolvedId) {
        console.log(`🔄 Resolved drinks mapping: ${originalId.slice(-4)} → ${resolvedId.slice(-4)} (${drinks} drinks)`);
      }
    });
    
    Object.entries(shotgunsToGive || {}).forEach(([originalId, shotguns]) => {
      const resolvedId = resolveTransitively(originalId);
      resolvedShotgunsToGive[resolvedId] = shotguns;
      if (originalId !== resolvedId) {
        console.log(`🔄 Resolved shotguns mapping: ${originalId.slice(-4)} → ${resolvedId.slice(-4)} (${shotguns} shotguns)`);
      }
    });

    // Iterate over each resolved player and update their drinks and shotguns
    resolvedPlayerIds.forEach(selectedPlayerId => {
      // Ensure the roundResults entry for the player exists
      if (!roundResults[roomCode][selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId] = { drinks: 0, shotguns: 0 };
      } 
  
      // Add drinks to the player's round results, if applicable
      if (resolvedDrinksToGive && resolvedDrinksToGive[selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId].drinks += resolvedDrinksToGive[selectedPlayerId];
  
        // Check if player reached or exceeded 10 drinks in this round
        if (roundResults[roomCode][selectedPlayerId].drinks >= 10) {
          // Player needs to shotgun
          roundResults[roomCode][selectedPlayerId].shotguns += 1;
          roundResults[roomCode][selectedPlayerId].drinks -= 10;  // Reduce drinks by 10
          console.log(`Player ${selectedPlayerId} reached 10 drinks and has to shotgun!`);
        }
      }
      // Add shotguns to the player's round results, if applicable
      if (resolvedShotgunsToGive && resolvedShotgunsToGive[selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId].shotguns += resolvedShotgunsToGive[selectedPlayerId];
      }

      // ✅ UNDO: a pour can be taken back, which arrives here as a NEGATIVE.
      //
      // Ten drinks are folded into a shotgun as they accumulate, so a -1
      // landing just after a fold used to leave the player on 1 shotgun and
      // MINUS ONE drinks — arithmetically 9, but displayed as nonsense. Borrow
      // the shotgun back instead, and never let either count go below zero.
      // Without this, undo could only reach taps that had not been sent yet,
      // which gave players a sub-second window and was reported as "you cannot
      // undo who you click to give a drink to".
      const result = roundResults[roomCode][selectedPlayerId];
      while (result.drinks < 0 && result.shotguns > 0) {
        result.shotguns -= 1;
        result.drinks += DRINKS_PER_SHOTGUN;
      }
      if (result.drinks < 0) result.drinks = 0;
      if (result.shotguns < 0) result.shotguns = 0;
    });
  
    // ✅ Take what this player just poured off what they still owe, so a
    // reconnect replays the REMAINDER rather than the original amount.
    // Uses the raw payload, not the socket-id-resolved copy: this is the
    // giver's outlay, and it is theirs whoever the drinks landed on.
    const giver = room.players.find(p => p.id === socket.id);
    const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    if (giver) {
      settlePendingPour(roomCode, giver.name, sum(drinksToGive), sum(shotgunsToGive));
    }

    // The one line a pour is worth: who, how much, where.
    console.log(`🍺 ${giver ? giver.name : socket.id.slice(-4)} poured ${sum(drinksToGive)}d/${sum(shotgunsToGive)}s in ${roomCode}`);

    // That pour may have been the last thing anyone owed.
    maybeFinishRoundEarly(roomCode);
  });

  // Log player hands

  // Log player stats for drinks/shotguns
  const logPlayerStats = (players) => {
    console.log('Player stats:');
    players.forEach(player => {
      const stats = playerStats[player.id];
      console.log(`${player.name} - Drinks: ${stats.drinks}, Shotguns: ${stats.shotguns}`);
    });
  };

  // Handle custom 'leaveGame' event
/**
 * The Ref takes a player out — for somebody who left the bar without leaving
 * the game.
 *
 * Deliberately routed through the SAME handler a player's own Leave button
 * uses, by re-emitting it on that player's socket, rather than reimplementing
 * the removal. Leaving is not one step: it saves stats to `formerPlayers`,
 * drops `playerStats`, moves the whistle if the leaver held it, handles the
 * room going empty, and refreshes everyone's hand. A second copy of that would
 * drift, and this codebase has been bitten by exactly that before.
 */
socket.on('removePlayer', ({ roomCode, playerId } = {}) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.host !== socket.id) {
    console.log(`⛔ ${socket.id} tried to remove ${playerId} from ${roomCode} without the whistle`);
    return;
  }
  if (!playerId || playerId === socket.id) {
    // Removing yourself is what Leave Game is for. Routing it here would go
    // through the host-reassignment path twice.
    if (playerId === socket.id) io.to(socket.id).emit('error', 'Use Leave game to leave yourself.');
    return;
  }
  const target = room.players.find((p) => p.id === playerId);
  if (!target) {
    io.to(socket.id).emit('error', 'That player is no longer in the game.');
    return;
  }

  console.log(`🏈 Ref ${socket.id} removed ${target.name} (${playerId}) from ${roomCode}`);
  // Tell them first, while their socket is still in the room, so their screen
  // returns to the start rather than freezing on a game they are not in.
  io.to(playerId).emit('removedFromGame', {
    roomCode,
    message: 'The Ref removed you from the game.',
  });

  const targetSocket = io.sockets.sockets.get(playerId);
  if (targetSocket) {
    // One path, not two: replay their own Leave.
    leaveGameFor(targetSocket, roomCode);
  }
});

/**
 * A player leaves the game they are in.
 *
 * Extracted from the `leaveGame` handler so the Ref's `removePlayer` can reuse
 * it verbatim instead of growing a second, drifting copy. `socket` is the
 * socket of the player LEAVING, which is not necessarily the socket that asked.
 */
const leaveGameFor = (socket, roomCode) => {
    console.log(`Player ${socket.id} has left the game manually.`);
    
    const room = rooms[roomCode];
    if (!room) return;  // If the room doesn't exist, do nothing
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    if (playerIndex === -1) return; // If player is not found, do nothing

    const leavingPlayer = room.players[playerIndex];

    // Choosing to go ends any claim on the whistle. Dropping does not — that
    // is the whole distinction the restore rests on.
    if (room.originalHostName && leavingPlayer.name === room.originalHostName) {
      clearOriginalHostClaim(roomCode, 'the original host left on purpose');
    }

    // Log player stats and hands before disconnecting
    console.log(`Saving stats for leaving player ${leavingPlayer.name} with ID ${socket.id}`);
    console.log(playerStats[socket.id]);
    console.log("Player array:", room.players);

    // Store player data in formerPlayers by their name.
    // The stats may be missing — this is the one path that reads them without
    // having just written them, and a missing entry must not take the process
    // down and every other room with it.
    const leavingStats = playerStats[socket.id] || {};
    rememberFormerPlayer(roomCode, {
      id: socket.id,  // Original socket ID (for reference)
      name: leavingPlayer.name,
      totalDrinks: leavingStats.totalDrinks || 0,
      totalShotguns: leavingStats.totalShotguns || 0,
      standard: leavingStats.standard || [],
      wild: leavingStats.wild || []
    });
    console.log(`Former players in ${roomCode}:`, Object.keys(formerPlayersIn(roomCode)));


    // Find and remove the player by their socket ID
    room.players = room.players.filter(player => player.id !== socket.id);

    delete playerStats[socket.id];  // Remove player stats
    // Check if only no player is left
    if (room.players.length === 0) {
        // Everyone walked. Tell the last one out that the game is over, but
        // KEEP the room: they may have left by accident, and half an hour of
        // memory costs nothing next to losing a game in progress.
        io.to(roomCode).emit('gameOver', 'The game is ending as no player is left.');
        markRoomEmpty(roomCode);
        return;  // Exit the function to prevent further execution
    }

    // Handle if the host leaves
    if (room.host === socket.id) {
      // ACTIVE players only. `room.players[0]` could be somebody who dropped
      // out ten minutes ago, which hands the whistle to an empty chair.
      const stillHere = activePlayers(room);
      if (stillHere.length > 0) {
        // Reassign the host if there are players left
        room.host = stillHere[0].id;
        io.to(roomCode).emit('newHost', { newHostId: room.host, message: 'The host has left. A new host has been assigned.' });
      // Notify the remaining players that a player has left
      io.to(roomCode).emit('playerLeft', { playerId: socket.id, remainingPlayers: room.players });

      console.log(`Player ${socket.id} left the game in progress.`);
    } else {
        // Everyone else is disconnected rather than gone. The room stays open
        // for them; the reaper deals with it if none of them come back.
        io.to(roomCode).emit('gameOver', 'The game is ending as all other players have disconnected.');
        console.log(`Room ${roomCode} has no active players. Holding it for reconnections.`);
      }
    } else {
      // Notify the remaining players that a player has left
      io.to(roomCode).emit('playerLeft', { playerId: socket.id, remainingPlayers: room.players });

      console.log(`Player ${socket.id} left the game in progress.`);
    }

    // Update the hands of the remaining players
    room.players.forEach(player => {
      const playerHand = playerStats[player.id];
      if (!playerHand) return;  // nothing to send, and dereferencing it kills the server
      io.to(player.id).emit('updatePlayerHand', { standard: playerHand.standard, wild: playerHand.wild });
      // ✅ REMOVED: updatePlayerStats on disconnect - only send on round completion
    });
};

socket.on('leaveGame', ({ roomCode } = {}) => leaveGameFor(socket, roomCode));

// Add this handler in the io.on('connection') block
// In server.js - update the requestGameState handler to be more robust
/**
 * A player is done with this round, whatever they have left.
 *
 * There was no `lockIn` event at all — the client's Lock In button only
 * flushed pours and set a local flag, so an explicit lock-in never reached the
 * server and could not end the round.
 *
 * Locking in with drinks outstanding is FORFEITING them, which is the existing
 * behaviour when the clock runs out. This only makes it end your participation
 * rather than clearing a debt you have not poured.
 */
// ── Live game tracking: attach, detach, and the picker ──────────────────────
//
// Ref-only, and entirely additive. A room that never attaches plays exactly as
// it always has, and detaching at any moment leaves a perfectly normal game.

/** Only the Ref may point the room at a game. */
const refOf = (roomCode) => {
  const room = rooms[roomCode];
  return room ? room.host : null;
};

socket.on('listGames', async ({ league = 'nfl', groups = null } = {}) => {
  try {
    // FBS is groups=80 and FCS is 81; omitting it already returns all of FBS.
    // (The plan's `groups=50` returns four events, not a full slate.)
    // The date is deliberately NOT taken from the client — see FEED_DEMO_DATE.
    const date = FEED_DEMO_DATES[league] || null;
    const games = await listGames(league, { date, groups });
    socket.emit('gameList', { league, date, games });
  } catch (error) {
    console.error(`🏈 could not list ${league} games: ${error && error.message}`);
    // Never a crash and never a wrong call: an empty list still lets the Ref
    // run the game by hand.
    socket.emit('gameList', { league, date: FEED_DEMO_DATE, games: [], error: 'Could not load games right now.' });
  }
});

/**
 * Dev-only: let a replay script attach a fixture to a room it is not the Ref of.
 *
 * OFF unless ALLOW_REPLAY_ATTACH=1 is set on the server, so production keeps
 * the plain Ref-only rule. This exists so a recorded game can be run into a
 * real room at 1x and WATCHED — which is the only way to judge whether the
 * pacing reads as alive or as relentless. See scripts/replay-into-room.mjs.
 */
const REPLAY_ATTACH_ALLOWED = process.env.ALLOW_REPLAY_ATTACH === '1';

socket.on('attachGame', ({ roomCode, league = 'nfl', gameId, replayFixture, speed } = {}) => {
  const room = rooms[roomCode];
  if (!room || !gameId) return;
  const isRef = refOf(roomCode) === socket.id;
  const isReplayHarness = REPLAY_ATTACH_ALLOWED && Boolean(replayFixture);
  if (!isRef && !isReplayHarness) {
    console.log(`⛔ ${socket.id} tried to attach a game to ${roomCode} without the whistle`);
    return;
  }

  const entry = watchers.attach(roomCode, league, String(gameId), { replayFixture, speed });
  if (!entry) return;

  room.watching = { league, gameId: String(gameId) };
  room.autoCallPaused = false;
  if (!room.cardModes) room.cardModes = {};
  io.to(roomCode).emit('gameAttached', {
    league, gameId: String(gameId), ...entry.state,
    // Said once, plainly. People should not have to work out why rounds are
    // starting on their own.
    announce: 'The feed is calling this game. Rounds will start on their own — the Ref can still call anything by hand.',
    cardModes: room.cardModes,
    // The shipped tiering. Without it the dial has nothing to fall back on and
    // draws every card as "off", which is both wrong and actively misleading —
    // it invites the Ref to switch on something that is already on.
    cardDefaults: { ...MODES },
    autoCallPaused: false,
  });
  console.log(`🏈 room ${roomCode} is watching ${league}/${gameId} (${entry.rooms.size} room(s) on this game)`);
});

/**
 * Pause auto-calling. One tap, instant, and it does NOT detach the game — the
 * score header stays and the Ref keeps calling by hand. This is the escape
 * hatch when something starts misbehaving in front of people.
 */
socket.on('pauseAutoCall', ({ roomCode, paused } = {}) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (refOf(roomCode) !== socket.id) return;

  room.autoCallPaused = paused !== false;
  if (room.autoCallPaused) {
    // Drop what is waiting rather than releasing it all on unpause.
    const entry = watchers.forRoom(roomCode);
    if (entry && entry.queueRef) entry.queueRef.clear('auto-calling paused');
  }
  io.to(roomCode).emit('autoCallPaused', { paused: room.autoCallPaused });
  console.log(`🏈 room ${roomCode} auto-calling ${room.autoCallPaused ? 'PAUSED' : 'resumed'}`);
});

/**
 * Move one card between auto / suggest / off, for this room only.
 *
 * The dial the owner reaches for after a real game night, on a phone, while
 * nine people wait — so it is one event per card rather than a form to submit.
 */
socket.on('setCardMode', ({ roomCode, cardId, mode } = {}) => {
  const room = rooms[roomCode];
  if (!room || !cardId) return;
  if (refOf(roomCode) !== socket.id) return;
  if (!['auto', 'suggest', 'off'].includes(mode)) return;
  // A card with no signal cannot be turned on, whatever the dial says.
  if (modeFor(cardId) === 'never') return;

  if (!room.cardModes) room.cardModes = {};
  room.cardModes[cardId] = mode;
  io.to(roomCode).emit('cardModes', { cardModes: room.cardModes });
  console.log(`🏈 room ${roomCode}: ${cardId} -> ${mode}`);
});

/**
 * The Ref accepted a suggestion. Declares it exactly as an auto-call would;
 * ignoring one simply lets it expire, which needs no event at all.
 */
socket.on('acceptSuggestion', ({ roomCode, cardId } = {}) => {
  const room = rooms[roomCode];
  if (!room || !cardId) return;
  if (refOf(roomCode) !== socket.id) return;

  const path = pathFor(cardId);
  const result = path === 'firstDown' ? declareFirstDown(roomCode)
    : path === 'standard' ? declareStandardCard(roomCode, cardId)
      : declareWildCard(roomCode, cardId);

  if (result.reason === 'busy') io.to(socket.id).emit('actionInProgress', BUSY_MESSAGE);
  else if (result.ok) {
    // The Ref chose it, so it reads as the Ref's call, not the game's.
    tellRoundSource(roomCode, 'ref', cardId);
    console.log(`🏈 room ${roomCode}: Ref accepted suggestion ${cardId}`);
  }
});

socket.on('detachGame', ({ roomCode } = {}) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (refOf(roomCode) !== socket.id) return;

  const entry = watchers.forRoom(roomCode);
  const dropped = entry && entry.queueRef ? entry.queueRef.clear('the game was detached').dropped : 0;
  watchers.release(roomCode);
  room.watching = null;
  room.autoCallPaused = false;
  io.to(roomCode).emit('gameDetached', { roomCode, dropped });
  console.log(`🏈 room ${roomCode} stopped watching`);
});

socket.on('lockIn', ({ roomCode } = {}) => {
  const room = rooms[roomCode];
  const round = activeRounds[roomCode];
  if (!room || !round) return;

  const player = room.players.find(p => p.id === socket.id);
  if (!player) return;

  if (!round.lockedIn) round.lockedIn = {};
  round.lockedIn[player.name] = true;
  console.log(`🔒 ${player.name} locked in for the round in ${roomCode}`);

  maybeFinishRoundEarly(roomCode);
});

socket.on('requestGameState', ({ roomCode, playerName: claimedName } = {}) => {
  console.log(`Player ${socket.id} requested game state for room ${roomCode}${claimedName ? ` as ${claimedName}` : ''}`);
  const room = rooms[roomCode];
  if (!room) {
    console.log(`Room ${roomCode} not found`);
    return;
  }
  
  // Same snapshot as handleJoinRoom, and for the same reason. Here the fast
  // reconnect path overwrites the disconnected entry's id in place, so the old
  // id is gone from `room.players` by the time the merge below runs.
  const ownedSocketIds = roomSocketIds(room);

  /**
   * Re-join the socket.io room. THIS IS THE WHOLE BUG in T1.1.
   *
   * Room membership belongs to a CONNECTION, not a player. A reconnect is a
   * brand-new socket with a new id and zero rooms, and this handler — 240
   * lines of careful reconnect work — never joined it to anything.
   *
   * Direct emits still landed, because a socket always belongs to a room named
   * after its own id, so `roundState` and the pour replay arrived and the
   * screen looked right for a moment. Then every `io.to(roomCode)` broadcast
   * stopped: no updateTimer, no declaredCard, no updatePlayerStats, no
   * roundFinalized, no updatePlayers. The clock froze, and because
   * `assignerOpen` never went false the assigner stayed open for the rest of
   * the game with every tap pouring into whatever round was live.
   *
   * Joining before the identity work means it holds on every path below that
   * resolves a player, and is harmless on the paths that do not.
   */
  socket.join(roomCode);
  console.log(`🔌 ${socket.id} re-joined room ${roomCode}`);

  // Find the player in the room
  let player = room.players.find(p => p.id === socket.id);

  // If player is found, they're requesting game state (likely after reconnection)
  if (player) {
    console.log(`Player ${player.name} (${socket.id}) requesting game state - sending direct game state`);
    
    // Send game state directly without refresh signal to prevent infinite loops
    const room = rooms[roomCode];
    if (room && room.gameStarted) {
      // ✅ FIX: Send only card data in hands, not full playerStats
      // Resolve the whistle BEFORE building this payload (see above).
      if (player) ensureRefIsPresent(roomCode, { id: socket.id, name: player.name });
      socket.emit('gameStarted', {
        hostId: rooms[roomCode] ? rooms[roomCode].host : undefined,
        hands: { [socket.id]: {
          standard: playerStats[socket.id]?.standard || [],
          wild: playerStats[socket.id]?.wild || []
        }},
        playerStats: buildRoomStats(room)
      });
      
      // ✅ FIX: Send complete players list so reconnected player sees everyone
      socket.emit('updatePlayers', room.players);
      console.log(`📡 Sent complete players list to reconnected player ${player.name}`);
      
      console.log(`📡 Sent direct game state to player ${player.name} (${socket.id})`);
      
      // ✅ REMOVED: Auto-refresh after reconnection to prevent infinite loops
      // Let client-side stealth detection handle refreshes when truly needed
    } else {
      socket.emit('joinedRoom', roomCode);
      console.log(`📡 Sent lobby state to player ${player.name} (${socket.id})`);
    }
  }
  
  // Player might be reconnecting with a new socket ID
  if (!player) {
    // This room's former players, and only this room's.
    const possibleFormerPlayers = Object.values(formerPlayersIn(roomCode));
    
    /**
     * WHICH of those disconnected players is this socket?
     *
     * The payload used to be `{ roomCode }` with no name, so the server took
     * `returning` — whichever `Object.values` happened to list
     * first — and bound that seat, those stats and that outstanding pour to
     * this socket. With one person dropped, index 0 IS them, which is why this
     * was never seen. With two phones asleep in the same room, the first to
     * wake was handed the other's identity and the second was locked out of
     * their own game with "name already taken".
     *
     * Match on the name the client sends. Fall back to index 0 only when no
     * name is supplied, so a stale cached bundle still limps.
     *
     * NOTE: the fallback was written as a self-reference (`... : returning`),
     * which is a TDZ error, not a fallback — a no-name request threw
     * `Cannot access 'returning' before initialization` and the client got
     * nothing back at all. Every current client sends a name (App.js has five
     * emit sites, all with `playerName`), so this only ever fired for a stale
     * cached bundle.
     */
    const claimed = claimedName
      ? possibleFormerPlayers.find(p => p.name === claimedName)
      : null;
    if (claimedName && !claimed) {
      console.log(`⚠️ ${claimedName} claimed a seat in ${roomCode} but is not among the disconnected`);
    }
    const returning = claimed || (claimedName ? null : possibleFormerPlayers[0]);

    if (returning) {
      // ✅ FIX: Check if player already exists in room (as disconnected) before adding
      const existingDisconnectedPlayer = room.players.find(p => p.name === returning.name);
      
      if (existingDisconnectedPlayer) {
        // Player is already in room as disconnected - just update their socket ID and reconnect them
        console.log(`📡 Found existing disconnected player ${returning.name}, updating socket ID`);
        existingDisconnectedPlayer.id = socket.id;
        existingDisconnectedPlayer.disconnected = false;
        player = existingDisconnectedPlayer;
      } else {
        // Player not in room - add them back
        console.log(`📡 Adding former player ${returning.name} back to room`);
        player = { id: socket.id, name: returning.name };
        room.players.push(player);
      }
      
      // ✅ ROUND-AWARE FAST RECONNECTION: Handle mid-round reconnection in fast path
      if (activeRounds[roomCode]) {
        console.log(`🎯 FAST MID-ROUND RECONNECTION: Player ${returning.name} reconnecting during active round`);
        
        // Find old socket ID and create mapping — this room's entries only.
        const oldEntry = roomEntriesForName(ownedSocketIds, returning.name)
          .find(([, stats]) => stats.disconnected);
        
        if (oldEntry) {
          const oldSocketId = oldEntry[0];
          if (!socketIdMappings[roomCode]) {
            socketIdMappings[roomCode] = {};
          }
          socketIdMappings[roomCode][oldSocketId] = socket.id;
          console.log(`🎯 FAST: Created socket mapping: ${oldSocketId.slice(-4)} → ${socket.id.slice(-4)}`);
          
          // Send current declared card and round state
          socket.emit('declaredCard', activeRounds[roomCode].declaredCard);
          console.log(`🎯 FAST: Sent declared card "${activeRounds[roomCode].declaredCard}" to reconnected player`);
          
          const timeElapsed = Math.floor((Date.now() - activeRounds[roomCode].startTime) / 1000);
          const timeRemaining = Math.max(0, activeRounds[roomCode].timeRemaining - timeElapsed);
          
          if (timeRemaining > 0) {
            socket.emit('roundState', {
              timeRemaining: timeRemaining,
              roundInProgress: true,
              declaredCard: activeRounds[roomCode].declaredCard
            });
            console.log(`🎯 FAST: Sent round state: ${timeRemaining}s remaining`);
          }
        }
      }
      
      // ✅ ENHANCED: Use same merge logic as handleJoinRoom to preserve accumulated drinks
      const playerName = returning.name;
      console.log(`🔍 FAST RECONNECT MERGE: Looking for accumulated stats for ${playerName}`);
      console.log(`🔍 FAST RECONNECT MERGE: All playerStats:`, Object.entries(playerStats).map(([id, stats]) => 
        `${id.slice(-4)}: ${JSON.stringify({totalDrinks: stats.totalDrinks, name: stats.name, disconnected: stats.disconnected})}`
      ));
      
      // Entries for this player name IN THIS ROOM. Matching on name alone
      // spans every game on the server — see the same fix in handleJoinRoom.
      const allPlayerEntries = roomEntriesForName(ownedSocketIds, playerName);
      
      console.log(`🔍 FAST RECONNECT MERGE: All entries for player name "${playerName}":`, allPlayerEntries.map(([id, stats]) => 
        `${id.slice(-4)}: ${stats.totalDrinks || 0} drinks, disconnected: ${stats.disconnected}, name: ${stats.name}`
      ));
      
      // Find the entry with the highest totalDrinks for this specific player
      const maxDrinksEntry = allPlayerEntries.length > 0 
        ? allPlayerEntries.reduce((max, current) => {
            const currentDrinks = current[1].totalDrinks || 0;
            const maxDrinks = max ? max[1].totalDrinks || 0 : 0;
            return currentDrinks > maxDrinks ? current : max;
          })
        : null;
      
      console.log(`🔍 FAST RECONNECT MERGE: Max drinks entry:`, maxDrinksEntry ? 
        `${maxDrinksEntry[0].slice(-4)}: ${maxDrinksEntry[1].totalDrinks} drinks` : 'none'
      );
      
      // Use disconnected playerStats as authoritative source, fall back to formerPlayers
      const finalDrinks = maxDrinksEntry ? maxDrinksEntry[1].totalDrinks || 0 : returning.totalDrinks || 0;
      const finalShotguns = maxDrinksEntry ? maxDrinksEntry[1].totalShotguns || 0 : returning.totalShotguns || 0;
      
      console.log(`🔄 FAST RECONNECT MERGE: ${playerName} - Using accumulated stats: ${finalDrinks} drinks (formerPlayers had ${returning.totalDrinks || 0} drinks)`);

      // Restore their data with preserved accumulated stats
      playerStats[socket.id] = {
        totalDrinks: finalDrinks,
        totalShotguns: finalShotguns,
        standard: returning.standard || [],
        wild: returning.wild || []
      };
      
      // ✅ FAST RECONNECTION FIX: Check if reconnecting player has the declared card and can assign drinks
      if (activeRounds[roomCode]) {
        const declaredCard = activeRounds[roomCode].declaredCard;
      
        // Replay exactly what this player was told to pour when the card was
        // played. This CANNOT be re-derived from their current hand: the played
        // cards are removed and replaced the instant they are played, so the
        // hand no longer shows what was played. Filtering it gave a refreshing
        // player either nothing at all (usually) or, when the replacement draw
        // happened to redeal the same card type, a prompt for an amount they
        // never played.
        if (declaredCard !== 'First Down') {
          const pending = pendingPourFor(roomCode, playerName);
          if (pending) {
            socket.emit('distributeDrinks', { playerId: socket.id, ...pending });
            console.log(`🎯 FAST REPLAY: sent {${pending.drinkCount}} drinks, {${pending.shotguns}} shotguns to reconnected ${playerName} for ${declaredCard}`);
          } else {
            console.log(`🎯 FAST REPLAY: ${playerName} owes nothing this round for ${declaredCard}`);
          }
        }
      }
      
      console.log(`Reconnected player ${socket.id} to room ${roomCode}`);
      console.log(`🔧 DEBUG: Room ${roomCode} now has ${room.players.length} players:`, room.players.map(p => `${p.name}(${p.id}, disconnected: ${p.disconnected})`));
      
      // ✅ NEW: Force refresh for players reconnecting from formerPlayers (stealth disconnect recovery)
      setTimeout(() => {
        socket.emit('forceRefresh', { 
          reason: 'Reconnected after stealth disconnect - refreshing to ensure clean UI state',
          playerName: returning.name
        });
        console.log(`📡 Sent forceRefresh command to formerly disconnected player ${returning.name} (${socket.id})`);
      }, 1000); // Small delay to ensure all data is sent first
      
      // Send game state directly to reconnected player without refresh signal
      if (room.gameStarted) {
        // ✅ FIX: Send only card data in hands, not full playerStats
        // Resolve the whistle BEFORE building this payload, or it carries a
        // stale host id and the client has to be corrected by a later newHost.
        if (player) ensureRefIsPresent(roomCode, { id: socket.id, name: player.name });
        socket.emit('gameStarted', {
        hostId: rooms[roomCode] ? rooms[roomCode].host : undefined,
          hands: { [socket.id]: {
            standard: playerStats[socket.id]?.standard || [],
            wild: playerStats[socket.id]?.wild || []
          }},
          playerStats: buildRoomStats(room)
        });
        
        // ✅ FIX: Send complete players list so reconnected player sees everyone
        socket.emit('updatePlayers', room.players);
        console.log(`📡 Sent complete players list to reconnected player ${returning.name}`);
        
        console.log(`📡 Sent direct game state to reconnected player ${returning.name} (${socket.id})`);
        
        // ✅ REMOVED: Auto-refresh after reconnection to prevent infinite loops
        // Let client-side stealth detection handle refreshes when truly needed
      } else {
        socket.emit('joinedRoom', roomCode);
        console.log(`📡 Sent lobby state to reconnected player ${returning.name} (${socket.id})`);
      }
      
      // Remove from formerPlayers and clean up any old playerStats
      forgetFormerPlayer(roomCode, returning.name);
      
      // ✅ ENHANCED CLEANUP: Only clean up entries that specifically belong to this player name
      allPlayerEntries.forEach(([oldSocketId, oldStats]) => {
        if (oldSocketId !== socket.id && oldStats.name === playerName) { // Extra safety check
          console.log(`🧹 FAST RECONNECT CLEANUP: Removing old entry for ${playerName} (${oldSocketId.slice(-4)}) with ${oldStats.totalDrinks || 0} drinks, name: ${oldStats.name}`);
          delete playerStats[oldSocketId];
        }
      });
    } else {
      console.log(`Unable to find player data for ${socket.id}`);
      return;
    }
  }
  
  // Send the current game state to the reconnected player
  socket.emit('updatePlayerHand', { 
    standard: playerStats[socket.id]?.standard || [], 
    wild: playerStats[socket.id]?.wild || [] 
  });
  
  // ✅ REMOVED: updatePlayerStats on requestGameState - only send on round completion
  // Player stats will be current when next round ends
  
  // Send current quarter
  socket.emit('quarterUpdated', room.quarter || 1);
  
  // No more refresh signals - game state already sent above
  console.log(`✅ Game state sent to reconnected player ${player.name} (${socket.id})`);
  
  // Notify all other players about the reconnection
  socket.to(roomCode).emit('playerRejoined', { 
    playerId: socket.id, 
    playerName: player.name 
  });
});

// ✅ REMOVED requestGameSync handler - no longer needed, gameStarted handles everything

// Handle Player Disconnection 
socket.on('disconnect', (reason) => {
  
  console.log(`User disconnected: ${socket.id}. Reason: ${reason}`);
  
    for (let roomCode in rooms) {
      const room = rooms[roomCode];
      
      // Ensure the room and players array are valid before proceeding
      if (room && room.players) {
        const players = room.players;
        const playerIndex = players.findIndex(player => player.id === socket.id);
  
        if (playerIndex !== -1) {
          const leavingPlayer = players[playerIndex]; // Get the disconnecting player

          // Log player stats and hands before disconnecting
          console.log(`Saving stats for leaving player ${leavingPlayer.name} with ID ${socket.id}`);
          console.log(playerStats[socket.id]);
          console.log("Player array:", players);

          // ✅ ENHANCED DISCONNECT: this player's maximum accumulated stats.
          //
          // This filter used to match on NAME ALONE with no room narrowing —
          // the one site of five that `roomEntriesForName` was never applied
          // to. It would take the highest-scoring stranger of the same name
          // from any game on the server and copy THEIR hand and totals into
          // this player's snapshot.
          //
          // The socket's own entry is added explicitly because `startGame`
          // does not stamp a name onto it; the name arrives further down, in
          // this same handler. That is what the old `|| id === socket.id`
          // clause was carrying, and it is still load-bearing.
          const ownedSocketIds = roomSocketIds(room);
          const allPlayerEntries = roomEntriesForName(ownedSocketIds, leavingPlayer.name);
          if (playerStats[socket.id] && !allPlayerEntries.some(([id]) => id === socket.id)) {
            allPlayerEntries.push([socket.id, playerStats[socket.id]]);
          }
          
          // Find the entry with highest totalDrinks (most accumulated)
          const maxDrinksEntry = allPlayerEntries.reduce((max, current) => {
            const currentDrinks = current[1].totalDrinks || 0;
            const maxDrinks = max ? max[1].totalDrinks || 0 : 0;
            return currentDrinks > maxDrinks ? current : max;
          }, null);
          
          const maxStats = maxDrinksEntry ? maxDrinksEntry[1] : playerStats[socket.id];
          console.log(`💾 DISCONNECT SAVE: Found max stats for ${leavingPlayer.name}: ${maxStats.totalDrinks} drinks from ${maxDrinksEntry ? maxDrinksEntry[0].slice(-4) : socket.id.slice(-4)}`);

          // Store player data against THIS ROOM, with maximum accumulated stats
          rememberFormerPlayer(roomCode, {
            id: socket.id,  // Current socket ID (for reference)
            name: leavingPlayer.name,
            totalDrinks: maxStats.totalDrinks || 0,
            totalShotguns: maxStats.totalShotguns || 0,
            standard: maxStats.standard || [],
            wild: maxStats.wild || []
          });
          console.log(`Former players in ${roomCode}:`, Object.keys(formerPlayersIn(roomCode)));

          // Mark player as disconnected but keep them in the game for drink assignments
          players[playerIndex].disconnected = true;
          players[playerIndex].disconnectedAt = Date.now();
          
          // Keep player stats but mark them as disconnected and ensure name is stored
          if (playerStats[socket.id]) {
            playerStats[socket.id].disconnected = true;
            playerStats[socket.id].name = leavingPlayer.name; // Ensure name is stored for reconnection
          }
          
          console.log(`Player ${leavingPlayer.name} marked as disconnected but kept in game`);
  
          // Check if no ACTIVE players are left (all disconnected)
          const activePlayers = players.filter(p => !p.disconnected);
          if (activePlayers.length === 0) {
            io.to(roomCode).emit('gameOver', 'All players have disconnected. Game will remain open for reconnections.');
            console.log(`All players disconnected from room ${roomCode}. Room kept alive for reconnections.`);
            // Don't delete the room - keep it for reconnections
            return;
          }

          // If the game has NOT started (still in the lobby)
          if (!room.gameStarted) {
            if (room.host === socket.id) {
              // The lobby used to close here. A host whose phone locks during
              // the pre-game shuffle is the most ordinary thing at a real table.
              handOverWhistle(roomCode, 'The host has disconnected. A new host has been assigned.');
            }
            io.to(roomCode).emit('updatePlayers', players);
          } else {
            // If the game HAS started, handle the disconnection accordingly
            if (room.host === socket.id) {
              // If the host disconnects during the game, reassign host to another ACTIVE player
              const activePlayersForHost = players.filter(p => !p.disconnected);
              if (activePlayersForHost.length > 0) {
                room.host = activePlayersForHost[0].id; // Assign the first active player as the new host
                
                // ✅ FIXED: Only send lightweight notification about disconnection (not full state updates)
                console.log(`📡 Host ${leavingPlayer.name} disconnected, new host assigned to ${room.host}`);
                io.to(roomCode).emit('newHost', { newHostId: room.host, message: 'The host has disconnected. A new host has been assigned.' });
              } else {
                // If no active players are left, keep room alive but notify
                io.to(roomCode).emit('gameOver', 'All players have disconnected. Game will remain open for reconnections.');
              }
            } else {
              // A non-host dropped. Tell the room.
              //
              // This used to broadcast NOTHING, on the reasoning that a roster
              // update caused "UI churn". The cost was that every other client
              // kept a roster where this player was `disconnected: undefined`
              // for the rest of the game — so the Ref's handoff sheet, which
              // filters on `!p.disconnected`, happily offered a player who had
              // left the building, and the game stopped when the whistle
              // landed on an empty chair.
              //
              // `updatePlayers` is the right event rather than a lighter
              // targeted one: it is the roster, the roster genuinely changed,
              // it is already broadcast from five other sites, and the client's
              // handler preserves each player's cards (Session 8), so there is
              // no churn left to avoid.
              console.log(`📡 Non-host player ${leavingPlayer.name} (${socket.id}) disconnected from game in progress.`);
              io.to(roomCode).emit('updatePlayers', players);
            }
          }

          // Update player hands for the remaining ACTIVE players
          room.players.forEach((player) => {
            if (!player.disconnected) {
              const playerHand = playerStats[player.id];
              if (playerHand) {
                io.to(player.id).emit('updatePlayerHand', { standard: playerHand.standard, wild: playerHand.wild });
                console.log(`New hand for player ${player.id}:`, playerHand.standard);
              }
            }
          });
          
          // ✅ REMOVED: updatePlayerStats on disconnect - only send on round completion
        }
      }
    }
});

// ✅ NEW: Handle client requests for forced refresh (prevents infinite loops)
const refreshCooldowns = new Map(); // Track recent refresh requests

socket.on('requestRefresh', ({ roomCode, playerName, reason } = {}) => {
  console.log(`🔄 Client ${playerName} (${socket.id}) requesting refresh: ${reason}`);
  
  // Check cooldown to prevent loops (1 refresh per 5 seconds per player)
  const cooldownKey = `${roomCode}-${playerName}`;
  const now = Date.now();
  const lastRefresh = refreshCooldowns.get(cooldownKey);
  
  if (lastRefresh && (now - lastRefresh) < 5000) {
    console.log(`⏳ Refresh cooldown active for ${playerName}, ignoring request`);
    return;
  }
  
  // Set cooldown
  refreshCooldowns.set(cooldownKey, now);
  
  // Send the forceRefresh event
  socket.emit('forceRefresh', { 
    reason: `Client requested: ${reason}`,
    playerName: playerName
  });
  console.log(`📡 Sent forceRefresh command to ${playerName} (${socket.id}) due to: ${reason}`);
  
  // Clean up old cooldown entries (every 10 requests)
  if (refreshCooldowns.size > 10) {
    const tenSecondsAgo = now - 10000;
    for (const [key, timestamp] of refreshCooldowns.entries()) {
      if (timestamp < tenSecondsAgo) {
        refreshCooldowns.delete(key);
      }
    }
  }
});

});


// Shuffle deck
const shuffle = (deck) => {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

// Check deck sizes and replenish if needed
const checkAndReplenishDecks = (roomCode) => {
  const room = rooms[roomCode];
  if (!room || !room.deck) return;
  
  const { standardDeck, wildDeck } = room.deck;
  const roomUsedCards = usedCards[roomCode] || { standard: [], wild: [] };
  
  // Debug: Log current deck sizes
  console.log(`Room ${roomCode} - Standard deck: ${standardDeck.length} cards, Used: ${roomUsedCards.standard.length} cards`);
  console.log(`Room ${roomCode} - Wild deck: ${wildDeck.length} cards, Used: ${roomUsedCards.wild.length} cards`);
  
  // Check standard deck
  if (standardDeck.length <= 12 && roomUsedCards.standard.length > 0) {
    console.log(`🔄 DECK REPLENISHMENT: Standard deck low (${standardDeck.length} cards). Shuffling ${roomUsedCards.standard.length} used cards back in.`);
    standardDeck.push(...roomUsedCards.standard);
    shuffle(standardDeck);
    roomUsedCards.standard = [];
    console.log(`✅ Standard deck replenished. New size: ${standardDeck.length} cards.`);
  }
  
  // Check wild deck
  if (wildDeck.length <= 12 && roomUsedCards.wild.length > 0) {
    console.log(`🔄 DECK REPLENISHMENT: Wild deck low (${wildDeck.length} cards). Shuffling ${roomUsedCards.wild.length} used cards back in.`);
    wildDeck.push(...roomUsedCards.wild);
    shuffle(wildDeck);
    roomUsedCards.wild = [];
    console.log(`✅ Wild deck replenished. New size: ${wildDeck.length} cards.`);
  }
  
  // Update the used cards storage
  usedCards[roomCode] = roomUsedCards;
};

// Generate separate Standard and Wild decks based on the number of players
const generateDecks = (playerCount) => {
  const standardDeck = [];
  const wildDeck = [];

  // Standard cards
  for (let i = 0; i < 7 * playerCount; i++) standardDeck.push({ type: 'Standard', card: 'Touchdown', drinks: 3 });
  for (let i = 0; i < 6 * playerCount; i++) standardDeck.push({ type: 'Standard', card: 'Field Goal', drinks: 2 });
  for (let i = 0; i < 5 * playerCount; i++) standardDeck.push({ type: 'Standard', card: 'Turnover', drinks: 4 });
  for (let i = 0; i < 8 * playerCount; i++) standardDeck.push({ type: 'Standard', card: 'Sacks', drinks: 2 });
  for (let i = 0; i < 9 * playerCount; i++) standardDeck.push({ type: 'Standard', card: 'Penalty', drinks: 1 });

  // Wild cards
  for (let i = 0; i < 5 * playerCount; i++) wildDeck.push({ type: 'Wild', card: 'Big Play 20+', drinks: 5 });
  for (let i = 0; i < 3 * playerCount; i++) wildDeck.push({ type: 'Wild', card: 'Big Play 50+', drinks: 10 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Blocked Kicks', drinks: 10 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Special Teams TD', drinks: 20 });
  for (let i = 0; i < 3 * playerCount; i++) wildDeck.push({ type: 'Wild', card: 'Onside Attempt', drinks: 10 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Onside Recovered', drinks: 40 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Record Broken', drinks: 40 });
  for (let i = 0; i < 2 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Doink', drinks: 40 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Disqualified', drinks: 20 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Penalty Calls TD Back', drinks: 10 });
  for (let i = 0; i < 5 * playerCount; i++) wildDeck.push({ type: 'Wild', card: 'Turnover on Downs', drinks: 10 });
  for (let i = 0; i < 4 * playerCount; i++) wildDeck.push({ type: 'Wild', card: 'Missed FG', drinks: 5 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Missed PAT', drinks: 6 });
  for (let i = 0; i < 6 * playerCount; i++) wildDeck.push({ type: 'Wild', card: '3 n Out', drinks: 4 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Safety', drinks: 20 });
  for (let i = 0; i < 3 * playerCount; i++) wildDeck.push({ type: 'Wild', card: 'Fake Punt/FG', drinks: 10 });
  for (let i = 0; i < 1 * playerCount; i++)wildDeck.push({ type: 'Wild', card: 'Defensive TD', drinks: 20 });
  for (let i = 0; i < 3 * playerCount; i++) wildDeck.push({ type: 'Wild', card: '2 PT Conversion', drinks: 5 });

  return { standardDeck, wildDeck };
};

// Distribute exactly 5 standard and 2 wild cards to players
const distributeCards = (players, standardDeck, wildDeck) => {
  const shuffledStandardDeck = shuffle(standardDeck);
  const shuffledWildDeck = shuffle(wildDeck);
  const hands = {};

  players.forEach(player => {
    hands[player.id] = {
      standard: shuffledStandardDeck.splice(0, 5),  // Deal 5 standard cards
      wild: shuffledWildDeck.splice(0, 2)           // Deal 2 wild cards
    };

    playerStats[player.id].standard = hands[player.id].standard;
    playerStats[player.id].wild = hands[player.id].wild;

    console.log(`Player ${player.id} was dealt ${hands[player.id].standard.length} standard cards and ${hands[player.id].wild.length} wild cards.`);
  });

  return hands;
};

/**
 * Which commit is actually running.
 *
 * `node server.js` does not hot-reload — only the CRA dev server does — so it
 * is entirely possible to spend an evening debugging a fix that is not loaded.
 * That has now cost two sessions. This line is permanent: read it before
 * trusting anything you observe against a running server.
 *
 * Reads .git directly rather than shelling out, so it works with no git binary
 * on PATH. Render exposes the SHA as an env var instead, since its checkout is
 * shallow, so that wins when present.
 *
 * CAVEAT: this reports the CHECKED-OUT COMMIT, not the working tree. If you
 * have edited server.js without committing, the SHA is still the last commit.
 * It answers "is this a stale process?", not "is this file dirty?".
 */
const bootCommit = () => {
  const fromEnv = process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION;
  if (fromEnv) return `${fromEnv.slice(0, 7)} (from env)`;
  try {
    const head = fs.readFileSync(path.join(__dirname, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.slice(0, 7);
    const ref = head.slice(5).trim();
    const sha = fs.readFileSync(path.join(__dirname, '.git', ref), 'utf8').trim();
    return `${sha.slice(0, 7)} (${ref.replace('refs/heads/', '')})`;
  } catch (err) {
    return 'unknown';
  }
};

/**
 * One bad message must not end everybody's night.
 *
 * A single process hosts every concurrent game, so an unhandled throw in any
 * socket handler kills every room on the box — the same blast radius as the
 * startGame crash this branch was created to fix. Staying up turns "every game
 * dies" into "one action failed".
 *
 * This is a backstop, not a licence to stop guarding inputs. Anything it
 * catches is a bug and the log says so loudly.
 */
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION — staying up. This is a bug, fix it:');
  console.error(err && err.stack ? err.stack : err);
  console.error(`   rooms currently open: ${Object.keys(rooms).join(', ') || 'none'}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 UNHANDLED REJECTION — staying up. This is a bug, fix it:');
  console.error(reason && reason.stack ? reason.stack : reason);
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Running code: ${bootCommit()}  |  node ${process.version}  |  started ${new Date().toISOString()}`);
  // The replay seam lets ANY socket attach an arbitrary fixture to ANY room,
  // bypassing the Ref-only rule. Off by default — but off-by-default is worth
  // much less than visible-if-on, because the failure mode is somebody setting
  // it and nobody noticing. Same `=== '1'` test as the guard itself, so the
  // banner can never claim "off" while the seam is open.
  if (process.env.ALLOW_REPLAY_ATTACH === '1') {
    console.log('⚠️  ALLOW_REPLAY_ATTACH=1 — replay attach is OPEN: any socket can '
      + 'attach a fixture to any room, without the whistle. NOT FOR PRODUCTION.');
  }
});