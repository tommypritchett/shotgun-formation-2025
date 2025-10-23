// Simple test to verify round completion works
const io = require('socket.io-client');

console.log('🧪 Testing round completion and UI updates...');

async function testRoundCompletion() {
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
      
      hostSocket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
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

    // Connect second player
    const player2Socket = io('http://localhost:3001');
    
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

    // Connect third player (required for game start)
    const player3Socket = io('http://localhost:3001');
    
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

    // Set up monitoring for round completion
    let roundCompleted = false;
    let hostStatsUpdated = false;
    let player2StatsUpdated = false;
    let player3StatsUpdated = false;

    hostSocket.on('updatePlayerStats', (data) => {
      console.log('📥 Host received updatePlayerStats:', {
        roundFinalized: data.roundFinalized,
        updateReason: data.updateReason,
        playersCount: Object.keys(data.players || {}).length
      });
      
      if (data.roundFinalized) {
        roundCompleted = true;
        hostStatsUpdated = true;
        console.log('🎉 Host: Round completed and stats updated!');
      }
    });

    player2Socket.on('updatePlayerStats', (data) => {
      console.log('📥 Player2 received updatePlayerStats:', {
        roundFinalized: data.roundFinalized,
        updateReason: data.updateReason,
        playersCount: Object.keys(data.players || {}).length
      });
      
      if (data.roundFinalized) {
        player2StatsUpdated = true;
        console.log('🎉 Player2: Round completed and stats updated!');
      }
    });

    player3Socket.on('updatePlayerStats', (data) => {
      console.log('📥 Player3 received updatePlayerStats:', {
        roundFinalized: data.roundFinalized,
        updateReason: data.updateReason,
        playersCount: Object.keys(data.players || {}).length
      });
      
      if (data.roundFinalized) {
        player3StatsUpdated = true;
        console.log('🎉 Player3: Round completed and stats updated!');
      }
    });

    // Monitor timer
    hostSocket.on('updateTimer', (timeRemaining) => {
      console.log(`⏰ Timer: ${timeRemaining}s remaining`);
    });

    // Declare action
    console.log('🎯 Host declaring Touchdown action...');
    hostSocket.emit('playStandardCard', { roomCode, cardType: 'Touchdown' });

    // Wait for round to complete
    console.log('⏳ Waiting for round to complete...');
    
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (roundCompleted && hostStatsUpdated && player2StatsUpdated && player3StatsUpdated) {
        console.log('✅ SUCCESS: Round completed and ALL players received stats updates!');
        process.exit(0);
      }
      
      if (i === 29) {
        console.log('❌ TIMEOUT: Round did not complete properly');
        console.log(`Status: roundCompleted=${roundCompleted}, hostStatsUpdated=${hostStatsUpdated}, player2StatsUpdated=${player2StatsUpdated}, player3StatsUpdated=${player3StatsUpdated}`);
        process.exit(1);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testRoundCompletion();