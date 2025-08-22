const { chromium } = require('playwright');

async function simpleTest() {
  console.log('🔍 Simple reconnection test...');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    // Listen to console logs
    page.on('console', msg => console.log('🖥️ BROWSER:', msg.text()));
    
    // Go to the game
    await page.goto('http://localhost:3001');
    
    // Create a room
    await page.fill('input[placeholder="Enter your name"]', 'TestUser');
    await page.click('button:has-text("Start a Lobby")');
    await page.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    
    console.log('✅ Room created');
    console.log('URL:', page.url());
    
    // Add players to start game
    const page2 = await browser.newPage();
    await page2.goto(page.url());
    await page2.fill('input[placeholder="Enter your name"]', 'Player2');
    await page2.click('button:has-text("Join Game")');
    await page2.waitForSelector('.lobby-container', { timeout: 5000 });
    
    const page3 = await browser.newPage();
    await page3.goto(page.url());
    await page3.fill('input[placeholder="Enter your name"]', 'Player3');
    await page3.click('button:has-text("Join Game")');
    await page3.waitForSelector('.lobby-container', { timeout: 5000 });
    
    // Start the game
    await page.click('button:has-text("Start Game")');
    await page.waitForSelector('.game-header', { timeout: 10000 });
    console.log('✅ Game started');
    
    // Check cards before refresh
    const cardsBefore = await page.locator('.card').count();
    console.log('Cards before refresh:', cardsBefore);
    
    // Refresh and see what happens
    console.log('🔄 Refreshing...');
    await page.reload();
    
    // Wait longer for reconnection to complete
    await page.waitForTimeout(5000);
    
    // Check console logs
    const logs = await page.evaluate(() => {
      return window.console.logs || [];
    });
    console.log('Browser console logs:', logs);
    
    // Check the state
    const bodyText = await page.textContent('body');
    console.log('Content after refresh:', bodyText.substring(0, 200));
    
    // Check cards after refresh
    const cardsAfter = await page.locator('.card').count();
    console.log('Cards after refresh:', cardsAfter);
    
    // Check if we can see lobby or game elements
    const lobbyExists = await page.locator('h1:has-text("Lobby")').count();
    const gameExists = await page.locator('.game-header').count();
    const initialExists = await page.locator('h1:has-text("ShotGun Formation")').count();
    
    console.log('Elements found:');
    console.log('- Lobby:', lobbyExists);
    console.log('- Game:', gameExists);
    console.log('- Initial:', initialExists);
    
    // Check if reconnection was successful
    if (gameExists > 0 && cardsAfter > 0) {
      console.log('✅ SUCCESS: Game reconnection with cards working!');
    } else if (gameExists > 0 && cardsAfter === 0) {
      console.log('⚠️ PARTIAL: Game reconnected but no cards restored');
    } else {
      console.log('❌ FAILURE: Game reconnection failed');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

simpleTest().catch(console.error);