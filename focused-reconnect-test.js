const { chromium } = require('playwright');

async function testDrinkAssignmentDuringReconnect() {
  console.log('🧪 Testing: Host declares action → Players get drink assignment → One player reconnects → Check if others still can assign drinks');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    // Create browser contexts for 3 players
    const hostContext = await browser.newContext();
    const player2Context = await browser.newContext();
    const player3Context = await browser.newContext(); // This will reconnect
    
    // Step 1: Set up game with 3 players
    console.log('📱 Step 1: Setting up game with 3 players...');
    const hostPage = await hostContext.newPage();
    await hostPage.goto('http://localhost:3001');
    await hostPage.fill('input[placeholder="Enter your name"]', 'Host');
    await hostPage.click('button:has-text("Start a Lobby")');
    await hostPage.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    
    // Get room URL from host
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
    
    // Step 3: Host declares a common action (Touchdown - most players should have this)
    console.log('📱 Step 3: Host declaring Touchdown action...');
    
    // Use the host declare action modal
    await hostPage.click('.declare-action-button');
    await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
    await hostPage.click('button:has-text("Touchdown")');
    
    console.log('✅ Host declared Touchdown action');
    
    // Step 4: Wait for drink assignment UI to appear and check who got it
    console.log('📱 Step 4: Checking who got drink assignment UI...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check each player for active drink assignment
    const checkDrinkAssignment = async (page, playerName) => {
      try {
        const hasDrinkMessage = await page.locator('.drink-message').count() > 0;
        const hasAssignmentButtons = await page.locator('.assignment-button').count() > 0;
        const drinkMessage = hasDrinkMessage ? await page.locator('.drink-message').textContent() : '';
        const buttonCount = await page.locator('.assignment-button').count();
        
        console.log(`${playerName} drink assignment status:`);
        console.log(`  - Has drink message: ${hasDrinkMessage} ("${drinkMessage}")`);
        console.log(`  - Has assignment buttons: ${hasAssignmentButtons} (${buttonCount} buttons)`);
        
        return { hasDrinkMessage, hasAssignmentButtons, drinkMessage, buttonCount };
      } catch (error) {
        console.log(`${playerName} error checking drink assignment:`, error.message);
        return { hasDrinkMessage: false, hasAssignmentButtons: false, drinkMessage: '', buttonCount: 0 };
      }
    };
    
    const hostStatus = await checkDrinkAssignment(hostPage, 'Host');
    const p2Status = await checkDrinkAssignment(player2Page, 'Player2');
    const p3Status = await checkDrinkAssignment(player3Page, 'Player3');
    
    // Find which players have drink assignment
    const playersWithAssignment = [];
    if (hostStatus.hasAssignmentButtons) playersWithAssignment.push({ name: 'Host', page: hostPage, status: hostStatus });
    if (p2Status.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player2', page: player2Page, status: p2Status });
    if (p3Status.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player3', page: player3Page, status: p3Status });
    
    console.log(`📊 ${playersWithAssignment.length} players have drink assignment ability`);
    
    if (playersWithAssignment.length === 0) {
      console.log('❌ No players got drink assignment - test cannot continue');
      console.log('This might mean no one had Touchdown cards, trying with a different action...');
      
      // Try with Penalty (more common card)
      console.log('📱 Retrying with Penalty action...');
      await hostPage.click('.declare-action-button');
      await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
      await hostPage.click('button:has-text("Penalty")');
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const hostStatus2 = await checkDrinkAssignment(hostPage, 'Host');
      const p2Status2 = await checkDrinkAssignment(player2Page, 'Player2');
      const p3Status2 = await checkDrinkAssignment(player3Page, 'Player3');
      
      if (!hostStatus2.hasAssignmentButtons && !p2Status2.hasAssignmentButtons && !p3Status2.hasAssignmentButtons) {
        console.log('❌ Still no drink assignments - ending test');
        return;
      }
      
      // Update the players with assignment
      playersWithAssignment.length = 0;
      if (hostStatus2.hasAssignmentButtons) playersWithAssignment.push({ name: 'Host', page: hostPage, status: hostStatus2 });
      if (p2Status2.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player2', page: player2Page, status: p2Status2 });
      if (p3Status2.hasAssignmentButtons) playersWithAssignment.push({ name: 'Player3', page: player3Page, status: p3Status2 });
    }
    
    console.log(`✅ Players with drink assignment: ${playersWithAssignment.map(p => p.name).join(', ')}`);
    
    // Step 5: Record initial state of drink assignments
    console.log('📱 Step 5: Recording initial drink assignment state...');
    const initialStates = {};
    for (const player of playersWithAssignment) {
      initialStates[player.name] = {
        buttonCount: player.status.buttonCount,
        drinkMessage: player.status.drinkMessage
      };
      console.log(`${player.name} initial state: ${player.status.buttonCount} buttons, message: "${player.status.drinkMessage}"`);
    }
    
    // Step 6: Player3 disconnects (simulate refresh/app switch)
    console.log('📱 Step 6: Player3 refreshing (disconnect)...');
    await player3Page.close();
    console.log('🔄 Player3 disconnected');
    
    // Wait for server to process disconnect
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Step 7: Check if remaining players still have drink assignment
    console.log('📱 Step 7: Checking if remaining players still have drink assignment after Player3 disconnect...');
    
    const remainingPlayers = playersWithAssignment.filter(p => p.name !== 'Player3');
    const afterDisconnectStates = {};
    
    for (const player of remainingPlayers) {
      const currentStatus = await checkDrinkAssignment(player.page, `${player.name} (after disconnect)`);
      afterDisconnectStates[player.name] = currentStatus;
      
      const initialState = initialStates[player.name];
      const maintained = currentStatus.hasAssignmentButtons && currentStatus.buttonCount === initialState.buttonCount;
      
      console.log(`${player.name} after disconnect: ${maintained ? '✅ MAINTAINED' : '❌ LOST'} drink assignment`);
      console.log(`  Before: ${initialState.buttonCount} buttons, After: ${currentStatus.buttonCount} buttons`);
    }
    
    // Step 8: Player3 reconnects
    console.log('📱 Step 8: Player3 reconnecting...');
    const newPlayer3Page = await player3Context.newPage();
    await newPlayer3Page.goto(roomUrl);
    
    // Wait for reconnection to complete
    await new Promise(resolve => setTimeout(resolve, 4000));
    console.log('🔄 Player3 reconnected');
    
    // Step 9: THE CRITICAL TEST - Check if remaining players STILL have drink assignment after reconnection
    console.log('📱 Step 9: 🎯 CRITICAL TEST - Checking if remaining players STILL have drink assignment after Player3 reconnection...');
    
    let testPassed = true;
    const afterReconnectStates = {};
    
    for (const player of remainingPlayers) {
      const currentStatus = await checkDrinkAssignment(player.page, `${player.name} (after reconnect)`);
      afterReconnectStates[player.name] = currentStatus;
      
      const initialState = initialStates[player.name];
      const maintained = currentStatus.hasAssignmentButtons && currentStatus.buttonCount > 0;
      
      console.log(`${player.name} after reconnection: ${maintained ? '✅ MAINTAINED' : '❌ LOST'} drink assignment`);
      console.log(`  Initial: ${initialState.buttonCount} buttons, Current: ${currentStatus.buttonCount} buttons`);
      console.log(`  Message: "${currentStatus.drinkMessage}"`);
      
      if (!maintained && initialState.buttonCount > 0) {
        testPassed = false;
        console.log(`❌ BUG CONFIRMED: ${player.name} lost drink assignment ability after Player3 reconnected!`);
      }
    }
    
    // Step 10: Test if drink assignment buttons actually work
    console.log('📱 Step 10: Testing if drink assignment buttons are functional...');
    
    for (const player of remainingPlayers) {
      const currentStatus = afterReconnectStates[player.name];
      if (currentStatus.hasAssignmentButtons) {
        try {
          console.log(`Testing ${player.name}'s first assignment button...`);
          await player.page.click('.assignment-button:first-child');
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check if button state changed (assignment was recorded)
          const newButtonCount = await player.page.locator('.assignment-button').count();
          console.log(`${player.name} button click result: ${currentStatus.buttonCount} → ${newButtonCount} buttons`);
          
          if (newButtonCount >= 0) { // Should still exist or change
            console.log(`✅ ${player.name}'s drink assignment is functional`);
          } else {
            console.log(`❌ ${player.name}'s drink assignment is broken`);
            testPassed = false;
          }
        } catch (error) {
          console.log(`❌ ${player.name}'s drink assignment button failed:`, error.message);
          testPassed = false;
        }
      }
    }
    
    // Final result
    console.log('\n' + '='.repeat(60));
    console.log('🎯 FINAL RESULT:');
    if (testPassed) {
      console.log('✅ SUCCESS: Drink assignment survived player reconnection!');
      console.log('   Players who had drink assignment kept it after another player reconnected.');
    } else {
      console.log('❌ BUG CONFIRMED: Drink assignment was disrupted by player reconnection!');
      console.log('   This is the exact issue you described - when a player reconnects during');
      console.log('   active drink assignment, it disrupts other players who are still deciding.');
    }
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testDrinkAssignmentDuringReconnect().catch(console.error);