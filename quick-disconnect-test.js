const { chromium } = require('playwright');

async function testQuickDisconnectDuringAssignment() {
  console.log('🧪 Quick Test: Check assignment state immediately after disconnect (before timer expires)');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    // Create browser contexts for 3 players
    const hostContext = await browser.newContext();
    const player2Context = await browser.newContext();
    const player3Context = await browser.newContext();
    
    // Step 1: Set up game with 3 players
    console.log('📱 Step 1: Setting up game with 3 players...');
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
    
    // Enable console logging to see the updateReason
    hostPage.on('console', msg => {
      if (msg.text().includes('Update reason') || msg.text().includes('preserving drink assignment')) {
        console.log('🖥️ HOST:', msg.text());
      }
    });
    player2Page.on('console', msg => {
      if (msg.text().includes('Update reason') || msg.text().includes('preserving drink assignment')) {
        console.log('🖥️ P2:', msg.text());
      }
    });
    
    // Step 3: Host declares Penalty (most common card)
    console.log('📱 Step 3: Host declaring Penalty action...');
    await hostPage.click('.declare-action-button');
    await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
    await hostPage.click('button:has-text("Penalty")');
    console.log('✅ Host declared Penalty action');
    
    // Step 4: QUICKLY check assignment state (within 2 seconds)
    console.log('📱 Step 4: QUICKLY checking assignment state...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    const checkQuickAssignment = async (page, playerName) => {
      try {
        const hasAssignmentButtons = await page.locator('.assignment-button').count() > 0;
        const buttonCount = await page.locator('.assignment-button').count();
        const drinkMessage = hasAssignmentButtons ? await page.locator('.drink-message').textContent() : '';
        
        console.log(`${playerName}: ${hasAssignmentButtons ? '✅' : '❌'} (${buttonCount} buttons) "${drinkMessage}"`);
        return { hasAssignmentButtons, buttonCount, drinkMessage };
      } catch (error) {
        console.log(`${playerName}: ❌ Error checking`);
        return { hasAssignmentButtons: false, buttonCount: 0, drinkMessage: '' };
      }
    };
    
    const hostStatus = await checkQuickAssignment(hostPage, 'Host');
    const p2Status = await checkQuickAssignment(player2Page, 'Player2');
    const p3Status = await checkQuickAssignment(player3Page, 'Player3');
    
    // Find players with assignment
    const playersWithAssignment = [];
    if (hostStatus.hasAssignmentButtons) playersWithAssignment.push({ name: 'Host', page: hostPage, status: hostStatus });
    if (p2Status.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player2', page: player2Page, status: p2Status });
    if (p3Status.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player3', page: player3Page, status: p3Status });
    
    if (playersWithAssignment.length === 0) {
      console.log('❌ No players got assignment - trying different card...');
      // Try Touchdown
      await hostPage.click('.declare-action-button');
      await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
      await hostPage.click('button:has-text("Touchdown")');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const hostStatus2 = await checkQuickAssignment(hostPage, 'Host');
      const p2Status2 = await checkQuickAssignment(player2Page, 'Player2');
      const p3Status2 = await checkQuickAssignment(player3Page, 'Player3');
      
      if (hostStatus2.hasAssignmentButtons) playersWithAssignment.push({ name: 'Host', page: hostPage, status: hostStatus2 });
      if (p2Status2.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player2', page: player2Page, status: p2Status2 });
      if (p3Status2.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player3', page: player3Page, status: p3Status2 });
    }
    
    if (playersWithAssignment.length === 0) {
      console.log('❌ Still no assignments - ending test');
      return;
    }
    
    console.log(`✅ Players with assignment: ${playersWithAssignment.map(p => p.name).join(', ')}`);
    
    // Step 5: IMMEDIATELY disconnect Player2 (non-host) while others have assignments
    console.log('📱 Step 5: IMMEDIATELY disconnecting Player2 (non-host)...');
    await player2Page.close();
    console.log('🔄 Player2 disconnected');
    
    // Step 6: IMMEDIATELY check remaining players (within 1 second of disconnect)
    console.log('📱 Step 6: IMMEDIATELY checking assignment after disconnect...');
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for server processing
    
    const remainingPlayers = playersWithAssignment.filter(p => p.name !== 'Player2');
    let assignmentSurvived = true;
    
    for (const player of remainingPlayers) {
      const currentStatus = await checkQuickAssignment(player.page, `${player.name} (post-disconnect)`);
      
      if (player.status.hasAssignmentButtons && !currentStatus.hasAssignmentButtons) {
        console.log(`❌ ${player.name} LOST assignment after disconnect!`);
        assignmentSurvived = false;
      } else if (player.status.hasAssignmentButtons && currentStatus.hasAssignmentButtons) {
        console.log(`✅ ${player.name} KEPT assignment after disconnect!`);
      }
    }
    
    // Step 7: Player2 reconnects
    console.log('📱 Step 7: Player2 reconnecting...');
    const newPlayer2Page = await player2Context.newPage();
    newPlayer2Page.on('console', msg => {
      if (msg.text().includes('Update reason') || msg.text().includes('preserving drink assignment')) {
        console.log('🖥️ P2_NEW:', msg.text());
      }
    });
    
    await newPlayer2Page.goto(roomUrl);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for reconnection
    console.log('🔄 Player2 reconnected');
    
    // Step 8: Check assignment state after reconnection
    console.log('📱 Step 8: Checking assignment after reconnection...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    let finalAssignmentState = true;
    
    for (const player of remainingPlayers) {
      const finalStatus = await checkQuickAssignment(player.page, `${player.name} (post-reconnect)`);
      
      if (player.status.hasAssignmentButtons && !finalStatus.hasAssignmentButtons) {
        console.log(`❌ ${player.name} LOST assignment after reconnection!`);
        finalAssignmentState = false;
      } else if (player.status.hasAssignmentButtons && finalStatus.hasAssignmentButtons) {
        console.log(`✅ ${player.name} KEPT assignment after reconnection!`);
      }
    }
    
    // Final result
    console.log('\n' + '='.repeat(50));
    console.log('🎯 QUICK TEST RESULT:');
    if (assignmentSurvived && finalAssignmentState) {
      console.log('✅ SUCCESS: Assignment state survived disconnect and reconnect!');
      console.log('   The fix is working - updateReason prevented state reset.');
    } else if (assignmentSurvived && !finalAssignmentState) {
      console.log('⚠️ PARTIAL: Assignment survived disconnect but lost on reconnect');
      console.log('   The fix partially works but reconnection still causes issues.');
    } else {
      console.log('❌ FAILURE: Assignment state was lost during disconnect');
      console.log('   Either timer expired or other issue occurred.');
    }
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testQuickDisconnectDuringAssignment().catch(console.error);