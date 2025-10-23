// Realistic test that includes drink assignments
const io = require('socket.io-client');

console.log('🧪 Testing realistic round with drink assignments...');

async function testRoundWithAssignments() {
  try {
    // Connect host
    const hostSocket = io('http://localhost:3001');
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      
      hostSocket.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Host connected');
        resolve();
      });
    });

    // Create room
    hostSocket.emit('createRoom', 'TestHost');
    
    const roomCode = await new Promise((resolve) => {
      hostSocket.on('roomCreated', (code) => {
        console.log('✅ Room created:', code);
        resolve(code);
      });
    });

    // Connect players
    const player2Socket = io('http://localhost:3001');
    const player3Socket = io('http://localhost:3001');
    
    await new Promise((resolve) => {
      player2Socket.on('connect', () => {
        console.log('✅ Player2 connected');
        player2Socket.emit('joinRoom', roomCode, 'Player2');
        resolve();
      });
    });

    await new Promise((resolve) => {
      player2Socket.on('joinedRoom', () => {
        console.log('✅ Player2 joined');
        resolve();
      });
    });

    await new Promise((resolve) => {
      player3Socket.on('connect', () => {
        console.log('✅ Player3 connected');
        player3Socket.emit('joinRoom', roomCode, 'Player3');
        resolve();
      });
    });

    await new Promise((resolve) => {
      player3Socket.on('joinedRoom', () => {
        console.log('✅ Player3 joined');
        resolve();
      });
    });

    // Start game
    hostSocket.emit('startGame', roomCode);
    
    await new Promise((resolve) => {
      hostSocket.on('gameStarted', () => {
        console.log('✅ Game started');
        resolve();
      });
    });

    // Set up monitoring
    let roundCompleted = false;
    let roundResultsReceived = [];

    const trackStats = (playerName, socket) => {
      socket.on('updatePlayerStats', (data) => {
        console.log(`📥 ${playerName} received updatePlayerStats:`, {
          roundFinalized: data.roundFinalized,
          updateReason: data.updateReason,
          playersCount: Object.keys(data.players || {}).length,
          roundResultsCount: Object.keys(data.roundResults || {}).length
        });
        
        if (data.roundFinalized) {
          roundCompleted = true;
          roundResultsReceived.push(playerName);
          console.log(`🎉 ${playerName}: Round completed!`);
          
          // Log actual stats for debugging
          if (data.players) {
            Object.entries(data.players).forEach(([playerId, stats]) => {
              console.log(`  Player ${playerId}: ${stats.totalDrinks || 0} drinks, ${stats.totalShotguns || 0} shotguns`);
            });
          }
          
          if (data.roundResults) {
            console.log(`  Round results:`, data.roundResults);
          }
        }
      });
    };

    trackStats('Host', hostSocket);
    trackStats('Player2', player2Socket);
    trackStats('Player3', player3Socket);

    // Listen for drink distribution
    let assigningSocket = null;
    let assigningPlayer = '';
    
    [hostSocket, player2Socket, player3Socket].forEach((socket, index) => {
      const playerName = ['Host', 'Player2', 'Player3'][index];
      
      socket.on('distributeDrinks', (data) => {
        console.log(`🍺 ${playerName} received distributeDrinks:`, data);
        
        if (!assigningSocket) {
          assigningSocket = socket;
          assigningPlayer = playerName;
          
          // Assign drinks after a short delay
          setTimeout(() => {
            console.log(`🎯 ${playerName} assigning drinks...`);
            socket.emit('assignDrinks', {
              roomCode: roomCode,
              drinksToGive: { [player2Socket.id]: 1, [player3Socket.id]: 1 },
              shotgunsToGive: { [player2Socket.id]: 0, [player3Socket.id]: 0 }
            });
          }, 2000);
        }
      });
    });

    // Declare action
    console.log('🎯 Host declaring Penalty action...');
    hostSocket.emit('playStandardCard', { roomCode, cardType: 'Penalty' });

    // Wait for round to complete
    console.log('⏳ Waiting for round to complete...');
    
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (roundCompleted && roundResultsReceived.length === 3) {
        console.log('✅ SUCCESS: Round completed and ALL players received updates!');
        console.log(`Players who received updates: ${roundResultsReceived.join(', ')}`);
        process.exit(0);
      }
      
      if (i === 29) {
        console.log('❌ TIMEOUT: Round did not complete properly');
        console.log(`Round completed: ${roundCompleted}`);
        console.log(`Players received updates: ${roundResultsReceived.join(', ')}`);
        process.exit(1);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testRoundWithAssignments();