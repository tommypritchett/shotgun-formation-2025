const { chromium } = require('playwright');

async function testPlayer2RefreshImpact() {
  console.log('🧪 FOCUSED TEST: Player2 refreshes during assignment → Check impact on Host & Player3');
  console.log('================================================================================');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    // Create browser contexts for 3 players
    const hostContext = await browser.newContext();
    const player2Context = await browser.newContext(); // This player will refresh
    const player3Context = await browser.newContext();
    
    // Step 1: Set up game with 3 players
    console.log('📱 Step 1: Setting up game with Host, Player2, Player3...');
    const hostPage = await hostContext.newPage();
    await hostPage.goto('http://localhost:3001');
    await hostPage.fill('input[placeholder="Enter your name"]', 'Host');
    await hostPage.click('button:has-text("Start a Lobby")');
    await hostPage.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    
    const roomUrl = hostPage.url();
    console.log('🔗 Room URL:', roomUrl);
    
    const player2Page = await player2Context.newPage();
    await player2Page.goto(roomUrl);
    await player2Page.fill('input[placeholder="Enter your name"]', 'Player2');
    await player2Page.click('button:has-text("Join Game")');
    await player2Page.waitForSelector('.lobby-container', { timeout: 5000 });
    
    const player3Page = await player3Context.newPage();
    await player3Page.goto(roomUrl);
    await player3Page.fill('input[placeholder="Enter your name"]', 'Player3');
    await player3Page.click('button:has-text("Join Game")');
    await player3Page.waitForSelector('.lobby-container', { timeout: 5000 });
    
    // Step 2: Start the game
    console.log('📱 Step 2: Starting game...');
    await hostPage.click('button:has-text("Start Game")');
    await hostPage.waitForSelector('.game-header', { timeout: 10000 });
    console.log('✅ Game started successfully');
    
    // Wait for all players to load game state
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 3: Host declares Penalty action (common card)
    console.log('📱 Step 3: Host declaring Penalty action...');
    await hostPage.click('.declare-action-button');
    await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
    await hostPage.click('button:has-text("Penalty")');
    console.log('✅ Host declared Penalty action');
    
    // Step 4: Check who gets assignment UI (within first 3 seconds)
    console.log('📱 Step 4: Checking initial assignment state...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const checkAssignmentState = async (page, playerName) => {
      try {
        const hasButtons = await page.locator('.assignment-button').count() > 0;
        const buttonCount = await page.locator('.assignment-button').count();
        const message = hasButtons ? await page.locator('.drink-message').textContent() : '';
        
        console.log(`  ${playerName}: ${hasButtons ? '✅ HAS' : '❌ NO'} assignment (${buttonCount} buttons) - "${message}"`);
        return { hasButtons, buttonCount, message };
      } catch (error) {
        console.log(`  ${playerName}: ❌ ERROR checking state`);
        return { hasButtons: false, buttonCount: 0, message: '' };
      }
    };
    
    console.log('Initial assignment state:');
    const hostInitial = await checkAssignmentState(hostPage, 'Host');
    const player2Initial = await checkAssignmentState(player2Page, 'Player2');
    const player3Initial = await checkAssignmentState(player3Page, 'Player3');
    
    // Determine who has assignments
    const playersWithAssignment = [];
    if (hostInitial.hasButtons) playersWithAssignment.push('Host');
    if (player2Initial.hasButtons) playersWithAssignment.push('Player2');
    if (player3Initial.hasButtons) playersWithAssignment.push('Player3');
    
    if (playersWithAssignment.length === 0) {
      console.log('❌ No players got assignment - trying Touchdown...');
      
      // Try Touchdown
      await hostPage.click('.declare-action-button');
      await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
      await hostPage.click('button:has-text("Touchdown")');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log('Touchdown assignment state:');
      const hostInitial2 = await checkAssignmentState(hostPage, 'Host');
      const player2Initial2 = await checkAssignmentState(player2Page, 'Player2');
      const player3Initial2 = await checkAssignmentState(player3Page, 'Player3');
      
      playersWithAssignment.length = 0;
      if (hostInitial2.hasButtons) playersWithAssignment.push('Host');
      if (player2Initial2.hasButtons) playersWithAssignment.push('Player2');
      if (player3Initial2.hasButtons) playersWithAssignment.push('Player3');
    }
    
    if (playersWithAssignment.length < 2) {
      console.log('❌ Need at least 2 players with assignment to test impact - ending test');
      return;
    }
    
    console.log(`✅ Players with assignment: ${playersWithAssignment.join(', ')}`);
    
    // Step 5: 🎯 THE CRITICAL TEST - Player2 refreshes
    console.log('\n📱 Step 5: 🎯 CRITICAL TEST - Player2 refreshing...');
    console.log('🔄 Closing Player2 page (simulating refresh/app switch)...');
    await player2Page.close();
    
    // Small delay for server to process disconnect
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 6: Check impact on OTHER players immediately after Player2 disconnect
    console.log('📱 Step 6: Checking impact on OTHER players after Player2 disconnect...');
    
    console.log('Post-disconnect assignment state:');
    const hostPostDisconnect = await checkAssignmentState(hostPage, 'Host');
    const player3PostDisconnect = await checkAssignmentState(player3Page, 'Player3');
    
    // Analyze the impact
    let hostImpacted = false;
    let player3Impacted = false;
    
    if (hostInitial.hasButtons && !hostPostDisconnect.hasButtons) {
      console.log('❌ BUG: Host LOST assignment when Player2 disconnected!');
      hostImpacted = true;
    } else if (hostInitial.hasButtons && hostPostDisconnect.hasButtons) {
      console.log('✅ GOOD: Host KEPT assignment when Player2 disconnected');
    }
    
    if (player3Initial.hasButtons && !player3PostDisconnect.hasButtons) {
      console.log('❌ BUG: Player3 LOST assignment when Player2 disconnected!');
      player3Impacted = true;
    } else if (player3Initial.hasButtons && player3PostDisconnect.hasButtons) {
      console.log('✅ GOOD: Player3 KEPT assignment when Player2 disconnected');
    }
    
    // Step 7: Player2 reconnects
    console.log('\n📱 Step 7: Player2 reconnecting...');
    const newPlayer2Page = await player2Context.newPage();
    await newPlayer2Page.goto(roomUrl);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for full reconnection
    console.log('🔄 Player2 reconnected');
    
    // Step 8: Check impact on other players after Player2 reconnection
    console.log('📱 Step 8: Checking impact on OTHER players after Player2 reconnection...');
    
    console.log('Post-reconnection assignment state:');
    const hostPostReconnect = await checkAssignmentState(hostPage, 'Host');
    const player3PostReconnect = await checkAssignmentState(player3Page, 'Player3');
    
    // Analyze reconnection impact
    let hostReconnectImpacted = false;
    let player3ReconnectImpacted = false;
    
    if (hostPostDisconnect.hasButtons && !hostPostReconnect.hasButtons) {
      console.log('❌ BUG: Host LOST assignment when Player2 reconnected!');
      hostReconnectImpacted = true;
    } else if (hostPostDisconnect.hasButtons && hostPostReconnect.hasButtons) {
      console.log('✅ GOOD: Host KEPT assignment through Player2 reconnection');
    }
    
    if (player3PostDisconnect.hasButtons && !player3PostReconnect.hasButtons) {
      console.log('❌ BUG: Player3 LOST assignment when Player2 reconnected!');
      player3ReconnectImpacted = true;
    } else if (player3PostDisconnect.hasButtons && player3PostReconnect.hasButtons) {
      console.log('✅ GOOD: Player3 KEPT assignment through Player2 reconnection');
    }
    
    // Final analysis
    console.log('\n' + '='.repeat(80));
    console.log('🎯 FINAL ANALYSIS:');
    console.log('================================================================================');
    
    if (!hostImpacted && !player3Impacted && !hostReconnectImpacted && !player3ReconnectImpacted) {
      console.log('✅ SUCCESS: Player2 refresh had NO IMPACT on other players\' assignments!');
      console.log('   The roundFinalized flag fix is working correctly.');
    } else {
      console.log('❌ BUG CONFIRMED: Player2 refresh DISRUPTED other players\' assignments!');
      console.log('   The roundFinalized flag fix is NOT working.');
      
      console.log('\nSpecific impacts:');
      if (hostImpacted) console.log('   - Host lost assignment during Player2 disconnect');
      if (player3Impacted) console.log('   - Player3 lost assignment during Player2 disconnect');
      if (hostReconnectImpacted) console.log('   - Host lost assignment during Player2 reconnection');
      if (player3ReconnectImpacted) console.log('   - Player3 lost assignment during Player2 reconnection');
      
      console.log('\n🔍 ROOT CAUSE ANALYSIS NEEDED:');
      console.log('   The issue is likely in the server disconnect/reconnection handlers');
      console.log('   that send updatePlayerStats events during player connection changes.');
      console.log('   These events are resetting assignment state despite the roundFinalized flag.');
    }
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testPlayer2RefreshImpact().catch(console.error);