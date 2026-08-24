const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path'); // Import the path module
const fs = require('fs');
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
  maxHttpBufferSize: 1e8,
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
const formerPlayers = {};  // Store former players by name when they disconnect
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

// Finalize round logic
const finalizeRound = (roomCode) => {
    // Get the room from the rooms object
    const room = rooms[roomCode];  
    if (!room) {
      console.log(`Room ${roomCode} not found for finalization.`);
      return;
    }

 
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
      console.log(`Results stats for player ${playerId}:`, roundResults[roomCode][playerId]);
      console.log(`Result stats for player ${playerId}:`, roundResult);


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
    }, 1000);
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
  
  // Handle heartbeat acknowledgement
  socket.on('heartbeat-ack', () => {
    // We could track the round-trip time here if needed
    console.log(`Heartbeat acknowledged by ${socket.id}`);
  });
  
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
    rooms[roomCode] = { players: [{ id: socket.id, name: playerName }], host: socket.id,   isActionInProgress: false, wildSwapQuarter: {} };
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

  // ✅ SIMPLE RECONNECTION: Check if player exists in formerPlayers
  console.log(`🔍 DEBUG: Checking formerPlayers for ${playerName}:`);
  console.log(`🔍 DEBUG: formerPlayers keys:`, Object.keys(formerPlayers));
  console.log(`🔍 DEBUG: formerPlayer data:`, formerPlayers[playerName]);
  
  const formerPlayer = formerPlayers[playerName];
  if (formerPlayer && formerPlayer.roomCode === roomCode) {
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
    
    delete formerPlayers[playerName];
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
      
      socket.emit('gameStarted', {
        hands: { [socket.id]: handData },
        playerStats: playerStats
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
      hands: { [socket.id]: {
        standard: playerStats[socket.id].standard,
        wild: playerStats[socket.id].wild
      }},
      playerStats: playerStats
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

        
    
        players.splice(playerIndex, 1);
        socket.leave(roomCode);
        delete playerStats[socket.id];  // Remove player stats
        console.log(`Player ${socket.id} left room ${roomCode}`);


        if (rooms[roomCode].players.length === 0) {
          delete rooms[roomCode];
          delete usedCards[roomCode];  // Clean up used cards storage
          console.log(`Room ${roomCode} deleted`);
        } else if (rooms[roomCode].host === socket.id) {
          io.to(roomCode).emit('hostLeft', 'The host has left the game. Lobby is closing.');
          delete rooms[roomCode];  // Delete the room when the host leaves
          delete usedCards[roomCode];  // Clean up used cards storage
          console.log(`Host left. Room ${roomCode} closed.`);
        } else {
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
        hands,         // The player hands
        playerStats    // The initial player stats with totals set to 0
      });

    // Log that the game has started
    console.log(`Game started in room ${roomCode}. GameStarted flag set to true.`);
  } else {
    console.log(`Unable to start game in room ${roomCode}. Ensure at least 3 players.`);
  }
  });

  // Handle assigning a new host
socket.on('assignNewHost', ({ roomCode, newHostId }) => {
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
socket.on('nextQuarter', ({ roomCode }) => {
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
socket.on('wildCardSwap', ({ roomCode, discardedCard }) => {
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
   const cardIndex = playerHand.wild.findIndex(card => card.card === discardedCard.card && card.drinks === discardedCard.drinks);
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
socket.on('firstDownEvent', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
  
    // Ensure roundResults[roomCode] is initialized
    if (!roundResults[roomCode]) {
      roundResults[roomCode] = {};
    }

    // Check if an action is already in progress
  if (room.isActionInProgress) {
    io.to(socket.id).emit('actionInProgress', 'Action is in progress. Please wait until the round ends.');
    return;
  }
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

  });

  // Play Standard Card Event (Triggered by the host)
  socket.on('playStandardCard', ({ roomCode, cardType }) => {
    const room = rooms[roomCode];
    if (!room) return;

      // Check if an action is already in progress
      if (room.isActionInProgress) {
        // Emit a message to the frontend asking the player to wait
        io.to(socket.id).emit('actionInProgress', 'Action is in progress. Please wait until the round ends.');
        return;
      }
  
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

});
// Handle wild card selection
socket.on('wildCardSelected', ({ roomCode, playerId, wildcardtype }) => {
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
socket.on('wildCardConfirmed', ({ roomCode, wildcardtype, player }) => {
    const room = rooms[roomCode];
    if (!room) return;

    // Check if an action is already in progress
    if (room.isActionInProgress) {
        // Emit a message to the frontend asking the player to wait
        io.to(socket.id).emit('actionInProgress', 'Action is in progress. Please wait until the round ends.');
        return;
    }

    console.log(`Host confirmed wild card: ${wildcardtype} by player ${player}`);
    
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
});

// Handle drink and shotgun assignments for a round
socket.on('assignDrinks', ({ roomCode, selectedPlayerIds, drinksToGive, shotgunsToGive }) => {
    const room = rooms[roomCode];
    if (!room) return;
  
    if (!roundResults[roomCode]) {
      roundResults[roomCode] = {};  // Initialize for each round
    }
    
    // ✅ DEBUGGING: Enhanced logging for socket ID mapping issues
    console.log(`\n🍺 ASSIGN DRINKS DEBUG - Room ${roomCode}`);
    console.log(`🍺 Assigner: ${socket.id.slice(-4)} (${socket.id})`);
    console.log(`🍺 Selected player IDs:`, selectedPlayerIds.map(id => id.slice(-4)));
    console.log(`🍺 Drinks to give:`, drinksToGive);
    console.log(`🍺 Shotguns to give:`, shotgunsToGive);
    console.log(`🍺 Active socket mappings:`, socketIdMappings[roomCode] ? Object.entries(socketIdMappings[roomCode]).map(([old, new_]) => `${old.slice(-4)}→${new_.slice(-4)}`) : 'none');
    console.log(`🍺 Current round results:`, Object.entries(roundResults[roomCode] || {}).map(([id, data]) => `${id.slice(-4)}:${JSON.stringify(data)}`));

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
    
    console.log(`🍺 Resolved player IDs:`, resolvedPlayerIds.map(id => id.slice(-4)));
    
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
        console.log(`Initializing round results for player ${selectedPlayerId}`);
      } 
  
      // Add drinks to the player's round results, if applicable
      if (resolvedDrinksToGive && resolvedDrinksToGive[selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId].drinks += resolvedDrinksToGive[selectedPlayerId];
        console.log(`Player ${selectedPlayerId} received ${resolvedDrinksToGive[selectedPlayerId]} drinks.`);
  
        // Check if player reached or exceeded 10 drinks in this round
        if (roundResults[roomCode][selectedPlayerId].drinks >= 10) {
          // Player needs to shotgun
          roundResults[roomCode][selectedPlayerId].shotguns += 1;
          roundResults[roomCode][selectedPlayerId].drinks -= 10;  // Reduce drinks by 10
          console.log(`Player ${selectedPlayerId} reached 10 drinks and has to shotgun!`);
        }
      }
      console.log("resolved shotguns to give", resolvedShotgunsToGive, "for selectedPlayerId", selectedPlayerId.slice(-4), "value:", resolvedShotgunsToGive[selectedPlayerId]);

      // Add shotguns to the player's round results, if applicable
      if (resolvedShotgunsToGive && resolvedShotgunsToGive[selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId].shotguns += resolvedShotgunsToGive[selectedPlayerId];
        console.log(`Player ${selectedPlayerId} received ${resolvedShotgunsToGive[selectedPlayerId]} shotguns.`);
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
    if (giver) {
      const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      settlePendingPour(roomCode, giver.name, sum(drinksToGive), sum(shotgunsToGive));
    }

    console.log(`Current round results for room ${roomCode}:`, roundResults[roomCode]);
  });

  // Log player hands
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

  // Log player stats for drinks/shotguns
  const logPlayerStats = (players) => {
    console.log('Player stats:');
    players.forEach(player => {
      const stats = playerStats[player.id];
      console.log(`${player.name} - Drinks: ${stats.drinks}, Shotguns: ${stats.shotguns}`);
    });
  };

  // Handle custom 'leaveGame' event
socket.on('leaveGame', ({ roomCode }) => {
    console.log(`Player ${socket.id} has left the game manually.`);
    
    const room = rooms[roomCode];
    if (!room) return;  // If the room doesn't exist, do nothing
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    if (playerIndex === -1) return; // If player is not found, do nothing

    const leavingPlayer = room.players[playerIndex];

    // Log player stats and hands before disconnecting
    console.log(`Saving stats for leaving player ${leavingPlayer.name} with ID ${socket.id}`);
    console.log(playerStats[socket.id]);
    console.log("Player array:", room.players);

    // Store player data in formerPlayers by their name
    formerPlayers[leavingPlayer.name] = {
      id: socket.id,  // Original socket ID (for reference)
      name: leavingPlayer.name,
      roomCode: roomCode,            // Last room the player was in
      totalDrinks: playerStats[socket.id].totalDrinks || 0,
      totalShotguns: playerStats[socket.id].totalShotguns || 0,
      standard: playerStats[socket.id].standard || [],
      wild: playerStats[socket.id].wild || []
    };
    console.log("Former Players:", formerPlayers);


    // Find and remove the player by their socket ID
    room.players = room.players.filter(player => player.id !== socket.id);

    delete playerStats[socket.id];  // Remove player stats
    // Check if only no player is left
    if (room.players.length === 0) {
        io.to(roomCode).emit('gameOver', 'The game is ending as no player is left.');
        delete rooms[roomCode];  // End the game and delete the room
        delete usedCards[roomCode];  // Clean up used cards storage
        console.log(`Room ${roomCode} deleted because only one player is left.`);
        // ✅ REMOVED: updatePlayerStats on game over - no need when game ends
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
        // If no players are left, end the game and delete the room
        io.to(roomCode).emit('gameOver', 'The game is ending as all other players have disconnected.');
        delete rooms[roomCode];
        delete usedCards[roomCode];  // Clean up used cards storage
        console.log(`Room ${roomCode} deleted as no players are left.`);
      }
    } else {
      // Notify the remaining players that a player has left
      io.to(roomCode).emit('playerLeft', { playerId: socket.id, remainingPlayers: room.players });

      console.log(`Player ${socket.id} left the game in progress.`);
    }

    // Update the hands of the remaining players
    room.players.forEach(player => {
      const playerHand = playerStats[player.id];
      io.to(player.id).emit('updatePlayerHand', { standard: playerHand.standard, wild: playerHand.wild });
      // ✅ REMOVED: updatePlayerStats on disconnect - only send on round completion
    });
});

// Add this handler in the io.on('connection') block
// In server.js - update the requestGameState handler to be more robust
socket.on('requestGameState', ({ roomCode }) => {
  console.log(`Player ${socket.id} requested game state for room ${roomCode}`);
  const room = rooms[roomCode];
  if (!room) {
    console.log(`Room ${roomCode} not found`);
    return;
  }
  
  // Same snapshot as handleJoinRoom, and for the same reason. Here the fast
  // reconnect path overwrites the disconnected entry's id in place, so the old
  // id is gone from `room.players` by the time the merge below runs.
  const ownedSocketIds = roomSocketIds(room);

  // Find the player in the room
  let player = room.players.find(p => p.id === socket.id);

  // If player is found, they're requesting game state (likely after reconnection)
  if (player) {
    console.log(`Player ${player.name} (${socket.id}) requesting game state - sending direct game state`);
    
    // Send game state directly without refresh signal to prevent infinite loops
    const room = rooms[roomCode];
    if (room && room.gameStarted) {
      // ✅ FIX: Send only card data in hands, not full playerStats
      socket.emit('gameStarted', {
        hands: { [socket.id]: {
          standard: playerStats[socket.id]?.standard || [],
          wild: playerStats[socket.id]?.wild || []
        }},
        playerStats: playerStats
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
    // Look in formerPlayers for a potential match by room
    const possibleFormerPlayers = Object.values(formerPlayers)
      .filter(p => p.roomCode === roomCode);
    
    if (possibleFormerPlayers.length > 0) {
      // ✅ FIX: Check if player already exists in room (as disconnected) before adding
      const existingDisconnectedPlayer = room.players.find(p => p.name === possibleFormerPlayers[0].name);
      
      if (existingDisconnectedPlayer) {
        // Player is already in room as disconnected - just update their socket ID and reconnect them
        console.log(`📡 Found existing disconnected player ${possibleFormerPlayers[0].name}, updating socket ID`);
        existingDisconnectedPlayer.id = socket.id;
        existingDisconnectedPlayer.disconnected = false;
        player = existingDisconnectedPlayer;
      } else {
        // Player not in room - add them back
        console.log(`📡 Adding former player ${possibleFormerPlayers[0].name} back to room`);
        player = { id: socket.id, name: possibleFormerPlayers[0].name };
        room.players.push(player);
      }
      
      // ✅ ROUND-AWARE FAST RECONNECTION: Handle mid-round reconnection in fast path
      if (activeRounds[roomCode]) {
        console.log(`🎯 FAST MID-ROUND RECONNECTION: Player ${possibleFormerPlayers[0].name} reconnecting during active round`);
        
        // Find old socket ID and create mapping — this room's entries only.
        const oldEntry = roomEntriesForName(ownedSocketIds, possibleFormerPlayers[0].name)
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
      const playerName = possibleFormerPlayers[0].name;
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
      const finalDrinks = maxDrinksEntry ? maxDrinksEntry[1].totalDrinks || 0 : possibleFormerPlayers[0].totalDrinks || 0;
      const finalShotguns = maxDrinksEntry ? maxDrinksEntry[1].totalShotguns || 0 : possibleFormerPlayers[0].totalShotguns || 0;
      
      console.log(`🔄 FAST RECONNECT MERGE: ${playerName} - Using accumulated stats: ${finalDrinks} drinks (formerPlayers had ${possibleFormerPlayers[0].totalDrinks || 0} drinks)`);

      // Restore their data with preserved accumulated stats
      playerStats[socket.id] = {
        totalDrinks: finalDrinks,
        totalShotguns: finalShotguns,
        standard: possibleFormerPlayers[0].standard || [],
        wild: possibleFormerPlayers[0].wild || []
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
          playerName: possibleFormerPlayers[0].name
        });
        console.log(`📡 Sent forceRefresh command to formerly disconnected player ${possibleFormerPlayers[0].name} (${socket.id})`);
      }, 1000); // Small delay to ensure all data is sent first
      
      // Send game state directly to reconnected player without refresh signal
      if (room.gameStarted) {
        // ✅ FIX: Send only card data in hands, not full playerStats
        socket.emit('gameStarted', {
          hands: { [socket.id]: {
            standard: playerStats[socket.id]?.standard || [],
            wild: playerStats[socket.id]?.wild || []
          }},
          playerStats: playerStats
        });
        
        // ✅ FIX: Send complete players list so reconnected player sees everyone
        socket.emit('updatePlayers', room.players);
        console.log(`📡 Sent complete players list to reconnected player ${possibleFormerPlayers[0].name}`);
        
        console.log(`📡 Sent direct game state to reconnected player ${possibleFormerPlayers[0].name} (${socket.id})`);
        
        // ✅ REMOVED: Auto-refresh after reconnection to prevent infinite loops
        // Let client-side stealth detection handle refreshes when truly needed
      } else {
        socket.emit('joinedRoom', roomCode);
        console.log(`📡 Sent lobby state to reconnected player ${possibleFormerPlayers[0].name} (${socket.id})`);
      }
      
      // Remove from formerPlayers and clean up any old playerStats
      delete formerPlayers[possibleFormerPlayers[0].name];
      
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
  let roomToDelete = null;
  
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

          // ✅ ENHANCED DISCONNECT: Find player's maximum accumulated stats from all entries
          const allPlayerEntries = Object.entries(playerStats).filter(([id, stats]) => 
            stats.name === leavingPlayer.name || id === socket.id
          );
          
          // Find the entry with highest totalDrinks (most accumulated)
          const maxDrinksEntry = allPlayerEntries.reduce((max, current) => {
            const currentDrinks = current[1].totalDrinks || 0;
            const maxDrinks = max ? max[1].totalDrinks || 0 : 0;
            return currentDrinks > maxDrinks ? current : max;
          }, null);
          
          const maxStats = maxDrinksEntry ? maxDrinksEntry[1] : playerStats[socket.id];
          console.log(`💾 DISCONNECT SAVE: Found max stats for ${leavingPlayer.name}: ${maxStats.totalDrinks} drinks from ${maxDrinksEntry ? maxDrinksEntry[0].slice(-4) : socket.id.slice(-4)}`);

          // Store player data in formerPlayers by their name with maximum accumulated stats
          formerPlayers[leavingPlayer.name] = {
            id: socket.id,  // Current socket ID (for reference)
            name: leavingPlayer.name,
            roomCode: roomCode,            // Last room the player was in
            totalDrinks: maxStats.totalDrinks || 0,
            totalShotguns: maxStats.totalShotguns || 0,
            standard: maxStats.standard || [],
            wild: maxStats.wild || []
          };
          console.log("Former Players:", formerPlayers);

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
              // Host left in the lobby, close the room
              io.to(roomCode).emit('hostLeft', 'The host has left the game. Lobby is closing.');
              roomToDelete = roomCode;
            } else {
              // Non-host player left in the lobby, update player list
              io.to(roomCode).emit('updatePlayers', players);
            }
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

    // If the room needs to be deleted
    if (roomToDelete) {
      delete rooms[roomToDelete];
      delete usedCards[roomToDelete];  // Clean up used cards storage
      console.log(`Room ${roomToDelete} deleted`);
    }
});

// ✅ NEW: Handle client requests for forced refresh (prevents infinite loops)
const refreshCooldowns = new Map(); // Track recent refresh requests

socket.on('requestRefresh', ({ roomCode, playerName, reason }) => {
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

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Running code: ${bootCommit()}  |  node ${process.version}  |  started ${new Date().toISOString()}`);
});