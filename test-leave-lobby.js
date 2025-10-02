const { chromium } = require('playwright');

async function testLeaveLobbyButton() {
  console.log('🧪 Testing Leave Lobby button functionality...');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Enable console logging
    page.on('console', msg => console.log('🖥️ PAGE:', msg.text()));
    
    // Step 1: Start a game and enter lobby
    console.log('📱 Step 1: Starting a game and entering lobby...');
    await page.goto('http://localhost:3001');
    await page.fill('input[placeholder="Enter your name"]', 'TestPlayer');
    await page.click('button:has-text("Start a Lobby")');
    await page.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    
    const gameURL = page.url();
    console.log(`Game URL: ${gameURL}`);
    
    // Step 2: Check for Leave Lobby button
    console.log('📱 Step 2: Looking for Leave Lobby button...');
    const leaveLobbyButton = await page.locator('button:has-text("Leave Lobby")');
    const buttonExists = await leaveLobbyButton.count() > 0;
    console.log(`Leave Lobby button exists: ${buttonExists}`);
    
    if (buttonExists) {
      // Step 3: Click Leave Lobby and check URL
      console.log('📱 Step 3: Clicking Leave Lobby button...');
      await leaveLobbyButton.click();
      
      // Wait for page transition
      await page.waitForSelector('h1:has-text("Shotgun Formation")', { timeout: 5000 });
      
      const afterLeaveURL = page.url();
      console.log(`URL after clicking Leave Lobby: ${afterLeaveURL}`);
      
      const hasRoomParam = afterLeaveURL.includes('room=');
      const hasPlayerParam = afterLeaveURL.includes('player=');
      console.log(`- Has room parameter: ${hasRoomParam}`);
      console.log(`- Has player parameter: ${hasPlayerParam}`);
      
      if (!hasRoomParam && !hasPlayerParam) {
        console.log('✅ SUCCESS: URL cleared after leaving lobby');
      } else {
        console.log('❌ FAILURE: URL still contains parameters after leaving lobby');
      }
    } else {
      console.log('❌ FAILURE: Leave Lobby button not found');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

testLeaveLobbyButton().catch(console.error);