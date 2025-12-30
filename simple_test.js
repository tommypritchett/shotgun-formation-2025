const io = require('socket.io-client');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function quickReconnectTest() {
  // Connect P3 to existing room if available, or just test reconnection logic
  const player3 = io('http://localhost:3001');
  
  await sleep(1000);
  
  console.log('📝 P3 attempting to join room 53805 (if it exists)');
  player3.emit('joinRoom', '53805', 'P3');
  
  await sleep(3000);
  
  player3.disconnect();
  console.log('✅ Test complete');
  process.exit(0);
}

quickReconnectTest().catch(console.error);