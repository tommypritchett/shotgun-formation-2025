// Simple test to verify reconnection doesn't break drink assignments
// This will manually create the scenario we want to test

async function testReconnectionImpact() {
  console.log('🧪 Simple test: Does reconnection preserve drink assignment state?');
  
  // Simulate the client-side state during drink assignment
  let mockState = {
    isDistributing: true,
    drinksToGive: 4,
    shotgunsToGive: 0,
    drinkMessage: 'You need to assign 4 drinks for the Field Goal!',
    assignedDrinks: { drinks: {}, shotguns: {} },
    roundDrinkResults: {}
  };
  
  console.log('📊 Initial state during drink assignment:');
  console.log(`- isDistributing: ${mockState.isDistributing}`);
  console.log(`- drinksToGive: ${mockState.drinksToGive}`);
  console.log(`- drinkMessage: "${mockState.drinkMessage}"`);
  
  // Simulate receiving updatePlayerStats event when player reconnects
  // This is what happens when an existing player disconnects/reconnects
  
  console.log('\n📡 Simulating updatePlayerStats event from player reconnection...');
  
  // Case 1: Empty round results (typical for reconnection)
  const reconnectionEvent = {
    players: { /* updated player stats */ },
    roundResults: {} // Empty - no actual round ending
  };
  
  console.log('📊 Received roundResults:', reconnectionEvent.roundResults);
  
  // Apply the logic from our fix
  const hasRoundResults = reconnectionEvent.roundResults && Object.keys(reconnectionEvent.roundResults).length > 0;
  const hasActualDrinks = hasRoundResults && Object.values(reconnectionEvent.roundResults).some(result => result.drinks > 0 || result.shotguns > 0);
  
  console.log(`- hasRoundResults: ${hasRoundResults}`);
  console.log(`- hasActualDrinks: ${hasActualDrinks}`);
  
  if (hasActualDrinks) {
    console.log('🔄 Round ended with results - would reset drink assignment state');
    mockState.isDistributing = false;
    mockState.drinksToGive = 0;
    mockState.drinkMessage = '';
  } else {
    console.log('📊 Player stats updated (reconnection) - preserving drink assignment state');
  }
  
  console.log('\n📊 Final state after updatePlayerStats:');
  console.log(`- isDistributing: ${mockState.isDistributing}`);
  console.log(`- drinksToGive: ${mockState.drinksToGive}`);
  console.log(`- drinkMessage: "${mockState.drinkMessage}"`);
  
  if (mockState.isDistributing && mockState.drinksToGive > 0) {
    console.log('✅ SUCCESS: Drink assignment state preserved during reconnection!');
  } else {
    console.log('❌ FAILURE: Drink assignment state was reset during reconnection!');
  }
  
  // Case 2: Test with actual round results (should reset)
  console.log('\n🧪 Testing with actual round ending...');
  
  const roundEndEvent = {
    players: { /* updated player stats */ },
    roundResults: {
      'player1': { drinks: 2, shotguns: 0 },
      'player2': { drinks: 1, shotguns: 1 }
    }
  };
  
  const hasRoundResults2 = roundEndEvent.roundResults && Object.keys(roundEndEvent.roundResults).length > 0;
  const hasActualDrinks2 = hasRoundResults2 && Object.values(roundEndEvent.roundResults).some(result => result.drinks > 0 || result.shotguns > 0);
  
  console.log(`- hasRoundResults: ${hasRoundResults2}`);
  console.log(`- hasActualDrinks: ${hasActualDrinks2}`);
  
  if (hasActualDrinks2) {
    console.log('🔄 Round ended with results - would reset drink assignment state');
    console.log('✅ CORRECT: Should reset when round actually ends');
  } else {
    console.log('❌ INCORRECT: Should reset when round has actual results');
  }
}

testReconnectionImpact();