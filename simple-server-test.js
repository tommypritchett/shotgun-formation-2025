// Simple test to check server functionality
const io = require('socket.io-client');

async function testServerFlow() {
  console.log('🧪 Simple server test - checking if timer and finalizeRound work');
  
  try {
    // Connect as host
    const hostSocket = io('http://localhost:3001');
    
    await new Promise((resolve) => {
      hostSocket.on('connect', () => {
        console.log('✅ Host connected');
        resolve();
      });
    });
    
    // Create room
    hostSocket.emit('createRoom', 'TestHost');
    
    await new Promise((resolve) => {
      hostSocket.on('roomCreated', (roomCode) => {
        console.log('✅ Room created:', roomCode);
        
        // Connect player 2
        const player2Socket = io('http://localhost:3001');
        
        player2Socket.on('connect', () => {
          console.log('✅ Player2 connected');
          player2Socket.emit('joinRoom', roomCode, 'TestPlayer2');
        });
        
        player2Socket.on('joinedRoom', () => {
          console.log('✅ Player2 joined room');
          
          // Start game
          hostSocket.emit('startGame', roomCode);
        });
        
        hostSocket.on('gameStarted', () => {
          console.log('✅ Game started');
          
          // Listen for updatePlayerStats to see if it gets called
          hostSocket.on('updatePlayerStats', (data) => {
            console.log('📥 updatePlayerStats received by host:', {
              playersCount: Object.keys(data.players || {}).length,
              roundResultsCount: Object.keys(data.roundResults || {}).length,
              roundFinalized: data.roundFinalized,
              updateReason: data.updateReason
            });
          });
          
          player2Socket.on('updatePlayerStats', (data) => {
            console.log('📥 updatePlayerStats received by player2:', {
              playersCount: Object.keys(data.players || {}).length,
              roundResultsCount: Object.keys(data.roundResults || {}).length,
              roundFinalized: data.roundFinalized,
              updateReason: data.updateReason
            });
          });
          
          // Declare an action
          setTimeout(() => {
            console.log('🎯 Host declaring Penalty action...');
            hostSocket.emit('playStandardCard', { roomCode, cardType: 'Penalty' });
          }, 2000);
          
          // Listen for timer
          hostSocket.on('updateTimer', (timeRemaining) => {
            console.log(`⏰ Timer: ${timeRemaining} seconds remaining`);
          });
          
          resolve();
        });
      });
    });
    
    // Wait for test to complete
    await new Promise(resolve => setTimeout(resolve, 25000));
    
    console.log('✅ Test completed');
    hostSocket.disconnect();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testServerFlow();