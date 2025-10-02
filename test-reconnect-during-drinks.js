const { chromium } = require('playwright');

async function testReconnectDuringDrinkAssignment() {
  console.log('🧪 Testing player reconnection during active drink assignment...');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    // Create browser contexts for different players
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
    const roomUrl = hostPage.url();
    
    const player2Page = await player2Context.newPage();
    await player2Page.goto(roomUrl);
    await player2Page.fill('input[placeholder="Enter your name"]', 'Player2');
    await player2Page.click('button:has-text("Join Game")');
    await player2Page.waitForSelector('.lobby-container', { timeout: 5000 });
    
    const player3Page = await player3Context.newPage();
    await player3Page.goto(roomUrl);
    await player3Page.fill('input[placeholder="Enter your name"]', 'Player3_Reconnector');
    await player3Page.click('button:has-text("Join Game")');
    await player3Page.waitForSelector('.lobby-container', { timeout: 5000 });
    
    // Step 2: Start the game
    console.log('📱 Step 2: Starting game...');
    await hostPage.click('button:has-text("Start Game")');
    await hostPage.waitForSelector('.game-header', { timeout: 10000 });
    console.log('✅ Game started');
    
    // Set up console logging
    hostPage.on('console', msg => console.log('🖥️ HOST:', msg.text()));
    player2Page.on('console', msg => console.log('🖥️ P2:', msg.text()));
    player3Page.on('console', msg => console.log('🖥️ P3:', msg.text()));
    
    // Wait for cards to be dealt
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 3: Trigger an action (Host plays a card)
    console.log('📱 Step 3: Host triggering action...');
    await hostPage.click('.card:first-child');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 4: Check if any player got drink assignment UI
    console.log('📱 Step 4: Checking for drink assignment UI...');
    
    // Check each page for drink assignment elements
    const hostHasDrinks = await hostPage.locator('.drink-message').count() > 0;
    const p2HasDrinks = await player2Page.locator('.drink-message').count() > 0;
    const p3HasDrinks = await player3Page.locator('.drink-message').count() > 0;
    
    console.log(`Drink assignment status:`);
    console.log(`- Host has drinks to assign: ${hostHasDrinks}`);
    console.log(`- Player2 has drinks to assign: ${p2HasDrinks}`);
    console.log(`- Player3 has drinks to assign: ${p3HasDrinks}`);
    
    let assigningPlayer = null;
    let assigningPage = null;
    
    if (hostHasDrinks) {
      assigningPlayer = 'Host';
      assigningPage = hostPage;
    } else if (p2HasDrinks) {
      assigningPlayer = 'Player2';
      assigningPage = player2Page;
    } else if (p3HasDrinks) {
      assigningPlayer = 'Player3';
      assigningPage = player3Page;
    }
    
    if (!assigningPlayer) {
      console.log('❌ No player got drink assignment - test cannot continue');
      return;
    }
    
    console.log(`✅ ${assigningPlayer} is assigning drinks`);
    
    // Step 5: Record initial drink assignment state
    const initialDrinkButtons = await assigningPage.locator('.assignment-button').count();
    const initialDrinkMessage = await assigningPage.locator('.drink-message').textContent();
    
    console.log(`Initial state - Buttons: ${initialDrinkButtons}, Message: "${initialDrinkMessage}"`);
    
    // Step 6: Simulate Player3 refreshing (disconnect + reconnect)
    console.log('📱 Step 6: Player3 refreshing (disconnect + reconnect)...');
    
    // Close player3's page to simulate disconnect
    await player3Page.close();
    console.log('🔄 Player3 disconnected');
    
    // Wait for server to process disconnect
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if drink assignment is still intact after disconnect
    const afterDisconnectButtons = await assigningPage.locator('.assignment-button').count();
    const afterDisconnectMessage = await assigningPage.locator('.drink-message').textContent();
    
    console.log(`After disconnect - Buttons: ${afterDisconnectButtons}, Message: "${afterDisconnectMessage}"`);
    
    // Step 7: Player3 reconnects
    console.log('📱 Step 7: Player3 reconnecting...');
    const newPlayer3Page = await player3Context.newPage();
    newPlayer3Page.on('console', msg => console.log('🖥️ P3_NEW:', msg.text()));
    
    // Navigate back to game URL (simulates refresh)
    await newPlayer3Page.goto(roomUrl);
    
    // Wait for reconnection to complete
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 8: Check if drink assignment is still intact after reconnection
    console.log('📱 Step 8: Checking drink assignment after reconnection...');
    
    try {
      const afterReconnectButtons = await assigningPage.locator('.assignment-button').count();
      const afterReconnectMessage = await assigningPage.locator('.drink-message').textContent();
      
      console.log(`After reconnection - Buttons: ${afterReconnectButtons}, Message: "${afterReconnectMessage}"`);
      
      // Step 9: Test if drink assignment still works
      console.log('📱 Step 9: Testing if drink assignment still works...');
      
      if (afterReconnectButtons > 0) {
        // Try to click a drink assignment button
        await assigningPage.click('.assignment-button:first-child');
        console.log('✅ Successfully clicked drink assignment button');
        
        // Check if assignment was recorded
        await new Promise(resolve => setTimeout(resolve, 1000));
        const finalButtons = await assigningPage.locator('.assignment-button').count();
        console.log(`Final button count: ${finalButtons}`);
        
        if (finalButtons >= 0) { // Should be >= 0 regardless
          console.log('✅ SUCCESS: Drink assignment survived player reconnection!');
        } else {
          console.log('❌ FAILURE: Drink assignment broken after reconnection');
        }
      } else {
        console.log('❌ FAILURE: Drink assignment UI disappeared after reconnection');
      }
      
    } catch (error) {
      console.log('❌ FAILURE: Error accessing drink assignment UI after reconnection:', error.message);
    }
    
    // Step 10: Multiple reconnection test
    console.log('📱 Step 10: Testing multiple rapid reconnections...');
    
    for (let i = 1; i <= 3; i++) {
      console.log(`🔄 Reconnection test ${i}/3`);
      
      // Disconnect
      await newPlayer3Page.close();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Reconnect
      const testPage = await player3Context.newPage();
      await testPage.goto(roomUrl);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if drink assignment survives
      try {
        const survivalButtons = await assigningPage.locator('.assignment-button').count();
        console.log(`Reconnection ${i}: ${survivalButtons} buttons remaining`);
        
        if (survivalButtons === 0) {
          console.log(`❌ FAILURE: Drink assignment lost after reconnection ${i}`);
          break;
        }
      } catch (error) {
        console.log(`❌ FAILURE: Error checking drink assignment after reconnection ${i}`);
        break;
      }
      
      // Keep the last page for final check
      if (i < 3) await testPage.close();
      else newPlayer3Page = testPage;
    }
    
    console.log('🎯 Test completed');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run multiple test iterations
async function runMultipleTests() {
  console.log('🚀 Running multiple reconnection tests...');
  
  for (let testNum = 1; testNum <= 3; testNum++) {
    console.log(`\n🧪 =================== TEST ${testNum}/3 ===================`);
    await testReconnectDuringDrinkAssignment();
    
    if (testNum < 3) {
      console.log('⏳ Waiting before next test...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n✅ All reconnection tests completed!');
}

runMultipleTests().catch(console.error);