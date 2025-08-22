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

    // Emit the final round results and updated player stats to everyone in the room
    io.to(roomCode).emit('updatePlayerStats', {
       players: playerStats,
       roundResults: roundResults[roomCode]  // Send combined round results
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

// Join Room or game (extracted to reusable function)
function handleJoinRoom(socket, roomCode, playerName) {
  if (rooms[roomCode]) {
    let playerData;
    let isRejoining = false;

    // Check if this socket is already in the room to prevent duplicates
    const socketAlreadyInRoom = rooms[roomCode].players.find(p => p.id === socket.id);
    if (socketAlreadyInRoom) {
      console.log(`Socket ${socket.id} is already in room ${roomCode}, ignoring duplicate join request`);
      return;
    }

    // Check if player name is already taken by an active player
    const existingPlayerIndex = rooms[roomCode].players.findIndex(p => p.name === playerName);
    
    if (existingPlayerIndex !== -1) {
      const existingPlayer = rooms[roomCode].players[existingPlayerIndex];
      
      // If player is active (not disconnected), don't allow joining with same name
      if (!existingPlayer.disconnected) {
        console.log(`Player name "${playerName}" is already taken by an active player in room ${roomCode}`);
        socket.emit('error', `Player name "${playerName}" is already taken. Please choose a different name.`);
        return;
      }
      // Player is rejoining - update their socket ID and mark as connected
      rooms[roomCode].players[existingPlayerIndex].id = socket.id;
      rooms[roomCode].players[existingPlayerIndex].disconnected = false;
      delete rooms[roomCode].players[existingPlayerIndex].disconnectedAt;
      
      console.log(`Player ${playerName} reconnected and marked as active`);
      
      // Get their existing stats by searching through playerStats for matching name
      let existingPlayerStatsId = null;
      for (const [playerId, stats] of Object.entries(playerStats)) {
        if (stats.name === playerName || 
            (rooms[roomCode].players.find(p => p.id === playerId && p.name === playerName))) {
          existingPlayerStatsId = playerId;
          break;
        }
      }
      
      if (existingPlayerStatsId && playerStats[existingPlayerStatsId]) {
        // Use existing stats but remove old key and add with new socket ID
        playerData = { ...playerStats[existingPlayerStatsId] };
        delete playerStats[existingPlayerStatsId]; // Remove old entry
        playerData.id = socket.id;
        // Remove disconnected status
        delete playerData.disconnected;
      } else if (formerPlayers[playerName] && formerPlayers[playerName].roomCode === roomCode) {
        playerData = formerPlayers[playerName];
        delete formerPlayers[playerName]; // Clean up formerPlayers
        playerData.id = socket.id;
        // Remove disconnected status
        delete playerData.disconnected;
      } else {
        // Fallback: create new player data
        playerData = { id: socket.id, name: playerName, totalDrinks: 0, totalShotguns: 0, standard: [], wild: [] };
      }
      
      // Clean up formerPlayers entry if it exists (in case player reconnected)
      if (formerPlayers[playerName]) {
        delete formerPlayers[playerName];
        console.log(`Cleaned up formerPlayers entry for ${playerName}`);
      }
      
      isRejoining = true;
      console.log(`Player ${playerName} is rejoining room ${roomCode} with existing data.`);
    } else if (formerPlayers[playerName] && formerPlayers[playerName].roomCode === roomCode) {
      // Player from formerPlayers is rejoining - only add if not already in players array
      playerData = formerPlayers[playerName];
      delete formerPlayers[playerName];
      playerData.id = socket.id;
      
      // Only add to players array if not already there
      if (!rooms[roomCode].players.find(p => p.name === playerName)) {
        rooms[roomCode].players.push({ id: socket.id, name: playerName, disconnected: false });
      }
      isRejoining = true;
      console.log(`Player ${playerName} is rejoining room ${roomCode} with restored data.`);
    } else {
      // Initialize new player data if not reconnecting or if the roomCode doesn't match
      playerData = { id: socket.id, name: playerName, totalDrinks: 0, totalShotguns: 0, standard: [], wild: [] };
      
      // Only add to players array if not already there
      if (!rooms[roomCode].players.find(p => p.name === playerName)) {
        rooms[roomCode].players.push({ id: socket.id, name: playerName, disconnected: false });
      }
      console.log(`Player ${playerName} is joining as a new player in room ${roomCode}.`);
    }

    // Update player stats with the socket ID
    playerStats[socket.id] = { ...playerData, id: socket.id };
    socket.join(roomCode);

    // Final safety check: ensure no duplicate player names exist in the room
    const playerNames = rooms[roomCode].players.map(p => p.name);
    const uniquePlayerNames = [...new Set(playerNames)];
    if (playerNames.length !== uniquePlayerNames.length) {
      console.log(`Duplicate player names detected in room ${roomCode}, cleaning up...`);
      // Keep only the first occurrence of each name (most recent socket ID)
      const seenNames = new Set();
      rooms[roomCode].players = rooms[roomCode].players.filter(player => {
        if (seenNames.has(player.name)) {
          console.log(`Removing duplicate player: ${player.name} (${player.id})`);
          return false;
        }
        seenNames.add(player.name);
        return true;
      });
    }


      // Check if the game has already started
      if (rooms[roomCode].gameStarted) {
          const room = rooms[roomCode];
          const { standardDeck, wildDeck } = room.deck;  // Get the existing decks

         // If player data is new, deal cards; otherwise, use restored hand
      if (playerData.standard.length === 0) {
        playerData.standard = standardDeck.splice(0, 5);  // Deal 5 standard cards
        playerData.wild = wildDeck.splice(0, 2);  // Deal 2 wild cards
      }
            // Update playerStats for the new or rejoining player
      playerStats[socket.id].standard = playerData.standard;
      playerStats[socket.id].wild = playerData.wild;

          // Send the current state of the game (hands and playerStats) to the new player
          socket.emit('gameStarted', {
              hands: { [socket.id]: playerStats[socket.id] }, // Fix: proper hands format
              playerStats, // Send current player stats to the new player
          });

          console.log(`Player ${socket.id} joined active game ${roomCode}`);

       
              
      } else {
          // If the game hasn't started, emit the joinedRoom event as usual
          io.to(socket.id).emit('joinedRoom', roomCode);
      }

      // ✅ FIXED: Only update player list for new joins, not for reconnections (prevents UI churn)
      if (!isRejoining) {
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
        console.log(`📡 Updated player list for new player ${playerName} in room ${roomCode}`);
      } else {
        console.log(`🔇 Skipped player list broadcast for reconnection of ${playerName} - prevents UI churn`);
      }
      
      // If player was rejoining, send targeted events (NOT room-wide broadcasts)
      if (isRejoining) {
        // ✅ FIXED: Send playerReconnected ONLY to the reconnected player (not entire room)
        io.to(socket.id).emit('playerReconnected', { 
          playerId: socket.id, 
          playerName: playerName,
          allPlayers: rooms[roomCode].players 
        });
        
        // ✅ FIXED: Send updated player stats ONLY to the reconnected player (not entire room)
        io.to(socket.id).emit('updatePlayerStats', playerStats);
        console.log(`✅ Sent targeted reconnection data to ${playerName} (${socket.id}) - reconnection complete`);
        
        // ✅ REMOVED triggerPersonalRefresh - gameStarted already handles everything needed
        console.log(`🎯 Reconnection complete for ${playerName} - gameStarted event provides all necessary data`);
      }

  } else {
      // If the room doesn't exist, send an error to the player
      io.to(socket.id).emit('error', 'Room not found');
  }
   // Update the hands of all players (including the new player) to ensure everyone is in sync
// Only proceed if rooms[roomCode] and rooms[roomCode].players are defined
if (rooms[roomCode]?.players) {
  rooms[roomCode].players.forEach(player => {
    const playerHand = playerStats[player.id];
    io.to(player.id).emit('updatePlayerHand', { standard: playerHand.standard, wild: playerHand.wild });
    console.log(`Join hand for player ${player.id}:`, playerHand.standard);
  });
} else {
  console.log(`No players found in room ${roomCode}`);
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
                 // Emit updated player stats for the round
    io.to(roomCode).emit('updatePlayerStats', {
        players: playerStats,
        roundResults: roundResults[roomCode],
      });  
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
      // Emit updated player stats for the round
      io.to(roomCode).emit('updatePlayerStats', {
        players: playerStats,
        roundResults: roundResults[roomCode],
      });
    
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
      socket.emit('gameStarted', {
        hands: { [socket.id]: playerStats[socket.id] },
        playerStats: playerStats
      });
      console.log(`📡 Sent direct game state to player ${player.name} (${socket.id})`);
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
      // Add the reconnecting player back to the room
      player = { id: socket.id, name: possibleFormerPlayers[0].name };
      room.players.push(player);
      
      // Restore their data
      playerStats[socket.id] = {
        totalDrinks: possibleFormerPlayers[0].totalDrinks || 0,
        totalShotguns: possibleFormerPlayers[0].totalShotguns || 0,
        standard: possibleFormerPlayers[0].standard || [],
        wild: possibleFormerPlayers[0].wild || []
      };
      
      console.log(`Reconnected player ${socket.id} to room ${roomCode}`);
      
      // Send game state directly to reconnected player without refresh signal
      if (room.gameStarted) {
        socket.emit('gameStarted', {
          hands: { [socket.id]: playerStats[socket.id] },
          playerStats: playerStats
        });
        console.log(`📡 Sent direct game state to reconnected player ${possibleFormerPlayers[0].name} (${socket.id})`);
      } else {
        socket.emit('joinedRoom', roomCode);
        console.log(`📡 Sent lobby state to reconnected player ${possibleFormerPlayers[0].name} (${socket.id})`);
      }
      
      // Remove from formerPlayers
      delete formerPlayers[possibleFormerPlayers[0].name];
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
  
  // Send current player stats and game state
  socket.emit('updatePlayerStats', {
    players: playerStats,
    roundResults: roundResults[roomCode] || {}
  });
  
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
          
          // Emit updated player stats for the round (to all active players)
          io.to(roomCode).emit('updatePlayerStats', {
            players: playerStats,
            roundResults: roundResults[roomCode] || {},
            allPlayers: players // Include all players (connected and disconnected)
          });
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