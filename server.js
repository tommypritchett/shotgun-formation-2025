const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path'); // Import the path module
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

// Finalize round logic
const finalizeRound = (roomCode) => {
    // Get the room from the rooms object
    const room = rooms[roomCode];  
    if (!room) {
      console.log(`Room ${roomCode} not found for finalization.`);
      return;
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

    // ✅ ENHANCED: Include player names in stats data
    const playersWithNames = {};
    Object.keys(playerStats).forEach(playerId => {
      const player = room.players.find(p => p.id === playerId);
      playersWithNames[playerId] = {
        ...playerStats[playerId],
        name: player ? player.name : undefined,
        disconnected: player ? player.disconnected : false
      };
    });

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
 
    // Clear round results for the next round
    roundResults[roomCode] = {};
    console.log(`Round results cleared for room ${roomCode}.`);
    rooms.isActionInProgress = false;

 
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
    const roomCode = generateRoomCode();
    rooms[roomCode] = { players: [{ id: socket.id, name: playerName }], host: socket.id,   isActionInProgress: false };
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
    
    // Restore their game data
    playerStats[socket.id] = {
      totalDrinks: formerPlayer.totalDrinks || 0,
      totalShotguns: formerPlayer.totalShotguns || 0,
      standard: formerPlayer.standard || [],
      wild: formerPlayer.wild || []
    };
    
    // Clean up formerPlayers
    delete formerPlayers[playerName];
    console.log(`✅ Restored ${playerName} with data:`, playerStats[socket.id]);
    
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
    if (room && room.players.length >= 3) {
      const { standardDeck, wildDeck } = generateDecks(room.players.length);

      // Log the decks in the terminal before shuffling and dealing out the cards
      //console.log('Standard Deck before dealing:', standardDeck);
    //  console.log('Wild Deck before dealing:', wildDeck);

      const hands = distributeCards(room.players, standardDeck, wildDeck);
      rooms[roomCode].deck = { standardDeck, wildDeck }; // Save remaining deck in room
    // Set the gameStarted flag to true for this room
    rooms[roomCode].gameStarted = true;
    rooms[roomCode].quarter = 1;  // Initialize quarter as 1

// Fully reset playerStats by removing all existing player stats
Object.keys(playerStats).forEach(playerId => {
    delete playerStats[playerId];
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
      // Assign the new host
      const newHost = room.players.find(player => player.id === newHostId);
      if (newHost) {
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
  if (rooms.isActionInProgress) {
    io.to(socket.id).emit('actionInProgress', 'Action is in progress. Please wait until the round ends.');
    return;
  }
  rooms.isActionInProgress = true;

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
    
    // Emit updated player stats for the round
    io.to(roomCode).emit('updatePlayerStats', {
      players: playerStats,
      roundResults: roundResults[roomCode],
    });
  
    console.log(`First Down - Everyone drinks once in room ${roomCode}`);

    startTimer(roomCode, 6);  // Start the 5-second timer for drink assignment

  });

  // Play Standard Card Event (Triggered by the host)
  socket.on('playStandardCard', ({ roomCode, cardType }) => {
    const room = rooms[roomCode];
    if (!room) return;

      // Check if an action is already in progress
      if (rooms.isActionInProgress) {
        // Emit a message to the frontend asking the player to wait
        io.to(socket.id).emit('actionInProgress', 'Action is in progress. Please wait until the round ends.');
        return;
      }
  
      // Set the action as in progress
      rooms.isActionInProgress = true;
      console.log(`Action status ${rooms.isActionInProgress} `);

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
      rooms.isActionInProgress = false;
  
      // Show the message for 5 seconds, then clear it
      setTimeout(() => {
        io.to(roomCode).emit('noCard', '');  // Clear the message
      }, 5000);
  
      return;
    }

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

    startTimer(roomCode, 21);  // Start the 20-second timer for drink assignment

});
// Handle wild card selection
socket.on('wildCardSelected', ({ roomCode, playerId, wildcardtype }) => {
    const room = rooms[roomCode];  // Now roomCode is available
    if (!room) return;
  
    // Broadcast the wild card selection to the host
     // Check if an action is already in progress
     if (rooms.isActionInProgress) {
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
    if (rooms.isActionInProgress) {
        // Emit a message to the frontend asking the player to wait
        io.to(socket.id).emit('actionInProgress', 'Action is in progress. Please wait until the round ends.');
        return;
    }

    console.log(`Host confirmed wild card: ${wildcardtype} by player ${player}`);
    
    // Set the action as in progress
    rooms.isActionInProgress = true;

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
    startTimer(roomCode, 11);  // Start the 10-second timer for drink assignment
});

// Handle drink and shotgun assignments for a round
socket.on('assignDrinks', ({ roomCode, selectedPlayerIds, drinksToGive, shotgunsToGive }) => {
    const room = rooms[roomCode];
    if (!room) return;
  
    if (!roundResults[roomCode]) {
      roundResults[roomCode] = {};  // Initialize for each round
    }
  
    console.log(`Player ${socket.id} is assigning drinks:`, drinksToGive);
    console.log(`Player ${socket.id} is assigning shotguns:`, shotgunsToGive);
    console.log("selected player ids:",selectedPlayerIds);

    // Iterate over each selected player and update their drinks and shotguns
    selectedPlayerIds.forEach(selectedPlayerId => {
      // Ensure the roundResults entry for the player exists
      if (!roundResults[roomCode][selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId] = { drinks: 0, shotguns: 0 };
        console.log(`Initializing round results for player ${selectedPlayerId}`);
      } 
  
      // Add drinks to the player's round results, if applicable
      if (drinksToGive && drinksToGive[selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId].drinks += drinksToGive[selectedPlayerId];
        console.log(`Player ${selectedPlayerId} received ${drinksToGive[selectedPlayerId]} drinks.`);
  
        // Check if player reached or exceeded 10 drinks in this round
        if (roundResults[roomCode][selectedPlayerId].drinks >= 10) {
          // Player needs to shotgun
          roundResults[roomCode][selectedPlayerId].shotguns += 1;
          roundResults[roomCode][selectedPlayerId].drinks -= 10;  // Reduce drinks by 10
          console.log(`Player ${selectedPlayerId} reached 10 drinks and has to shotgun!`);
        }
      }
      console.log("shotguns to give",shotgunsToGive, "shotguns to give[selectedPlayerId]", shotgunsToGive[selectedPlayerId]);

      // Add shotguns to the player's round results, if applicable
      if (shotgunsToGive && shotgunsToGive[selectedPlayerId]) {
        roundResults[roomCode][selectedPlayerId].shotguns += shotgunsToGive[selectedPlayerId];
        console.log(`Player ${selectedPlayerId} received ${shotgunsToGive[selectedPlayerId]} shotguns.`);
      }
    });
  
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
      if (room.players.length > 0) {
        // Reassign the host if there are players left
        room.host = room.players[0].id;
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
      
      // Restore their data
      playerStats[socket.id] = {
        totalDrinks: possibleFormerPlayers[0].totalDrinks || 0,
        totalShotguns: possibleFormerPlayers[0].totalShotguns || 0,
        standard: possibleFormerPlayers[0].standard || [],
        wild: possibleFormerPlayers[0].wild || []
      };
      
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
      
      // ✅ FIX: Clean up any old playerStats entries for previous socket IDs
      const oldSocketIds = Object.keys(playerStats).filter(id => 
        id !== socket.id && playerStats[id]?.name === possibleFormerPlayers[0].name
      );
      oldSocketIds.forEach(oldId => {
        console.log(`🧹 Cleaning up old playerStats for ${possibleFormerPlayers[0].name} with old socket ID: ${oldId}`);
        delete playerStats[oldId];
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
              // ✅ FIXED: If a non-host player disconnects, minimal notification (no heavy state updates)
              console.log(`📡 Non-host player ${leavingPlayer.name} (${socket.id}) disconnected from game in progress.`);
              // Don't broadcast playerDisconnected - causes unnecessary UI churn for other players
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

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});