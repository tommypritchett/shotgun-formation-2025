const { chromium } = require('playwright');

async function testReconnection() {
  console.log('🧪 Starting reconnection test...');
  
  const browser = await chromium.launch({ headless: false }); // Set to true for headless
  const context = await browser.newContext();
  
  try {
    // Step 1: Create a game and get the URL
    console.log('📱 Step 1: Creating initial game...');
    const page1 = await context.newPage();
    await page1.goto('http://localhost:3000');
    
    // Enter name and create room
    await page1.fill('input[placeholder="Enter your name"]', 'TestPlayer');
    await page1.click('button:has-text("Start a Lobby")');
    
    // Wait for room creation and get the URL
    await page1.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    const roomUrl = page1.url();
    console.log(`✅ Room created: ${roomUrl}`);
    
    // Step 2: Refresh the page (simulate disconnection)
    console.log('🔄 Step 2: Refreshing page to test reconnection...');
    await page1.reload();
    
    // Step 3: Check if reconnection works
    console.log('⏳ Step 3: Waiting for reconnection...');
    
    // Look for either lobby or game state (depending on what should happen)
    try {
      await page1.waitForSelector('h1:has-text("Lobby"), h1:has-text("ShotGun Formation")', { timeout: 15000 });
      console.log('✅ SUCCESS: Page rendered after refresh - no white screen!');
      
      // Check current state
      const lobbyExists = await page1.locator('h1:has-text("Lobby")').count();
      const gameExists = await page1.locator('.game-header').count();
      
      if (lobbyExists > 0) {
        console.log('✅ Successfully reconnected to lobby');
      } else if (gameExists > 0) {
        console.log('✅ Successfully reconnected to game');
      } else {
        console.log('✅ Page rendered but in initial state (may need manual rejoin)');
      }
      
    } catch (error) {
      // Check if page is white/blank
      const bodyText = await page1.textContent('body');
      if (!bodyText || bodyText.trim() === '') {
        console.log('❌ FAILURE: White screen detected!');
      } else {
        console.log('⚠️ PARTIAL: Page has content but not expected state');
        console.log('Page content:', bodyText.substring(0, 200));
      }
    }
    
    // Step 4: Test with debug mode
    console.log('🔍 Step 4: Testing debug render mode...');
    await page1.goto(roomUrl + '?debugrender=true');
    
    const debugContent = await page1.textContent('body');
    if (debugContent.includes('DEBUG TEST MODE')) {
      console.log('✅ Debug render mode working - React is functional');
    } else {
      console.log('❌ Debug render mode failed - React may not be loading');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testReconnection().catch(console.error);