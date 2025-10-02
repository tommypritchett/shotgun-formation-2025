const { chromium } = require('playwright');

async function debugURLClearing() {
  console.log('🧪 Debugging URL clearing execution...');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Enable comprehensive console logging
    page.on('console', msg => {
      if (msg.text().includes('clearURL') || msg.text().includes('Leave') || msg.text().includes('URL')) {
        console.log('🖥️ PAGE:', msg.text());
      }
    });
    
    // Inject debug code to monitor clearURL function calls
    await page.addInitScript(() => {
      window.originalHistoryReplaceState = window.history.replaceState;
      window.history.replaceState = function(...args) {
        console.log('🔧 history.replaceState called with:', args);
        return window.originalHistoryReplaceState.apply(window.history, args);
      };
    });
    
    // Step 1: Start a game
    console.log('📱 Starting game...');
    await page.goto('http://localhost:3001');
    await page.fill('input[placeholder="Enter your name"]', 'DebugPlayer');
    await page.click('button:has-text("Start a Lobby")');
    await page.waitForSelector('h1:has-text("Lobby")', { timeout: 10000 });
    
    const initialURL = page.url();
    console.log(`Initial URL: ${initialURL}`);
    
    // Step 2: Monitor URL before clicking
    console.log('📱 About to click Leave Lobby button...');
    
    // Add a debug function to the page to check clearURL
    await page.evaluate(() => {
      console.log('🔧 Adding URL monitoring...');
      window.originalClearURL = window.clearURL || (() => console.log('clearURL not found'));
      
      // Monitor URL changes
      const observer = new MutationObserver(() => {
        console.log('🔧 URL changed to:', window.location.href);
      });
      
      // Override clearURL to log when it's called
      if (typeof window.clearURL === 'function') {
        const originalClearURL = window.clearURL;
        window.clearURL = function() {
          console.log('🔧 clearURL function called!');
          console.log('🔧 URL before clearing:', window.location.href);
          const result = originalClearURL.apply(this, arguments);
          console.log('🔧 URL after clearing:', window.location.href);
          return result;
        };
      } else {
        console.log('🔧 clearURL function not found on window object');
      }
    });
    
    // Wait a moment for debugging setup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 3: Click Leave Lobby with monitoring
    console.log('📱 Clicking Leave Lobby...');
    await page.click('button:has-text("Leave Lobby")');
    
    // Wait for any async operations
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const finalURL = page.url();
    console.log(`Final URL: ${finalURL}`);
    
    // Check if URL changed
    if (initialURL === finalURL) {
      console.log('❌ URL did not change after Leave Lobby');
    } else {
      console.log('✅ URL changed after Leave Lobby');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await browser.close();
  }
}

debugURLClearing().catch(console.error);