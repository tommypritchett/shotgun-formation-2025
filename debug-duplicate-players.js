const { chromium } = require('playwright');

async function simulatePlayerDuplicateIssue() {
  console.log('🧪 Testing duplicate player issue with disconnect/reconnect...');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    // Create multiple browser contexts to simulate different devices
    const hostContext = await browser.newContext();
    const player2Context = await browser.newContext();
    const player3Context = await browser.newContext(); // This will be our iPhone simulator
    
    // Step 1: Host creates room
    console.log('📱 Step 1: Host creates room...');
    const hostPage = await hostContext.newPage();
    await hostPage.goto('http://localhost:3001');
    await hostPage.fill('input[placeholder="Enter your name"]', 'Host');
    await hostPage.click('button:has-text("Start a Lobby")');
    await hostPage.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    const roomUrl = hostPage.url();
    console.log(`✅ Room created: ${roomUrl}`);
    
    // Step 2: Player 2 joins
    console.log('📱 Step 2: Player 2 joins...');
    const player2Page = await player2Context.newPage();
    await player2Page.goto(roomUrl);
    await player2Page.fill('input[placeholder="Enter your name"]', 'Player2');
    await player2Page.click('button:has-text("Join Game")');
    await player2Page.waitForSelector('.lobby-container', { timeout: 5000 });
    
    // Step 3: Player 3 joins (our iPhone simulator)
    console.log('📱 Step 3: Player 3 joins (iPhone simulator)...');
    const player3Page = await player3Context.newPage();
    await player3Page.goto(roomUrl);
    await player3Page.fill('input[placeholder="Enter your name"]', 'iPhone_Player');
    await player3Page.click('button:has-text("Join Game")');
    await player3Page.waitForSelector('.lobby-container', { timeout: 5000 });
    
    // Step 4: Start the game
    console.log('📱 Step 4: Starting game...');
    await hostPage.click('button:has-text("Start Game")');
    await hostPage.waitForSelector('.game-header', { timeout: 10000 });
    console.log('✅ Game started');
    
    // Check initial player count
    const initialPlayers = await hostPage.locator('.player-icon').count();
    console.log(`🎯 Initial player count: ${initialPlayers}`);
    
    // Step 5: Simulate iPhone app switch (stealth disconnect)
    console.log('📱 Step 5: Simulating iPhone app switch (stealth disconnect)...');
    
    // Listen to console logs on all pages
    hostPage.on('console', msg => console.log('🖥️ HOST:', msg.text()));
    player2Page.on('console', msg => console.log('🖥️ P2:', msg.text()));
    player3Page.on('console', msg => console.log('🖥️ iPhone:', msg.text()));
    
    // Simulate the iPhone player losing connection (like switching apps)
    await player3Page.close(); // This simulates the connection dropping
    console.log('📱 iPhone player disconnected (app switch)');
    
    // Wait for server to process disconnect
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check player count after disconnect on host
    const afterDisconnectPlayers = await hostPage.locator('.player-icon').count();
    console.log(`🎯 Player count after disconnect: ${afterDisconnectPlayers}`);
    
    // Step 6: iPhone player returns (reconnects)
    console.log('📱 Step 6: iPhone player returns from app switch...');
    const newPlayer3Page = await player3Context.newPage();
    
    // Simulate returning to the game URL (this is what happens on mobile)
    await newPlayer3Page.goto(roomUrl);
    
    // Wait for reconnection logic to trigger
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check player count after reconnection on all devices
    const hostPlayersAfterReconnect = await hostPage.locator('.player-icon').count();
    const p2PlayersAfterReconnect = await player2Page.locator('.player-icon').count();
    const iPhonePlayersAfterReconnect = await newPlayer3Page.locator('.player-icon').count();
    
    console.log(`🎯 Player counts after reconnection:`);
    console.log(`   Host sees: ${hostPlayersAfterReconnect} players`);
    console.log(`   Player2 sees: ${p2PlayersAfterReconnect} players`);
    console.log(`   iPhone sees: ${iPhonePlayersAfterReconnect} players`);
    
    // Step 7: Trigger an action to see if duplicates appear
    console.log('📱 Step 7: Triggering action to test for duplicates...');
    
    // Host plays a standard card
    await hostPage.click('.card:first-child');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check final player counts after action
    const finalHostPlayers = await hostPage.locator('.player-icon').count();
    const finalP2Players = await player2Page.locator('.player-icon').count();
    const finalIPhonePlayers = await newPlayer3Page.locator('.player-icon').count();
    
    console.log(`🎯 Final player counts after action:`);
    console.log(`   Host sees: ${finalHostPlayers} players`);
    console.log(`   Player2 sees: ${finalP2Players} players`);
    console.log(`   iPhone sees: ${finalIPhonePlayers} players`);
    
    // Step 8: Check for duplicate names in UI
    console.log('📱 Step 8: Checking for duplicate player names...');
    
    const hostPlayerNames = await hostPage.locator('.player-icon h3').allTextContents();
    const p2PlayerNames = await player2Page.locator('.player-icon h3').allTextContents();
    const iPhonePlayerNames = await newPlayer3Page.locator('.player-icon h3').allTextContents();
    
    console.log(`👤 Host sees players: ${JSON.stringify(hostPlayerNames)}`);
    console.log(`👤 Player2 sees players: ${JSON.stringify(p2PlayerNames)}`);
    console.log(`👤 iPhone sees players: ${JSON.stringify(iPhonePlayerNames)}`);
    
    // Check for duplicates
    const hostDuplicates = hostPlayerNames.filter((name, index) => hostPlayerNames.indexOf(name) !== index);
    const p2Duplicates = p2PlayerNames.filter((name, index) => p2PlayerNames.indexOf(name) !== index);
    const iPhoneDuplicates = iPhonePlayerNames.filter((name, index) => iPhonePlayerNames.indexOf(name) !== index);
    
    if (hostDuplicates.length > 0) {
      console.log(`❌ DUPLICATE FOUND on Host: ${JSON.stringify(hostDuplicates)}`);
    }
    if (p2Duplicates.length > 0) {
      console.log(`❌ DUPLICATE FOUND on Player2: ${JSON.stringify(p2Duplicates)}`);
    }
    if (iPhoneDuplicates.length > 0) {
      console.log(`❌ DUPLICATE FOUND on iPhone: ${JSON.stringify(iPhoneDuplicates)}`);
    }
    
    if (hostDuplicates.length === 0 && p2Duplicates.length === 0 && iPhoneDuplicates.length === 0) {
      console.log(`✅ SUCCESS: No duplicate players found!`);
    } else {
      console.log(`❌ FAILURE: Duplicate players detected!`);
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the simulation
simulatePlayerDuplicateIssue().catch(console.error);