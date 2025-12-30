const io = require('socket.io-client');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const socket = io('http://localhost:3001');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testScenarios() {
  console.log('🧪 Testing the fixes...\n');
  
  await sleep(1000);
  
  console.log('✅ Connected to server');
  console.log('Socket ID:', socket.id);
  
  console.log('\n🧪 TEST SCENARIO 1: User manually joins room (should trigger rules popup)');
  console.log('   - Creating room 12345 first...');
  
  socket.emit('createRoom', '12345', 'TestHost');
  await sleep(1000);
  
  console.log('   - Now joining room 54321 as new player (simulating form input priority)...');
  socket.emit('joinRoom', '54321', 'TestPlayer');
  
  await sleep(2000);
  
  console.log('\n🧪 TEST SCENARIO 2: Testing URL update behavior...');
  // The frontend logic should now prioritize form input (54321) over any URL params
  
  console.log('\nℹ️  Frontend Testing Notes:');
  console.log('   1. Open browser to http://localhost:3000');
  console.log('   2. Test Scenario 1: URL has ?room=12345, type 54321 in form, click Join');
  console.log('      Expected: Joins 54321 (form input wins) + shows rules popup');
  console.log('   3. Test Scenario 2: Empty form, URL has ?room=12345, click Join');
  console.log('      Expected: Joins 12345 (URL fallback) + shows rules popup');
  console.log('   4. Test Scenario 3: Click "Start a Lobby"');
  console.log('      Expected: Shows rules popup (existing behavior)');
  console.log('   5. Test Scenario 4: Join any room successfully');
  console.log('      Expected: Shows rules popup (new behavior)');
  
  console.log('\n🔍 To test manually:');
  console.log('   1. Open: http://localhost:3000?room=12345');
  console.log('   2. Enter name, type "54321" in room code field');
  console.log('   3. Click "Join Game"');
  console.log('   4. Should join room 54321 (not 12345) and show rules popup');
  
  await sleep(2000);
  
  socket.disconnect();
  console.log('\n✅ Test setup complete. Please test manually in browser.');
  process.exit(0);
}

socket.on('connect', () => {
  testScenarios().catch(console.error);
});

socket.on('error', (error) => {
  console.log('Socket error:', error);
});

socket.on('roomCreated', (roomCode) => {
  console.log('   ✅ Room created:', roomCode);
});

socket.on('joinedRoom', (roomCode) => {
  console.log('   ✅ Joined room:', roomCode);
  console.log('   ℹ️  In browser, this should now trigger rules popup');
});

socket.on('roomNotFound', () => {
  console.log('   ⚠️  Room not found (expected for test room 54321)');
});