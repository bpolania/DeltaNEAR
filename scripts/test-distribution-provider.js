#!/usr/bin/env node

/**
 * Test the Distribution Provider abstraction with the deployed testnet contract
 */

require('dotenv').config();
const { createProvider } = require('../services/distribution-provider/dist');
const crypto = require('crypto');

// Helper to generate a signed intent (mock signature)
function generateSignedIntent(intent, privateKey) {
  const signature = crypto.createHash('sha256')
    .update(JSON.stringify(intent))
    .update(privateKey)
    .digest('hex');
  
  return {
    intent,
    signature,
    public_key: 'ed25519:' + crypto.randomBytes(32).toString('hex')
  };
}

async function main() {
  console.log('Testing Distribution Provider abstraction...\n');
  
  // Create mock provider for testing
  const provider = createProvider({
    type: 'mock',
    endpoint: 'mock://localhost'
  });
  
  // Check health
  const isHealthy = await provider.isHealthy();
  console.log(`Provider health check: ${isHealthy ? 'OK' : 'Failed'}`);
  
  // Create a test intent
  const intent = {
    chain_id: 'near-testnet',
    intent_type: 'derivatives',
    nonce: Date.now().toString(),
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: 'test.testnet',
    actions: [{
      instrument: 'perp',
      symbol: 'ETH-USD',
      side: 'long',
      size: '1.0',
      leverage: '5',
      max_slippage_bps: 10,
      max_funding_bps_8h: 20,
      max_fee_bps: 5,
      venue_allowlist: ['gmx-v2'],
      collateral_token: 'USDC',
      collateral_chain: 'arbitrum'
    }],
    settlement: {
      payout_token: 'USDC',
      payout_account: 'test.testnet',
      protocol_fee_bps: 2,
      rebate_bps: 1
    }
  };
  
  // Generate signed intent
  const signedIntent = generateSignedIntent(intent, 'mock_private_key');
  
  // Publish intent
  console.log('\n1. Publishing intent...');
  const { intent_hash } = await provider.publishIntent(signedIntent);
  console.log(`   Intent hash: ${intent_hash}`);
  
  // Request quotes
  console.log('\n2. Requesting quotes...');
  await provider.requestQuotes(intent_hash);
  
  // Get quotes
  console.log('\n3. Retrieving quotes...');
  const quotes = await provider.getQuotes(intent_hash);
  console.log(`   Received ${quotes.length} quotes:`);
  quotes.forEach((q, i) => {
    console.log(`   - Quote ${i + 1}: ${q.solver_id} @ $${q.quote.price}`);
  });
  
  if (quotes.length === 0) {
    console.log('\nNo quotes received');
    return;
  }
  
  // Accept best quote
  console.log('\n4. Accepting best quote...');
  const bestQuote = quotes[0];
  await provider.acceptQuote(intent_hash, bestQuote.solver_id);
  console.log(`   Accepted quote from ${bestQuote.solver_id}`);
  
  // Get status
  console.log('\n5. Checking status...');
  const status = await provider.getStatus(intent_hash);
  console.log(`   Status: ${status.status}`);
  if (status.winning_solver) {
    console.log(`   Winning solver: ${status.winning_solver}`);
  }
  
  // Subscribe to updates (if supported)
  if (provider.subscribeToUpdates) {
    console.log('\n6. Subscribing to updates...');
    let updateCount = 0;
    const unsubscribe = provider.subscribeToUpdates(intent_hash, (update) => {
      updateCount++;
      console.log(`   Update ${updateCount}: ${update.status}`);
      
      if (update.status === 'settled' || update.status === 'failed') {
        console.log('\n   Final status reached');
        if (update.execution_details) {
          console.log('   Execution details:', update.execution_details);
        }
        unsubscribe();
      }
    });
    
    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log('\nDistribution Provider test complete!');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});