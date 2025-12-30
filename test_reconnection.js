const io = require('socket.io-client');

let player1, player2, player3;
let roomCode;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testReconnectionScenario() {
  console.log('🧪 Starting reconnection test scenario...\n');

  // Connect all players
  player1 = io('http://localhost:3001');
  player2 = io('http://localhost:3001');
  player3 = io('http://localhost:3001');

  await sleep(1000);

  // Player 1 creates room
  roomCode = Math.floor(10000 + Math.random() * 90000).toString();
  console.log(`📝 P1 creating room: ${roomCode}`);
  player1.emit('createRoom', roomCode, 'P1');

  await sleep(1000);

  // Players 2 and 3 join
  console.log('📝 P2 joining room');
  player2.emit('joinRoom', roomCode, 'P2');
  await sleep(500);

  console.log('📝 P3 joining room');
  player3.emit('joinRoom', roomCode, 'P3');
  await sleep(500);

  // Start game
  console.log('📝 P1 starting game');
  player1.emit('startGame', roomCode);
  await sleep(1000);

  // Simulate first round
  console.log('📝 Simulating First Down event...');
  player1.emit('firstDownEvent', roomCode);
  await sleep(8000); // Wait for round to finish

  // Simulate second round
  console.log('📝 Simulating second First Down event...');
  player1.emit('firstDownEvent', roomCode);
  await sleep(3000); // Wait partway through round

  // P3 disconnects during second round
  console.log('📝 P3 disconnecting during round...');
  player3.disconnect();
  await sleep(5000); // Let round finish

  // Simulate third round while P3 is offline
  console.log('📝 Simulating third First Down event (P3 offline)...');
  player1.emit('firstDownEvent', roomCode);
  await sleep(8000); // Wait for round to finish

  // P3 reconnects
  console.log('📝 P3 reconnecting...');
  player3 = io('http://localhost:3001');
  await sleep(1000);
  player3.emit('joinRoom', roomCode, 'P3');
  await sleep(2000);

  console.log('\n🧪 Test scenario complete. Check server logs for debug output.');
  
  // Cleanup
  setTimeout(() => {
    player1.disconnect();
    player2.disconnect();
    player3.disconnect();
    process.exit(0);
  }, 2000);
}

// Start test
testReconnectionScenario().catch(console.error);