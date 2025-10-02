const { chromium } = require('playwright');

async function testURLClearingFunctionality() {
  console.log('🧪 Testing URL clearing functionality...');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Step 1: Start a game and check URL contains room parameters
    console.log('📱 Step 1: Starting a game and checking URL...');
    await page.goto('http://localhost:3001');
    await page.fill('input[placeholder="Enter your name"]', 'TestPlayer');
    await page.click('button:has-text("Start a Lobby")');
    await page.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    
    const gameURL = page.url();
    console.log(`Game URL: ${gameURL}`);
    
    const hasRoomParam = gameURL.includes('room=');
    const hasPlayerParam = gameURL.includes('player=');
    console.log(`- Has room parameter: ${hasRoomParam}`);
    console.log(`- Has player parameter: ${hasPlayerParam}`);
    
    if (hasRoomParam && hasPlayerParam) {
      console.log('✅ URL contains game parameters as expected');
    } else {
      console.log('❌ URL missing expected game parameters');
      return;
    }
    
    // Step 2: Leave lobby and check URL is cleared
    console.log('\n📱 Step 2: Leaving lobby and checking URL clearing...');
    await page.click('button:has-text("Leave Lobby")');
    await page.waitForSelector('h1:has-text("Shotgun Formation")', { timeout: 5000 });
    
    const afterLeaveURL = page.url();
    console.log(`URL after leaving: ${afterLeaveURL}`);
    
    const hasRoomParamAfter = afterLeaveURL.includes('room=');
    const hasPlayerParamAfter = afterLeaveURL.includes('player=');
    console.log(`- Has room parameter: ${hasRoomParamAfter}`);
    console.log(`- Has player parameter: ${hasPlayerParamAfter}`);
    
    if (!hasRoomParamAfter && !hasPlayerParamAfter) {
      console.log('✅ SUCCESS: URL cleared after leaving lobby');
    } else {
      console.log('❌ FAILURE: URL still contains game parameters after leaving');
    }
    
    // Step 3: Test joining a new game after URL clearing
    console.log('\n📱 Step 3: Testing new game join after URL clearing...');
    await page.fill('input[placeholder="Enter your name"]', 'TestPlayer2');
    await page.click('button:has-text("Start a Lobby")');
    await page.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    
    const newGameURL = page.url();
    console.log(`New game URL: ${newGameURL}`);
    
    if (newGameURL !== gameURL) {
      console.log('✅ SUCCESS: New game has different URL (no interference from old URL)');
    } else {
      console.log('❌ FAILURE: New game trying to use old URL');
    }
    
    // Step 4: Test reconnection scenario (URL should be preserved)
    console.log('\n📱 Step 4: Testing reconnection scenario...');
    
    // Refresh the page to simulate disconnect/reconnect
    await page.reload();
    
    // Should automatically reconnect and preserve URL
    try {
      await page.waitForSelector('.lobby-container, .game-header', { timeout: 10000 });
      const reconnectURL = page.url();
      console.log(`URL after reconnection: ${reconnectURL}`);
      
      if (reconnectURL === newGameURL) {
        console.log('✅ SUCCESS: URL preserved during reconnection');
      } else {
        console.log('❌ FAILURE: URL changed during reconnection');
      }
    } catch (error) {
      console.log('❌ FAILURE: Reconnection failed or took too long');
    }
    
    console.log('\n🎯 URL Clearing Test Summary:');
    console.log('- URL should contain parameters during active game/lobby ✓');
    console.log('- URL should be cleared when leaving lobby ✓'); 
    console.log('- New games should not be affected by old URLs ✓');
    console.log('- Reconnection should preserve URL for same game ✓');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

testURLClearingFunctionality().catch(console.error);