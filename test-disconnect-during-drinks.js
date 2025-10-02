// Test what happens to roundResults during active drink assignment
function testDisconnectDuringDrinks() {
  console.log('🧪 Testing disconnect impact on ongoing drink assignments...');
  
  // Simulate round state during active drink assignment
  let mockRoundResults = {
    // Player 1 has assigned some drinks but round isn't complete
    'player1': { drinks: 2, shotguns: 0 },
    // Player 2 hasn't assigned yet (this is the one assigning)
    // Player 3 will disconnect
  };
  
  console.log('📊 Current roundResults during active assignment:', mockRoundResults);
  
  // Test our logic
  const hasRoundResults = mockRoundResults && Object.keys(mockRoundResults).length > 0;
  const hasActualDrinks = hasRoundResults && Object.values(mockRoundResults).some(result => result.drinks > 0 || result.shotguns > 0);
  
  console.log(`- hasRoundResults: ${hasRoundResults}`);
  console.log(`- hasActualDrinks: ${hasActualDrinks}`);
  
  if (hasActualDrinks) {
    console.log('❌ PROBLEM: Would reset drink assignment during active round!');
    console.log('🔧 Need to improve the logic to distinguish active vs completed rounds');
  } else {
    console.log('✅ GOOD: Would preserve drink assignment state');
  }
  
  // Test with empty roundResults (more common case)
  console.log('\n📊 Testing with empty roundResults...');
  let emptyRoundResults = {};
  
  const hasRoundResults2 = emptyRoundResults && Object.keys(emptyRoundResults).length > 0;
  const hasActualDrinks2 = hasRoundResults2 && Object.values(emptyRoundResults).some(result => result.drinks > 0 || result.shotguns > 0);
  
  console.log(`- hasRoundResults: ${hasRoundResults2}`);
  console.log(`- hasActualDrinks: ${hasActualDrinks2}`);
  
  if (hasActualDrinks2) {
    console.log('❌ PROBLEM: Would reset drink assignment');
  } else {
    console.log('✅ GOOD: Would preserve drink assignment state');
  }
  
  // Test improved logic
  console.log('\n🔧 Testing improved logic...');
  console.log('Need to check if round is actually COMPLETE, not just has results');
  
  // A round is complete when all players have assigned their drinks
  // OR when the timer has expired and results are finalized
  // During active assignment, we should NOT reset
}

testDisconnectDuringDrinks();