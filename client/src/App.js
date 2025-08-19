import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import './App.css';  // Import the updated CSS

const socket = io(process.env.REACT_APP_API_URL || 'https://shotgunformation.onrender.com', {
  transports: ['websocket', 'polling'], // WebSocket first for better performance, polling as fallback
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 100, // Even faster initial retry for mobile
  reconnectionDelayMax: 3000, // Shorter max delay for mobile
  timeout: 45000, // Match server connectTimeout
  pingInterval: 8000, // Match server pingInterval
  pingTimeout: 30000, // Match server pingTimeout
  autoConnect: true,
  // Mobile-specific optimizations
  forceNew: false, // Reuse existing connection when possible
  upgrade: true, // Allow transport upgrades
  rememberUpgrade: true // Remember successful upgrades
});

// const socket = io(process.env.REACT_APP_API_URL || 'http://localhost:3001');

function App() {
  const [gameState, setGameState] = useState('initial');  // 'initial', 'startOrJoin', 'lobby', 'game'
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState([]);  // Initialize as array
  const [isHost, setIsHost] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [drinkMessage, setDrinkMessage] = useState(''); // Message for drink assignments
  //const [drinkAssignments, setDrinkAssignments] = useState([]); // Track drink assignments
  const [playerStats, setPlayerStats] = useState({});  // Overall stats
  const [roundDrinkResults, setRoundDrinkResults] = useState({});  // Drinks for the current round
  const [timeRemaining, setTimeRemaining] = useState(0);  // Timer for drink assignment
  const [drinksToGive, setDrinksToGive] = useState(0);  // Track total drinks for this action
  const [shotgunsToGive, setshotgunsToGive] = useState(0);  // Track total shotguns for this action 
  const [assignedDrinks, setAssignedDrinks] = useState({
    drinks: {},     // Track assigned drinks
    shotguns: {}    // Track assigned shotguns
  });
  const [noCardMessage, setNoCardMessage] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Add class to disable game interactions when the menu is open
// const gameElementsClass = isMenuOpen ? 'game-elements-disabled' : '';
  // New state to track if host selection is in progress
const [isHostSelection, setIsHostSelection] = useState(false);
    const [isDistributing, setIsDistributing] = useState(false);  // Flag to control drink distribution
  //const [drinksAssignedThisRound, setDrinksAssignedThisRound] = useState(0); 
  const [declaredCard, setDeclaredCard] = useState('');
  // Initialize wildCardSelections to store the selected wild card for each player
  const [wildCardSelected, setWildCardSelected] = useState(null);  // Track the selected wild card
  const [quarter, setQuarter] = useState(1); // Track the current quarter
  const [isWildCardSelectionOpen, setIsWildCardSelectionOpen] = useState(false);  // Wild card selection modal state
  const [selectedWildCardToDiscard, setSelectedWildCardToDiscard] = useState(null);  // Track the selected wild card to discard
  const [instructionsmessage] = useState('Instructions: \n1. Host will select a card event when an event occurs.\n2. If you have corresponding cards you will be prompted to Assign drinks or shotguns.\n3. Select your Neon Green Wild Card when the event occurs. Host will confirm event\n4. After each Quarter the host will confirm a Quarter has ended and you will have an option to swap out one of your wild cards\n5. Drink responsibly! Must be 21+ Years Old');

  // URL management functions
  const updateURL = (roomCode, playerName) => {
    if (roomCode && playerName) {
      const url = new URL(window.location);
      url.searchParams.set('room', roomCode);
      url.searchParams.set('player', playerName);
      window.history.replaceState({}, '', url);
    }
  };

  const getURLParams = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return {
      roomCode: urlParams.get('room'),
      playerName: urlParams.get('player')
    };
  };

  const clearURL = () => {
    const url = new URL(window.location);
    url.searchParams.delete('room');
    url.searchParams.delete('player');
    window.history.replaceState({}, '', url);
  };


  // Handle name submission
  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (playerName.trim()) {
      setGameState('startOrJoin');
    } else {
      setErrorMessage('Please enter your name');
    }
  };

  // Start a new game (Create Room)
  const startGame = () => {
  alert(instructionsmessage)
    if (playerName) {
      socket.emit('createRoom', playerName);
      setIsHost(true);
    } else {
      setErrorMessage('Please enter your name');
    }
  };

  const joinGame = () => {
    if (roomCode && playerName) {
      socket.emit('joinRoom', roomCode, playerName);
      updateURL(roomCode, playerName); // Store in URL for automatic rejoin
  
      // Listen for the 'gameStarted' event if the game is already active
      socket.on('gameStarted', ({ hands, playerStats }) => {
        // Update the player's hand
        setPlayers(prevPlayers =>
          prevPlayers.map(player =>
            player.id === socket.id ? { ...player, cards: { standard: hands.standard, wild: hands.wild } } : player
          )
        );
  
        // Set player stats to show the scoreboard
        setPlayerStats(playerStats);
  
        // Transition the player to the game screen
        setGameState('game');
      });
    } else {
      setErrorMessage('Please enter a valid room code and your name');
    }
  };

  // Start the game (only for the host)
  const startTheGame = () => {
    if (isHost && players.length >= 3) {
      socket.emit('startGame', roomCode);
      // Update URL for host when starting the game
      updateURL(roomCode, playerName);
    }
  };

  // Handle leave lobby
  const leaveLobby = () => {
    if (roomCode) {
      socket.emit('leaveRoom', roomCode);
    }
    setGameState('startOrJoin');
    setRoomCode('');
    setPlayers([]);  // Reset players to empty array
  };

// Handle card click from the host
const handleCardClick = (cardType) => {
  if (isHost) {
    if (cardType === 'First Down') {
      // Emit a special event for First Down to let everyone know they need to drink once
      socket.emit('firstDownEvent', { roomCode });
      console.log('First Down - Everyone drinks once!');
    } else {
      // Emit the usual event for any other card
      socket.emit('playStandardCard', { roomCode, cardType });
      console.log(`Host declared card: ${cardType}`);  // Log the declared card
    }
    setIsActionModalOpen(false)
  }
};
// Handle wild card selection
const handleWildCardSelect = (wildcardtype) => {
  // setWildCardSelected({ player: socket.id, card });  // Store the player and card selected locally
  socket.emit('wildCardSelected', { roomCode, playerId: socket.id, wildcardtype });

  console.log(`Player selected wild card: ${wildcardtype}`);
};
const confirmWildCard = (confirm) => {
  if (confirm && wildCardSelected) {
    // Emit to the server that the host confirmed the wild card action
    socket.emit('wildCardConfirmed', { roomCode, wildcardtype: wildCardSelected.wildcardtype, player: wildCardSelected.player });
    console.log(`Host confirmed wild card: ${wildCardSelected.wildcardtype}`);
  } else {
    console.log('Host denied wild card selection');
  }
  setWildCardSelected(null);  // Reset after confirming or denying
};


// Handle giving out drinks or shotguns
const handleGiveDrink = (selectedPlayerId, type) => {
  console.log(`Button clicked to assign ${type} to Player ID: ${selectedPlayerId}`);  // Log the click
  let localDrinksAssigned = false;  // Local flag to ensure drinks/shotguns are only assigned once per execution
  console.log("Initial State:", localDrinksAssigned, "Drinks to Give:", drinksToGive, "Shotguns to Give:", shotgunsToGive);

  setAssignedDrinks((prev) => {
    // Initialize or update drinks and shotguns separately
    const updatedDrinks = { ...prev.drinks, [selectedPlayerId]: (prev.drinks?.[selectedPlayerId] || 0) + (type === 'drink' ? 1 : 0) };
    const updatedShotguns = { ...prev.shotguns, [selectedPlayerId]: (prev.shotguns?.[selectedPlayerId] || 0) + (type === 'shotgun' ? 1 : 0) };

    // Calculate the total assigned drinks and shotguns so far
    const totalAssignedDrinks = Object.values(updatedDrinks).reduce((acc, cur) => acc + cur, 0);
    const totalAssignedShotguns = Object.values(updatedShotguns).reduce((acc, cur) => acc + cur, 0);

    // Ensure that we don't assign more drinks or shotguns than available
    if (
      (type === 'drink' && totalAssignedDrinks > drinksToGive) ||
      (type === 'shotgun' && totalAssignedShotguns > shotgunsToGive)
    ) {
      console.log(`Cannot assign more ${type}s. Max ${type}s to give:`, type === 'drink' ? drinksToGive : shotgunsToGive);
      return prev;  // Return the previous state without updating if over limit
    }

    console.log(`Selected Player ID: ${selectedPlayerId}, Drinks: ${updatedDrinks[selectedPlayerId]}, Shotguns: ${updatedShotguns[selectedPlayerId]}`);

    // Combine all selected player IDs that received either drinks or shotguns
    const allSelectedPlayerIds = [
      ...new Set([...Object.keys(updatedDrinks), ...Object.keys(updatedShotguns)])
    ];

    // Log the updated drinks and shotguns per player
    console.log("Total Assigned Drinks:", totalAssignedDrinks);
    console.log("Total Assigned Shotguns:", totalAssignedShotguns);

    // Update the state with the new drink/shotgun assignments
    setAssignedDrinks({ drinks: updatedDrinks, shotguns: updatedShotguns });

    // Send the drink and shotgun assignments once the totals match the available drinks and shotguns
    /*
    if ((totalAssignedDrinks === drinksToGive && totalAssignedShotguns === shotgunsToGive) && !localDrinksAssigned) {
      socket.emit('assignDrinks', {
        roomCode,  // Room code to identify the game
        selectedPlayerIds: allSelectedPlayerIds,  // All player IDs receiving drinks/shotguns
        drinksToGive: updatedDrinks,  // The entire set of drink assignments
        shotgunsToGive: updatedShotguns  // The entire set of shotgun assignments
      });
      localDrinksAssigned = true;
      console.log("Local Drinks Assigned Flag:", localDrinksAssigned);
      console.log(`Assignment complete for player: ${selectedPlayerId}`);
    }
*/

    // Return the updated state
    return { drinks: updatedDrinks, shotguns: updatedShotguns };
  });
};

// Toggle the menu display
const toggleMenu = () => {
  setIsMenuOpen(!isMenuOpen);
};

// Handle showing the instructions
const handleShowInstructions = () => {
  alert(instructionsmessage)
};
//handle declare action
const handleDeclareAction = () => {
  // This function will open the modal or trigger any action logic you have
  setIsActionModalOpen(true); // Example to open a modal
};
// Handle host swap button click
const handleHostSwap = () => {
  if (isHost) {
    setIsHostSelection(true);  // Start the host selection process
  }
};
// Handle selecting a new host from the available players
const handleSelectNewHost = (playerId) => {
  socket.emit('assignNewHost', { roomCode, newHostId: playerId });
  setIsHost(false);  // After selecting a new host, set this player's host status to false
  setIsHostSelection(false);  // Close the host selection modal
  setIsHostSelection(false);  // Close the selection modal after assigning the host
};

// Close the host selection modal without action
const closeHostSelection = () => {
  setIsHostSelection(false);
};

// Handle Leave Game logic
const handleLeaveGame = () => {
  // Emit a custom 'leaveGame' event to the server
  socket.emit('leaveGame', { roomCode });  // Send the roomCode to the server

  // Clear URL parameters
  clearURL();

  // Reset the frontend game state and return to the start/join screen
  setGameState('startOrJoin');  // Reset the game state to 'startOrJoin'
  setRoomCode('');  // Clear the room code
  setPlayers([]);  // Reset players
  setIsHost(false);  // Reset host status
  setDeclaredCard('');  // Clear declared card
};

// Function to close the menu (X button)
const closeMenu = () => {
  setIsMenuOpen(false);
};


  // Handle "Next QTR" action from the host
  const handleNextQuarter = () => {
    if (isHost) {
      socket.emit('nextQuarter', { roomCode });  // Emit the nextQuarter event to the server
    }
  };

const [actionMessage, setActionMessage] = useState('');  // Store messages like "Action in progress"

// Handle opening the wild card selection modal
const openWildCardSelection = () => {
  setIsWildCardSelectionOpen(true);
};

// Handle selecting a wild card to discard
const handleSelectWildCardToDiscard = (card) => {
  setSelectedWildCardToDiscard(card);  // Store the selected card to discard
  console.log("Wild card selected", selectedWildCardToDiscard);

};

// Confirm the wild card swap action
const confirmWildCardSwap = () => {
  socket.emit('wildCardSwap', { roomCode, discardedCard: selectedWildCardToDiscard });  // Emit event to server
  console.log("Wild card swapping", selectedWildCardToDiscard);
  setIsWildCardSelectionOpen(false);  // Close the modal
  setSelectedWildCardToDiscard(null);  // Reset the selected card
};
const closeModal = (modalType) => {
  switch (modalType) {
    case 'timerModal':
    case 'drinkAssignmentModal':
      setTimeRemaining(0);  // Close the timer and drink assignment modal
      setIsDistributing(false);  // Stop distributing drinks
      break;
    case 'firstDownModal':
      setDeclaredCard(null);  // Clear the first down modal
      break;
    default:
      break;
  }
};

// In your App.js, update the saveGameStateLocally function
const saveGameStateLocally = () => {
  try {
    if (players.length > 0 && roomCode) {
      // Create a simplified state object that won't cause circular reference errors
      const localGameState = {
        players: players.map(p => ({
          id: p.id,
          name: p.name,
          disconnected: p.disconnected || false,
          // Only include essential card data
          cards: p.cards ? {
            standard: p.cards.standard ? p.cards.standard.map(c => ({ card: c.card, drinks: c.drinks })) : [],
            wild: p.cards.wild ? p.cards.wild.map(c => ({ card: c.card, drinks: c.drinks })) : []
          } : { standard: [], wild: [] }
        })),
        currentPlayerName: playerName, // Store current player name explicitly
        roomCode,
        quarter,
        isHost,
        // Simplify playerStats to avoid circular references
        playerStats: Object.entries(playerStats).reduce((acc, [id, stats]) => {
          acc[id] = {
            name: stats.name || players.find(p => p.id === id)?.name,
            totalDrinks: stats.totalDrinks || 0,
            totalShotguns: stats.totalShotguns || 0
          };
          return acc;
        }, {}),
        timestamp: Date.now()
      };
      
      localStorage.setItem('shotgunFormation_gameState', JSON.stringify(localGameState));
      console.log('Game state saved locally');
    }
  } catch (error) {
    console.error('Failed to save game state locally:', error);
  }
};

const loadGameStateLocally = () => {
  try {
    const savedState = localStorage.getItem('shotgunFormation_gameState');
    if (savedState) {
      const parsedState = JSON.parse(savedState);
      const isStale = Date.now() - parsedState.timestamp > 1000 * 60 * 30; // 30 minutes
      
      if (!isStale && parsedState.roomCode === roomCode) {
        return parsedState;
      }
    }
  } catch (error) {
    console.error('Failed to load game state locally:', error);
  }
  return null;
};

// Automatic rejoin on app load - ALWAYS check URL first
useEffect(() => {
  const urlParams = getURLParams();
  const localState = loadGameStateLocally();
  
  // Check if we just refreshed to prevent refresh loops
  const hasRefreshed = sessionStorage.getItem('hasAutoRefreshed');
  
  // Add a flag to prevent multiple rejoin attempts
  let rejoinAttempted = false;
  
  // PRIORITY 1: Always check URL params first (highest priority)
  if (urlParams.roomCode && urlParams.playerName && !rejoinAttempted && !hasRefreshed) {
    console.log('Device connected with URL params - will refresh immediately to rejoin:', urlParams);
    setPlayerName(urlParams.playerName);
    setRoomCode(urlParams.roomCode);
    
    // Mark that we're about to refresh to prevent loops
    sessionStorage.setItem('hasAutoRefreshed', 'true');
    
    // Immediate refresh to rejoin the game with fresh state
    setTimeout(() => {
      console.log('Auto-refreshing immediately to rejoin game with fresh connection');
      window.location.reload();
    }, 500); // Very short delay to set session storage
    
    return; // Exit early since we're refreshing
  }
  
  // If we just refreshed, proceed with normal rejoin (no more refreshing)
  if (urlParams.roomCode && urlParams.playerName && hasRefreshed && !rejoinAttempted) {
    console.log('Post-refresh: attempting rejoin with fresh connection:', urlParams);
    setPlayerName(urlParams.playerName);
    setRoomCode(urlParams.roomCode);
    setGameState('connecting');
    rejoinAttempted = true;
    
    // Clear the refresh flag
    sessionStorage.removeItem('hasAutoRefreshed');
    
    // Validate and rejoin without additional refreshing
    const validateTimeout = setTimeout(() => {
      console.log('Post-refresh: validating game and rejoining');
      socket.emit('validateAndJoinRoom', urlParams.roomCode, urlParams.playerName);
    }, 200);
    
    // Listen for successful rejoin (NO MORE REFRESHING)
    const handleRejoinSuccess = () => {
      console.log('Post-refresh rejoin successful - entering game');
      setGameState('game');
    };
    
    const handleLobbyJoin = () => {
      console.log('Post-refresh rejoin successful - entering lobby');
      setGameState('lobby');
    };
    
    const handleRejoinError = (error) => {
      console.log('Auto-rejoin failed:', error, '- going to join screen');
      setGameState('startOrJoin');
      // Clear URL params since the game doesn't exist
      const url = new URL(window.location);
      url.searchParams.delete('room');
      url.searchParams.delete('player');
      window.history.replaceState({}, '', url);
    };
    
    socket.once('gameStarted', handleRejoinSuccess);
    socket.once('joinedRoom', handleLobbyJoin);
    socket.once('roomNotFound', handleRejoinError);
    socket.once('error', handleRejoinError);
    
    // Cleanup listeners and timeout after 10 seconds
    setTimeout(() => {
      clearTimeout(validateTimeout);
      socket.off('gameStarted', handleRejoinSuccess);
      socket.off('joinedRoom', handleLobbyJoin);
      socket.off('roomNotFound', handleRejoinError);
      socket.off('error', handleRejoinError);
      
      // If still connecting after 10 seconds, assume failure
      if (gameState === 'connecting') {
        console.log('Auto-rejoin timed out - going to join screen');
        setGameState('startOrJoin');
      }
    }, 10000);
    
  } else if (localState && localState.roomCode && localState.currentPlayerName && !rejoinAttempted && !hasRefreshed) {
    // PRIORITY 2: Try to rejoin from local storage - refresh immediately to create URL params
    console.log('No URL params found - will refresh with localStorage data to create URL params:', localState.currentPlayerName);
    setPlayerName(localState.currentPlayerName);
    setRoomCode(localState.roomCode);
    updateURL(localState.roomCode, localState.currentPlayerName);
    
    // Mark that we're about to refresh to prevent loops
    sessionStorage.setItem('hasAutoRefreshed', 'true');
    
    // Immediate refresh to create URL params and rejoin
    setTimeout(() => {
      console.log('Auto-refreshing to create URL params from localStorage data');
      window.location.reload();
    }, 500);
    
    return; // Exit early since we're refreshing
    
  } else {
    // PRIORITY 3: No saved game data found OR post-refresh cleanup - go to start screen
    console.log('No saved game data found or post-refresh - showing start/join screen');
    setGameState('startOrJoin');
    
    // Clear any stale refresh flags if present
    if (hasRefreshed) {
      sessionStorage.removeItem('hasAutoRefreshed');
    }
  }
}, []); // Only run on mount

// Call saveGameStateLocally periodically
useEffect(() => {
  if (gameState === 'game') {
    // Save game state every 15 seconds
    const saveInterval = setInterval(saveGameStateLocally, 15000);
    return () => clearInterval(saveInterval);
  }
}, [gameState, players, playerStats, roomCode, quarter]);

// Enhanced connection monitoring with network change detection
useEffect(() => {
  let lastConnectedStatus = socket.connected;
  let disconnectTime = null;
  
  const checkConnection = () => {
    // Connection state changed
    if (lastConnectedStatus !== socket.connected) {
      if (socket.connected) {
        const reconnectTime = Date.now();
        const downtime = disconnectTime ? (reconnectTime - disconnectTime) / 1000 : null;
        console.log(`Connection restored after ${downtime} seconds of downtime`);
        disconnectTime = null;
        
        // Request game state after reconnection
        if (gameState === 'game' && roomCode) {
          setTimeout(() => {
            socket.emit('requestGameState', { roomCode });
          }, 1000);
        }
      } else {
        disconnectTime = Date.now();
        console.log('Connection lost at:', new Date(disconnectTime).toISOString());
        
        // Save game state when connection is lost
        if (gameState === 'game') {
          saveGameStateLocally();
        }
      }
      lastConnectedStatus = socket.connected;
    }
  };
  
  // Network change detection for mobile
  const handleNetworkChange = () => {
    console.log('Network status changed. Online:', navigator.onLine);
    
    if (navigator.onLine && !socket.connected) {
      console.log('Network restored, attempting to reconnect...');
      setTimeout(() => {
        socket.connect();
      }, 1000);
    } else if (!navigator.onLine) {
      console.log('Network lost, saving game state...');
      if (gameState === 'game') {
        saveGameStateLocally();
      }
    }
  };
  
  // Check connection every second
  const interval = setInterval(checkConnection, 1000);
  
  // Listen for network changes (mobile-friendly)
  window.addEventListener('online', handleNetworkChange);
  window.addEventListener('offline', handleNetworkChange);
  
  return () => {
    clearInterval(interval);
    window.removeEventListener('online', handleNetworkChange);
    window.removeEventListener('offline', handleNetworkChange);
  };
}, [socket, gameState, roomCode]);

// Add this to your useEffect in App.js
useEffect(() => {
  // Handle server heartbeat
  const handleHeartbeat = (data) => {
    // Respond to server heartbeat to keep connection alive
    socket.emit('heartbeat-ack', { timestamp: data.timestamp });
  };
  
  socket.on('heartbeat', handleHeartbeat);
  
  return () => {
    socket.off('heartbeat', handleHeartbeat);
  };
}, [socket]);


// Enhanced mobile visibility and wake lock handling
useEffect(() => {
  let wakeLock = null;
  
  // Request wake lock to prevent mobile from sleeping during gameplay
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator && gameState === 'game') {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake lock acquired for better mobile connectivity');
        
        wakeLock.addEventListener('release', () => {
          console.log('Wake lock released');
        });
      } catch (err) {
        console.log('Wake lock failed:', err);
      }
    }
  };

  // Release wake lock when leaving game
  const releaseWakeLock = () => {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      console.log('App became visible, checking connection status...');
      
      // Request wake lock when app becomes visible during game
      if (gameState === 'game') {
        requestWakeLock();
      }
      
      if (!socket.connected) {
        console.log('Reconnecting after visibility change...');
        socket.connect();
        
        // Give it a moment to connect then request game state
        setTimeout(() => {
          if (gameState === 'game') {
            socket.emit('requestGameState', { roomCode });
          }
        }, 1000);
      }
    } else {
      // App going to background - prepare for potential disconnect
      console.log('App going to background, saving state...');
      if (gameState === 'game') {
        saveGameStateLocally();
      }
    }
  };

  // Enhanced mobile focus handling
  const handleAppFocus = () => {
    console.log('Window focus gained, checking connection...');
    
    if (gameState === 'game') {
      requestWakeLock();
    }
    
    if (!socket.connected) {
      socket.connect();
      
      // Give connection time to establish
      setTimeout(() => {
        if (gameState === 'game') {
          socket.emit('requestGameState', { roomCode });
        }
      }, 1000);
    }
  };

  const handleAppBlur = () => {
    console.log('Window lost focus');
    if (gameState === 'game') {
      saveGameStateLocally();
    }
  };

  // Mobile-specific touch events to maintain wake lock
  const handleTouchStart = () => {
    if (gameState === 'game' && !wakeLock) {
      requestWakeLock();
    }
  };

  // Request wake lock when entering game
  if (gameState === 'game') {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleAppFocus);
  window.addEventListener('blur', handleAppBlur);
  document.addEventListener('touchstart', handleTouchStart);
  
  // Clean up event listeners and wake lock when component unmounts
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleAppFocus);
    window.removeEventListener('blur', handleAppBlur);
    document.removeEventListener('touchstart', handleTouchStart);
    releaseWakeLock();
  };
}, [socket, gameState, roomCode]);

/*
useEffect(() => {
  // Set zoom to 70% when the page loads
  window.onload = function() {
    document.body.style.zoom = "70%"; // Adjust the percentage as needed
  };
}, []);
*/
// Listen for the quarterUpdated event from the server
useEffect(() => {
  socket.on('quarterUpdated', (updatedQuarter) => {
    setQuarter(updatedQuarter);  // Update the current quarter state
    console.log(`Quarter updated to: ${updatedQuarter}`);
    
    // Open wild card selection modal when the quarter changes
    if (updatedQuarter > 1) {
      openWildCardSelection();
    }
  });

  return () => {
    socket.off('quarterUpdated');
  };
}, []);

// Add this to your App.js, replacing your current socket event listeners
useEffect(() => {
  // Connection events
  const handleConnect = () => {
    console.log('Connected to server:', socket.id);
    
    // If we're in a game, request the current state
    if (gameState === 'game' && roomCode) {
      socket.emit('requestGameState', { roomCode });
    }
  };
  
  const handleDisconnect = (reason) => {
    console.log('Disconnected from server. Reason:', reason);
    
    // Only attempt to reconnect if it's a transport close and not an intentional disconnect
    if (reason === 'transport close' || reason === 'ping timeout') {
      console.log('Will attempt to reconnect automatically...');
    }
  };
  
  const handleReconnectAttempt = (attemptNumber) => {
    console.log(`Reconnection attempt #${attemptNumber}`);
  };
  
  const handleReconnect = (attemptNumber) => {
    console.log(`Successfully reconnected after ${attemptNumber} attempt(s)`);
    
    // Enhanced reconnection logic for mobile
    if (gameState === 'game' && roomCode) {
      // Wait a moment for the connection to stabilize
      setTimeout(() => {
        console.log('Requesting game state after successful reconnection');
        socket.emit('requestGameState', { roomCode });
        
        // Try to recover from local storage as immediate fallback while waiting for refresh
        const localState = loadGameStateLocally();
        if (localState) {
          console.log('Loaded game state from local storage while waiting for server response');
          // Update UI elements that don't depend on fresh server data
          setQuarter(localState.quarter);
          
          // Restore basic player info if available
          if (localState.players && localState.players.length > 0) {
            const currentPlayer = localState.players.find(p => p.name === playerName);
            if (currentPlayer && currentPlayer.cards) {
              console.log('Restoring player hand from local storage');
              setPlayers(prevPlayers =>
                prevPlayers.map(player =>
                  player.name === playerName 
                    ? { ...player, cards: currentPlayer.cards }
                    : player
                )
              );
            }
          }
          
          // Restore player stats if available
          if (localState.playerStats) {
            setPlayerStats(localState.playerStats);
          }
        }
      }, 500);
    }
  };
  
  const handleReconnectError = (error) => {
    console.error('Reconnection error:', error);
  };
  
  const handleReconnectFailed = () => {
    console.log('Failed to reconnect after all attempts');
    
    // Try to restore from local storage as last resort
    const localState = loadGameStateLocally();
    if (localState && gameState === 'game') {
      console.log('Using local storage as fallback after reconnection failure');
      alert('Connection lost. Using saved game state. Some features may not work until connection is restored.');
      
      // Restore what we can from local storage
      if (localState.players && localState.players.length > 0) {
        setPlayers(localState.players);
      }
      if (localState.playerStats) {
        setPlayerStats(localState.playerStats);
      }
      setQuarter(localState.quarter);
    } else {
      alert('Unable to reconnect to the game. Please refresh the page.');
    }
  };
  
  const handleError = (error) => {
    console.error('Socket error:', error);
  };
  
  // Add event listeners
  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('reconnect_attempt', handleReconnectAttempt);
  socket.on('reconnect', handleReconnect);
  socket.on('reconnect_error', handleReconnectError);
  socket.on('reconnect_failed', handleReconnectFailed);
  socket.on('error', handleError);
  
  // Clean up listeners
  return () => {
    socket.off('connect', handleConnect);
    socket.off('disconnect', handleDisconnect);
    socket.off('reconnect_attempt', handleReconnectAttempt);
    socket.off('reconnect', handleReconnect);
    socket.off('reconnect_error', handleReconnectError);
    socket.off('reconnect_failed', handleReconnectFailed);
    socket.off('error', handleError);
  };
}, [socket, gameState, roomCode]);


  // Listen for the wild card selection from the server
  useEffect(() => {
    socket.on('wildCardSelected', ({ playerId, wildcardtype }) => {
      setWildCardSelected({ player: playerId, wildcardtype });
      console.log(`Host received wild card selection: ${wildcardtype} by player: ${playerId}`);
    });

    return () => {
      socket.off('wildCardSelected');
    };
  }, []);

// Listen for messages from the server
useEffect(() => {
  socket.on('actionInProgress', (message) => {
    alert(message);  // Show the "Action in progress" message
    console.log("set action message", message);

  });

  socket.on('roundEnded', (message) => {
    setActionMessage('');  // Clear the message when the round ends
    console.log("clear action message", message);

  });

  return () => {
    socket.off('actionInProgress');
    socket.off('roundEnded');
  };
}, []);

useEffect(() => {
  socket.on('noCard', (message) => {
    if (message) {
      setNoCardMessage(true);
      setTimeout(() => setNoCardMessage(false), 5000);  // Clear message after 5 seconds
    }
  });

  return () => {
    socket.off('noCard');
  };
}, []);

// send stats after timer ends

useEffect(() => {
  if (timeRemaining === 0) {
    // Check if there are any assignments to be sent
    const totalAssignedDrinks = Object.values(assignedDrinks.drinks || {}).reduce((acc, cur) => acc + cur, 0);
    const totalAssignedShotguns = Object.values(assignedDrinks.shotguns || {}).reduce((acc, cur) => acc + cur, 0);

    if (totalAssignedDrinks > 0 || totalAssignedShotguns > 0) {
      console.log("Sending drink and shotgun assignments after timer hit zero");

      const allSelectedPlayerIds = [
        ...new Set([...Object.keys(assignedDrinks.drinks || {}), ...Object.keys(assignedDrinks.shotguns || {})])
      ];

      socket.emit('assignDrinks', {
        roomCode,  // Room code to identify the game
        selectedPlayerIds: allSelectedPlayerIds,  // All player IDs receiving drinks/shotguns
        drinksToGive: assignedDrinks.drinks,  // The entire set of drink assignments
        shotgunsToGive: assignedDrinks.shotguns  // The entire set of shotgun assignments
      });

      // Reset the assignments after emitting
      setAssignedDrinks({ drinks: {}, shotguns: {} });
    }
  }
}, [timeRemaining]);

// Listen for the timer updates from the server
useEffect(() => {
  socket.on('updateTimer', (remainingTime) => {
    setTimeRemaining(remainingTime);
  });

  // Listen for the updated player stats and round results after the timer ends
  socket.on('updatePlayerStats', ({ players, roundResults }) => {
    setPlayerStats(players);  // Update the overall player stats
    setRoundDrinkResults(roundResults);  // Update the round results
    console.log("Round drink results (for all players):", roundResults);

    // Reset drink assignment state when the round is finalized
    setDrinkMessage('');  // Clear the drink assignment message
    setAssignedDrinks({});  // Clear the assigned drinks
    setDrinksToGive(0);  // Reset the drinks to give
    setIsDistributing(false);  // Turn off drink distribution mode
    console.log("Round drink results (for all players):", roundResults);

  });

  return () => {
    socket.off('updateTimer');
    socket.off('updatePlayerStats');
  };
}, []);

useEffect(() => {
  // Listen for the declared card from the server
  socket.on('declaredCard', (cardType) => {
    console.log('New card declared:', cardType);
    setDeclaredCard(cardType);  // Update the state with the declared card
  });

  // Cleanup the listener when the component unmounts
  return () => {
    socket.off('declaredCard');  // Remove the event listener not sure this is even doing anything to be honest
    console.log('Declared card socet off');

  };
}, []);
// UseEffect to listen for first down message
useEffect(() => {
  socket.on('firstDownMessage', (message) => {
    setDrinkMessage(message);  // Set the message for the first down event
    console.log(message);  // Log the message
  });

  return () => {
    socket.off('firstDownMessage');
  };
}, []);


useEffect(() => {
  socket.on('updatePlayerHand', ({ standard, wild }) => {
    setPlayers(prevPlayers =>
      prevPlayers.map(player =>
        player.id === socket.id ? { ...player, cards: { standard, wild } } : player
      )
    );
    console.log("Player hand updated:", { standard, wild });  // Log the updated hand
  });

  return () => {
    socket.off('updatePlayerHand');
  };
}, []);

// Separate useEffect for room events that doesn't depend on players array
useEffect(() => {
  const handleRoomCreated = (newRoomCode) => {
    setRoomCode(newRoomCode);
    setGameState('lobby');
    document.body.style.zoom = "70%"; // Adjust the percentage as needed
    
    // Update URL immediately when room is created
    if (playerName) {
      updateURL(newRoomCode, playerName);
    }
  };

  socket.on('roomCreated', handleRoomCreated);
  
  return () => {
    socket.off('roomCreated', handleRoomCreated);
  };
}, [playerName]); // Depend on playerName instead of players

  useEffect(() => {
    socket.on('joinedRoom', (joinedRoomCode) => {
      setRoomCode(joinedRoomCode);
      updateURL(joinedRoomCode, playerName); // Store in URL
      setGameState('lobby');
      document.body.style.zoom = "70%"; // Adjust the percentage as needed

    });

    socket.on('updatePlayers', (playersList) => {
      setPlayers(playersList);
    });

    socket.on('gameStarted', ({ hands, playerStats }) => {
      setPlayers(players.map(player => ({
        ...player,
        cards: hands[player.id]
      })));
      
      // Set player stats to show the initial scoreboard
      setPlayerStats(playerStats);
    
      setGameState('game');
      
      // Ensure URL is updated for all players (including host) when game starts
      updateURL(roomCode, playerName);
      
       // Adjust the page zoom when the game starts
  document.body.style.zoom = "70%"; // Adjust the percentage as needed
    });

    socket.on('distributeDrinks', ({ cardType, drinkCount, wildcardtype, shotguns }) => {
      const player = players.find(p => p.id === socket.id);
    
      // Check if the player has the declared standard card
      if (player && player.cards.standard.some(card => card.card === cardType)) {
        setDeclaredCard(cardType);  // Set the declared card globally
    
        let message = '';
    
        // Check if there are shotguns to assign
        if (shotguns > 0) {
          message += `You need to assign ${shotguns} shotgun${shotguns > 1 ? 's' : ''} for the ${cardType}! `;
        }
    
        // Check if there are drinks to assign
        if (drinkCount > 0) {
          message += `You need to assign ${drinkCount} drink${drinkCount > 1 ? 's' : ''} for the ${cardType}!`;
        }
    
        setDrinkMessage(message);
        setDrinksToGive(drinkCount);
        setshotgunsToGive(shotguns);
        setIsDistributing(true);  // Set flag to true to indicate distribution is active
        setAssignedDrinks({});
        console.log("Drinks", drinkCount, "Shotgun", shotguns);
        console.log('Drink Message', message);

      // Check if the player has the declared wild card
      } else if (player && player.cards.wild.some(card => card.card === wildcardtype)) {
        setDeclaredCard(wildcardtype);  // Set the declared card globally
    
        let message = '';
    
        // Check if there are shotguns to assign
        if (shotguns > 0) {
          message += `You need to assign ${shotguns} shotgun${shotguns > 1 ? 's' : ''} for the ${wildcardtype}! `;
        }
    
        // Check if there are drinks to assign
        if (drinkCount > 0) {
          message += `You need to assign ${drinkCount} drink${drinkCount > 1 ? 's' : ''} for the ${wildcardtype}!`;
        }
    
        setDrinkMessage(message);
        setDrinksToGive(drinkCount);
        setshotgunsToGive(shotguns);
        setIsDistributing(true);  // Set flag to true to indicate distribution is active
        setAssignedDrinks({});
        console.log("Drinks", drinkCount, "Shotgun", shotguns);
        console.log('Drink Message', message);

    
      } else {
        // Clear the message and distribution flag for players without the card
        setDrinkMessage('');  
        setIsDistributing(false);
      }
    });

    socket.on('updatePlayerStats', ({ players, roundResults }) => {
      setPlayerStats(players);
      setRoundDrinkResults(roundResults);
      console.log("Round drink results (for all players):", roundResults);
    });

    socket.on('error', (msg) => {
      setErrorMessage(msg);
    });


    // Handle when the host leaves during the game and a new host is assigned
    socket.off('newHost');

socket.on('newHost', ({ newHostId, message }) => {
  socket.off('newHost');
  if (socket.id === newHostId) {
    setIsHost(true);  // Update the front-end logic to reflect the new host

  }
  alert(message);  // Display the host change message

});

// Handle when a player disconnects during the game
socket.on('playerDisconnected', ({ playerId, playerName, remainingPlayers, allPlayers }) => {
  setPlayers(allPlayers);  // Update to show all players including disconnected ones
  console.log(`Player ${playerName} disconnected`);
});

// Handle when a player reconnects during the game
socket.on('playerReconnected', ({ playerId, playerName: reconnectedPlayerName, allPlayers }) => {
  setPlayers(allPlayers);  // Update to show all players with reconnected player no longer disconnected
  console.log(`Player ${reconnectedPlayerName} reconnected`);
  
  // No auto-refresh here - let the immediate refresh on connection handle this
});

// Handle when a player leaves during the game (old event, kept for compatibility)
socket.on('playerLeft', ({ playerId, remainingPlayers }) => {
  setPlayers(remainingPlayers);  // Update the player list with remaining players
  // Optionally remove player icon from the game UI
});


// Handle when the game is over due to all players disconnecting
socket.off('gameOver');
socket.on('gameOver', (message) => {
  alert(message);  // Notify the players
  // Redirect everyone back to the main screen
  setGameState('startOrJoin');
});



    socket.on('hostLeft', () => {
      alert('The host has left the game. Returning to the start screen.');
      setGameState('startOrJoin');
      setPlayers([]);
      setRoomCode('');
    });

    return () => {
      socket.off('joinedRoom');
      socket.off('updatePlayers');
      socket.off('gameStarted');
      socket.off('distributeDrinks');
      socket.off('updatePlayerStats');
      socket.off('error');
      socket.off('hostLeft');
    };
  }, [players]);

  // UI for the initial screen to enter the player name
  if (gameState === 'initial') {
    return (
      <div className="intro-with-image centered-container"> 
        <h1>ShotGun Formation</h1>
        <form onSubmit={handleNameSubmit}>
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            autoFocus  // Automatically focus on this input field
          />
          <button type="submit">Submit</button>
        </form>
        {errorMessage && <p>{errorMessage}</p>}
      </div>
    );
  }

  // UI for connecting state (auto-rejoin in progress)
  if (gameState === 'connecting') {
    return (
      <div className="centered-container">
        <h1>Connecting...</h1>
        <p>Attempting to rejoin game for {playerName}</p>
        <p>Room: {roomCode}</p>
        <div style={{fontSize: '24px', margin: '20px'}}>🔄</div>
        <p style={{fontSize: '14px', color: '#666'}}>Please wait while we connect you to your game...</p>
      </div>
    );
  }

  // UI for start/join game screen
  if (gameState === 'startOrJoin') {
    return (
      
      <div className="centered-container">
        <h1>Welcome, {playerName}</h1>
        <button onClick={startGame}>Start a Lobby</button>
        <div>
          <input
            type="text"
            placeholder="Enter room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            autoFocus  // Automatically focus on this input field
          />
          <button onClick={joinGame}>Join Game</button>
          <button onClick={() => setGameState('initial')}>Back</button>
        </div>
        {errorMessage && <p>{errorMessage}</p>}
      </div>
    );
  }

  // UI for the lobby screen
  if (gameState === 'lobby') {
    return (
      <div className="lobby-container">
        <h1>Lobby</h1>
        <p>Room Code: {roomCode}</p>
        <p>Players in the lobby:</p>
        <ul className="players-list">
          {players.map((player) => (
            <li key={player.id} style={{ fontWeight: player.id === socket.id ? 'bold' : 'normal' }}>
              {player.name} {player.id === socket.id ? '(You)' : ''}
            </li>
          ))}
        </ul>
        <p>Total Players: {players.length}</p>
        {isHost && players.length >= 3 && (
          <button onClick={startTheGame}>Start Game</button>
        )}
        <button onClick={leaveLobby}>Leave Lobby</button>
      </div>
    );
  }

// UI for the game screen
if (gameState === 'game') {
  const isDisabled = isHostSelection && !isMenuOpen; // Disable game elements when host selection is open, but not when the menu is open

  return (
    <div className="game-table">
      <h2>ShotGun Formation!</h2>

 
      {/* Quarter and room code Display in the top right */}
      <div style={{ position: 'fixed', top: '20px', right: '20px' }}>
      <h3>Room Code: {roomCode}</h3> {/* Display the room code */}
        <h3>QTR: {quarter}</h3> {/* Display the current quarter */}
      </div>
      {/* Player Icons (Top, 2 rows) */}
      <div className="player-icons-container">
        {players.map((player) => (
          <div key={player.id || player.name} className="player-icon">
            <h3>{player.name}</h3>
            <div className="player-image"></div> {/* Div that holds the background image */}
            <div className="player-stats">
            <div>Total Drinks: {playerStats[player.id]?.totalDrinks || 0}</div>
        <div>Shotguns: {playerStats[player.id]?.totalShotguns || 0}</div>
                  </div>
          </div>
        ))}
      </div>
      {/* Wrapping game elements in a container */}
      <div className={`game-elements-container ${isDisabled ? 'game-elements-disabled' : ''}`}>
        {/* Show the action cards for all players, but only allow the host to click */}
        <div className="standard-cards-row">
          {actionMessage && (
            <p className="action-in-progress-message">
              An action is already in progress. Please wait for the round to end.
            </p>
          )}

        </div>
   
        {/* Player's hand and drink assignment area */}
        <div className="player-area">
          {players.map((player) => (
            <div key={player.id} className={player.id === socket.id ? "your-hand" : "other-player"}>
              {player.id === socket.id ? (
                <>
           <h2>Your Hand {isHost && "(Host)"}</h2>
          <ul className="your-hand-cards">
            {/* Ensure the player's cards are defined and render both standard and wild cards */}
            {player.cards?.standard?.map((card, index) => (
              <li key={index} className="card">
             <div className="card-name">{card.card}</div>   {/* Card Name at the top */}
      <div className="drink-count">{card.drinks} Drinks</div>  {/* Drink count at the bottom */}
                {card.card}
              </li>
            ))}

{player.cards?.wild?.map((card, index) => (
  <li key={`wild-${index}`} className="card">
    <button
      className="wild-card-content-button"
      onClick={() => handleWildCardSelect(card.card)}
    >
      <div className="card-name">{card.card}</div> {/* Card Name */}
      <div className="drink-count">
        {card.drinks >= 10 
          ? `${Math.floor(card.drinks / 10)} Shotgun${Math.floor(card.drinks / 10) > 1 ? 's' : ''}`
          : `${card.drinks} Drink${card.drinks > 1 ? 's' : ''}`}
      </div> {/* Shotgun or Drink Count */}
    </button>
  </li>
))}
          </ul>
              {/* Wild Card Confirmation Modal */}
{wildCardSelected && isHost && (
  <div className="modal-overlay">
    <div className="wild-card-confirmation-modal modal-content">
      <h3>Wild Card Confirmation</h3>
      <p>A player declared wild card "{wildCardSelected.wildcardtype}". Confirm this action?</p>
      <div className="modal-buttons">
        <button onClick={() => confirmWildCard(true)}>Yes</button>
        <button onClick={() => confirmWildCard(false)}>No</button>
      </div>
    </div>
  </div>
)}

          {/* Drink assignment UI Modal with Timer */}
{timeRemaining > 0 && declaredCard !== 'First Down' && (
  <div className="drink-assignment-modal">
    <div className="modal-content">
      <h3>Card Played: {declaredCard}</h3>
      <p>Time Remaining: {timeRemaining} seconds</p>

      {/* Conditional rendering for drink assignment UI */}
      {(declaredCard !== 'First Down' &&
        (player.cards?.standard?.some(card => card.card === declaredCard) ||
        player.cards?.wild?.some(card => card.card === declaredCard)) &&
        isDistributing && (drinksToGive > 0 || shotgunsToGive > 0)) && (
        <div>
          <p>{drinkMessage}</p>
          {players.filter(p => p.id !== socket.id || p.name !== playerName).map(p => (
            <div key={p.id || p.name}>
              {drinksToGive > 0 && (
                <button onClick={() => handleGiveDrink(p.id || p.name, 'drink')}>
                  Give Drink to {p.name} ({assignedDrinks?.drinks?.[p.id || p.name] || 0})
                </button>
              )}
              {shotgunsToGive > 0 && (
                <button onClick={() => handleGiveDrink(p.id || p.name, 'shotgun')}>
                  Give Shotgun to {p.name} ({assignedDrinks?.shotguns?.[p.id || p.name] || 0})
                </button>
              )}
            </div>
          ))}
        </div>
      )}


      
      {/* Close the modal automatically if time reaches 0 */}
      {timeRemaining === 0 && closeModal('drinkAssignmentModal')}
    </div>
  </div>
)}

      {/* No Card Message Modal */}
      {noCardMessage && (
  <div className="drink-assignment-modal">
    <div className="modal-content">
      <h3>No Drinks</h3>
      <p>No one had this card.</p>
    </div>
  </div>
)}

{/* First Down message modal */}
{declaredCard === 'First Down' && timeRemaining > 0 && (
  <div className="first-down-modal">
    <div className="modal-content">
      <h3>First Down!</h3>
      <p>Everyone drinks once!</p>
      <p>Time Remaining: {timeRemaining} seconds</p>
      {timeRemaining === 0 && closeModal('firstDownModal')}
    </div>
  </div>
)}

                </>
              ) : (
                <div className="player-icon">
                <h3>{}</h3>
              </div>
              )}
            </div>
          ))}
        </div>

        {/* Wild Card Swap Modal */}
{isWildCardSelectionOpen && (
  <div className="modal-overlay">
    <div className="wild-card-swap-modal">
      <h3>Select a Wild Card to Discard and return a new one</h3>
      <ul>
        {players.find(p => p.id === socket.id)?.cards.wild.map((card, index) => (
          <li key={index}>
            <button
              onClick={() => handleSelectWildCardToDiscard(card)}
              style={{
                backgroundColor: selectedWildCardToDiscard === card ? '#f00' : '#fff', // Highlight selected card
                color: selectedWildCardToDiscard === card ? '#fff' : '#000', // Adjust text color
              }}
            >
              {card.card ? card.card : JSON.stringify(card)} {/* Fix wild card rendering */}
            </button>
          </li>
        ))}
      </ul>
      <button onClick={confirmWildCardSwap} disabled={!selectedWildCardToDiscard}>
        Confirm Swap
      </button>
      <button onClick={() => setIsWildCardSelectionOpen(false)}>Cancel</button>
    </div>
  </div>
)}

{/* Declare Action Button for Host */}
{isHost && (
  <div style={{ position: 'fixed', bottom: '20px', left: '20px' }}>
    <button className="action-button" onClick={handleDeclareAction}>
      Declare Action
    </button>
  </div>
)}
{isActionModalOpen && (
  <div className="modal-overlay">
    <div className="modal-content">
      <h3>Select an Action</h3>
      <button onClick={() => handleCardClick('Touchdown')}>Touchdown</button>
      <button onClick={() => handleCardClick('Field Goal')}>Field Goal</button>
      <button onClick={() => handleCardClick('Turnover')}>Turnover</button>
      <button onClick={() => handleCardClick('Sacks')}>Sacks</button>
      <button onClick={() => handleCardClick('Penalty')}>Penalty</button>
      <button onClick={() => handleCardClick('First Down')}>First Down</button>
      <button onClick={() => setIsActionModalOpen(false)}>Close</button> {/* Close button */}
    </div>
  </div>
)}
        {/* Menu Button in the bottom right */}
        <div style={{ position: 'fixed', bottom: '20px', right: '20px' }}>
          <button onClick={toggleMenu}>Menu</button>

          {isMenuOpen && (
            <div className="menu-modal">
              <div className="menu-content">
                <h3>Game Menu</h3>
                <button onClick={handleLeaveGame}>Leave Game</button>
                {isHost && <button onClick={handleHostSwap}>Swap Host</button>}
                {isHost && <button onClick={handleNextQuarter}>Next QTR</button>}
                <button onClick={handleShowInstructions}>Instructions</button>
                <button onClick={closeMenu}>Close</button>
              </div>
            </div>
          )}
        </div>

        {/* Show host selection modal if in progress */}
        {!isDisabled && isHostSelection && (
          <div className="host-selection-modal">
            <h3>Select a New Host</h3>
            <ul>
              {players.filter(p => p.id !== socket.id).map((player) => (
                <li key={player.id}>
                  <button onClick={() => handleSelectNewHost(player.id)}>
                    Assign {player.name} as Host
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={closeHostSelection}>Cancel</button>
          </div>
        )}

    {/* Player Stats and Round Results (Right Side) */}
    <div className="player-stats-container">
        <h3>Round Results:</h3>
        <ul>
          {Object.entries(roundDrinkResults).map(([id, result]) => (
            <li key={id}>
              {players.find(p => p.id === id)?.name} received {result.drinks} drink{result.drinks !== 1 ? 's' : ''}
              {result.shotguns > 0 && ` and ${result.shotguns} shotgun${result.shotguns > 1 ? 's' : ''}`}
            </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
return null;
}
export default App;

