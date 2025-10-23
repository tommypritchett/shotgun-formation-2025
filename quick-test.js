// Quick test to check if isActionInProgress fix works
const io = require('socket.io-client');

console.log('🧪 Quick test: Checking if round completion works after isActionInProgress fix');

const hostSocket = io('http://localhost:3001');

hostSocket.on('connect', () => {
  console.log('✅ Connected');
  
  // Create room
  hostSocket.emit('createRoom', 'TestHost');
});

hostSocket.on('roomCreated', (roomCode) => {
  console.log('✅ Room created:', roomCode);
  
  // Add a second player
  const player2Socket = io('http://localhost:3001');
  
  player2Socket.on('connect', () => {
    console.log('✅ Player2 connected');
    player2Socket.emit('joinRoom', roomCode, 'TestPlayer2');
  });
  
  player2Socket.on('joinedRoom', () => {
    console.log('✅ Player2 joined');
    
    // Start game
    hostSocket.emit('startGame', roomCode);
  });
  
  hostSocket.on('gameStarted', (data) => {
    console.log('✅ Game started');
    console.log('💳 Host hand:', data.hands[hostSocket.id]?.standard?.map(c => c.card) || 'no hand data');
    
    // Monitor for updatePlayerStats events
    hostSocket.on('updatePlayerStats', (data) => {
      console.log('📥 updatePlayerStats:', {
        roundFinalized: data.roundFinalized,
        updateReason: data.updateReason,
        hasRoundResults: !!data.roundResults && Object.keys(data.roundResults).length > 0
      });
      
      if (data.roundFinalized) {
        console.log('🎉 SUCCESS: Round completed and finalized!');
        process.exit(0);
      }
    });
    
    // Monitor timer updates
    hostSocket.on('updateTimer', (timeRemaining) => {
      console.log(`⏰ Timer: ${timeRemaining}s`);
    });
    
    // Monitor for noCard message
    hostSocket.on('noCard', (message) => {
      if (message) {
        console.log('❌ No card message:', message);
      }
    });
    
    // Declare action
    setTimeout(() => {
      console.log('🎯 Declaring Penalty action...');
      hostSocket.emit('playStandardCard', { roomCode, cardType: 'Penalty' });
    }, 2000);
  });
});

hostSocket.on('error', (error) => {
  console.log('❌ Error:', error);
});

// Exit after 25 seconds if no success
setTimeout(() => {
  console.log('❌ TIMEOUT: Round did not complete within 25 seconds');
  console.log('This indicates the isActionInProgress fix did not work');
  process.exit(1);
}, 25000);