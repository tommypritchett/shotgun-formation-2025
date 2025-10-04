const { chromium } = require('playwright');

async function testRoundResultsUI() {
  console.log('🧪 COMPREHENSIVE TEST: Run action → Check round results popup → Check totals update');
  console.log('================================================================================');
  
  const browser = await chromium.launch({ headless: false });
  
  try {
    // Create browser contexts for 3 players
    const hostContext = await browser.newContext();
    const player2Context = await browser.newContext();
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
    
    // Step 3: Check initial player stats display
    console.log('📱 Step 3: Checking initial player stats...');
    
    const checkPlayerStats = async (page, playerName) => {
      try {
        // Look for player stats display
        const statsElements = await page.locator('.player-stats, .total-drinks, .total-shotguns, [class*="drink"], [class*="stats"]').count();
        const hasScoreboard = await page.locator('.scoreboard, .player-scoreboard, [class*="scoreboard"]').count() > 0;
        
        console.log(`  ${playerName}: Found ${statsElements} stat elements, scoreboard: ${hasScoreboard}`);
        return { statsElements, hasScoreboard };
      } catch (error) {
        console.log(`  ${playerName}: Error checking stats - ${error.message}`);
        return { statsElements: 0, hasScoreboard: false };
      }
    };
    
    const hostInitialStats = await checkPlayerStats(hostPage, 'Host');
    const p2InitialStats = await checkPlayerStats(player2Page, 'Player2');
    const p3InitialStats = await checkPlayerStats(player3Page, 'Player3');
    
    // Step 4: Host declares an action
    console.log('📱 Step 4: Host declaring Penalty action...');
    await hostPage.click('.declare-action-button');
    await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
    await hostPage.click('button:has-text("Penalty")');
    console.log('✅ Host declared Penalty action');
    
    // Step 5: Wait for drink assignment and let someone assign
    console.log('📱 Step 5: Waiting for drink assignment...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check who has assignment UI
    const checkAssignmentUI = async (page, playerName) => {
      try {
        const hasButtons = await page.locator('.assignment-button').count() > 0;
        const buttonCount = await page.locator('.assignment-button').count();
        const message = hasButtons ? await page.locator('.drink-message').textContent() : '';
        
        console.log(`  ${playerName}: ${hasButtons ? 'HAS' : 'NO'} assignment (${buttonCount} buttons) - "${message}"`);
        return { hasButtons, buttonCount, message };
      } catch (error) {
        console.log(`  ${playerName}: Error checking assignment`);
        return { hasButtons: false, buttonCount: 0, message: '' };
      }
    };
    
    const hostAssignment = await checkAssignmentUI(hostPage, 'Host');
    const p2Assignment = await checkAssignmentUI(player2Page, 'Player2');
    const p3Assignment = await checkAssignmentUI(player3Page, 'Player3');
    
    // Find someone with assignment and make them assign drinks
    let assigningPage = null;
    let assigningPlayer = '';
    
    if (hostAssignment.hasButtons) {
      assigningPage = hostPage;
      assigningPlayer = 'Host';
    } else if (p2Assignment.hasButtons) {
      assigningPage = player2Page;
      assigningPlayer = 'Player2';
    } else if (p3Assignment.hasButtons) {
      assigningPage = player3Page;
      assigningPlayer = 'Player3';
    }
    
    if (!assigningPage) {
      console.log('❌ No player got assignment - trying Touchdown instead...');
      
      // Try Touchdown
      await hostPage.click('.declare-action-button');
      await hostPage.waitForSelector('.modal-content', { timeout: 5000 });
      await hostPage.click('button:has-text("Touchdown")');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const hostAssignment2 = await checkAssignmentUI(hostPage, 'Host');
      const p2Assignment2 = await checkAssignmentUI(player2Page, 'Player2');
      const p3Assignment2 = await checkAssignmentUI(player3Page, 'Player3');
      
      if (hostAssignment2.hasButtons) {
        assigningPage = hostPage;
        assigningPlayer = 'Host';
      } else if (p2Assignment2.hasButtons) {
        assigningPage = player2Page;
        assigningPlayer = 'Player2';
      } else if (p3Assignment2.hasButtons) {
        assigningPage = player3Page;
        assigningPlayer = 'Player3';
      }
    }
    
    if (!assigningPage) {
      console.log('❌ Still no assignments - ending test');
      return;
    }
    
    console.log(`✅ ${assigningPlayer} will assign drinks`);
    
    // Step 6: Make assignment
    console.log('📱 Step 6: Making drink assignment...');
    await assigningPage.click('.assignment-button:first-child');
    console.log(`✅ ${assigningPlayer} clicked first assignment button`);
    
    // Step 7: Wait for round to complete (timer runs out)
    console.log('📱 Step 7: Waiting for round to complete (timer expiration)...');
    
    // Monitor for round results
    let roundResultsAppeared = false;
    let timerExpired = false;
    
    // Set up listeners for round results popup
    hostPage.on('console', msg => {
      if (msg.text().includes('Round drink results') || msg.text().includes('roundFinalized')) {
        console.log('🔥 HOST LOG:', msg.text());
        if (msg.text().includes('roundFinalized')) roundResultsAppeared = true;
      }
    });
    
    // Wait for timer to expire (max 25 seconds)
    for (let i = 0; i < 25; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if timer is still running
      const timerVisible = await hostPage.locator('.timer-display, [class*="timer"]').count() > 0;
      if (!timerVisible && i > 5) {
        timerExpired = true;
        break;
      }
      
      console.log(`  Waiting for timer... ${i + 1}/25 seconds`);
    }
    
    console.log(`Timer expired: ${timerExpired}, Round results detected: ${roundResultsAppeared}`);
    
    // Step 8: Check for round results popup
    console.log('📱 Step 8: Checking for round results popup...');
    
    const checkRoundResults = async (page, playerName) => {
      try {
        const roundResultsVisible = await page.locator('.round-results, .results-modal, [class*="results"]').count() > 0;
        const modalVisible = await page.locator('.modal-content').count() > 0;
        const resultsText = roundResultsVisible ? await page.locator('.round-results, .results-modal, [class*="results"]').first().textContent() : '';
        
        console.log(`  ${playerName}: Round results visible: ${roundResultsVisible}, Modal: ${modalVisible}`);
        if (resultsText) console.log(`    Results text: "${resultsText}"`);
        
        return { roundResultsVisible, modalVisible, resultsText };
      } catch (error) {
        console.log(`  ${playerName}: Error checking round results`);
        return { roundResultsVisible: false, modalVisible: false, resultsText: '' };
      }
    };
    
    const hostResults = await checkRoundResults(hostPage, 'Host');
    const p2Results = await checkRoundResults(player2Page, 'Player2');
    const p3Results = await checkRoundResults(player3Page, 'Player3');
    
    // Step 9: Check if player stats updated
    console.log('📱 Step 9: Checking if player stats updated...');
    
    const hostFinalStats = await checkPlayerStats(hostPage, 'Host');
    const p2FinalStats = await checkPlayerStats(player2Page, 'Player2');
    const p3FinalStats = await checkPlayerStats(player3Page, 'Player3');
    
    // Step 10: Compare before and after
    console.log('📱 Step 10: Analyzing results...');
    
    const anyRoundResultsShown = hostResults.roundResultsVisible || p2Results.roundResultsVisible || p3Results.roundResultsVisible;
    const anyModalShown = hostResults.modalVisible || p2Results.modalVisible || p3Results.modalVisible;
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 FINAL ANALYSIS:');
    console.log('================================================================================');
    
    console.log('\n📊 ROUND RESULTS POPUP:');
    if (anyRoundResultsShown) {
      console.log('✅ SUCCESS: Round results popup appeared!');
    } else if (anyModalShown) {
      console.log('⚠️ PARTIAL: Modal appeared but might not be round results');
    } else {
      console.log('❌ FAILURE: No round results popup detected');
    }
    
    console.log('\n📈 PLAYER STATS UPDATES:');
    console.log(`Host stats elements: ${hostInitialStats.statsElements} → ${hostFinalStats.statsElements}`);
    console.log(`Player2 stats elements: ${p2InitialStats.statsElements} → ${p2FinalStats.statsElements}`);
    console.log(`Player3 stats elements: ${p3InitialStats.statsElements} → ${p3FinalStats.statsElements}`);
    
    console.log('\n🔍 ROOT CAUSE INVESTIGATION:');
    if (!anyRoundResultsShown) {
      console.log('❌ ISSUE CONFIRMED: Round results are not displaying in UI');
      console.log('   Likely causes:');
      console.log('   1. updatePlayerStats event not reaching client');
      console.log('   2. roundResults data empty or malformed');
      console.log('   3. UI component not rendering round results');
      console.log('   4. Modal/popup component not triggering');
    }
    
    if (hostFinalStats.statsElements === hostInitialStats.statsElements) {
      console.log('❌ ISSUE CONFIRMED: Player stats not updating in UI');
      console.log('   Likely causes:');
      console.log('   1. playerStats not being updated on client');
      console.log('   2. UI not re-rendering with new stats');
      console.log('   3. Stats display components not connected to state');
    }
    
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testRoundResultsUI().catch(console.error);