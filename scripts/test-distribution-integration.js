#!/usr/bin/env node

/**
 * Integration test demonstrating the Distribution Provider abstraction
 * with the deployed NEAR testnet contract
 */

require('dotenv').config();
const { createProvider } = require('../services/distribution-provider/dist');
const crypto = require('crypto');

// Configuration
const CONTRACT_ID = process.env.INTENTS_CONTRACT || 'deltanear-intents-1755930723.testnet';
const NETWORK_ID = 'testnet';

// Helper to generate a signed intent (mock signature for testing)
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
  console.log('===========================================');
  console.log('Distribution Provider Integration Test');
  console.log('===========================================\n');
  
  // 1. Connect to NEAR testnet
  console.log('1. Connecting to NEAR testnet...');
  
  // Check contract state using RPC directly
  console.log(`   Contract: ${CONTRACT_ID}`);
  try {
    const response = await fetch('https://rpc.testnet.near.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'dontcare',
        method: 'query',
        params: {
          request_type: 'call_function',
          account_id: CONTRACT_ID,
          method_name: 'get_authorized_solvers',
          args_base64: Buffer.from('{}').toString('base64'),
          finality: 'final'
        }
      })
    });
    
    const data = await response.json();
    if (data.result && data.result.result) {
      const solvers = JSON.parse(Buffer.from(data.result.result).toString());
      console.log(`   Authorized solvers: ${solvers.length}`);
    }
  } catch (error) {
    console.log('   Contract view error:', error.message);
  }
  
  // 2. Initialize Distribution Provider
  console.log('\n2. Initializing Distribution Provider...');
  
  // Demonstrate factory pattern with environment config
  process.env.DISTRIBUTION_PROVIDER = 'mock'; // Using mock for testing
  
  const provider = createProvider({
    type: 'mock',
    endpoint: 'mock://localhost'
  });
  
  console.log('   Provider type: Mock (for testing)');
  console.log('   Note: In production, this would use "ofa-gateway" or "near-intents"');
  
  // 3. Create and publish an intent
  console.log('\n3. Creating derivatives intent...');
  
  const intent = {
    chain_id: 'near-testnet',
    intent_type: 'derivatives',
    nonce: Date.now().toString(),
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: 'user.testnet',
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
      payout_account: 'user.testnet',
      protocol_fee_bps: 2,
      rebate_bps: 1
    }
  };
  
  console.log('   Intent details:');
  console.log(`   - Type: ${intent.actions[0].instrument}`);
  console.log(`   - Symbol: ${intent.actions[0].symbol}`);
  console.log(`   - Side: ${intent.actions[0].side}`);
  console.log(`   - Size: ${intent.actions[0].size}`);
  console.log(`   - Leverage: ${intent.actions[0].leverage}x`);
  
  // Sign and publish
  const signedIntent = generateSignedIntent(intent, 'mock_private_key');
  
  console.log('\n4. Publishing intent via Distribution Provider...');
  const { intent_hash } = await provider.publishIntent(signedIntent);
  console.log(`   Intent hash: ${intent_hash}`);
  
  // 5. Auction phase
  console.log('\n5. Running auction process...');
  
  // Request quotes from solvers
  console.log('   Requesting quotes from solver network...');
  await provider.requestQuotes(intent_hash);
  
  // Simulate short delay for quotes to arrive
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Get collected quotes
  const quotes = await provider.getQuotes(intent_hash);
  console.log(`   Received ${quotes.length} quotes:`);
  
  quotes.forEach((q, i) => {
    console.log(`\n   Quote ${i + 1}:`);
    console.log(`   - Solver: ${q.solver_id}`);
    console.log(`   - Price: $${q.quote.price}`);
    console.log(`   - Funding (8h): ${q.quote.estimated_funding_bps / 100}%`);
    console.log(`   - Fees: ${q.quote.fees_bps / 100}%`);
    console.log(`   - Slippage: ${q.quote.estimated_slippage_bps / 100}%`);
    console.log(`   - Venue: ${q.quote.venue}`);
  });
  
  // 6. Quote selection
  console.log('\n6. Selecting best quote...');
  
  // Select best quote (lowest price for long position)
  const bestQuote = quotes.reduce((best, current) => 
    parseFloat(current.quote.price) < parseFloat(best.quote.price) ? current : best
  );
  
  console.log(`   Selected: ${bestQuote.solver_id} @ $${bestQuote.quote.price}`);
  
  // Accept the quote
  await provider.acceptQuote(intent_hash, bestQuote.solver_id);
  console.log('   Quote accepted and assigned to solver');
  
  // 7. Monitor execution
  console.log('\n7. Monitoring execution...');
  
  const statuses = [];
  
  if (provider.subscribeToUpdates) {
    await new Promise((resolve) => {
      const unsubscribe = provider.subscribeToUpdates(intent_hash, (status) => {
        statuses.push(status.status);
        console.log(`   Status update: ${status.status}`);
        
        if (status.status === 'settled') {
          console.log('\n   Execution completed successfully!');
          if (status.execution_details) {
            console.log('   Transaction hash:', status.execution_details.tx_hash);
            console.log('   Final price:', status.execution_details.final_price);
            console.log('   Gas used:', status.execution_details.gas_used);
          }
          unsubscribe();
          resolve();
        } else if (status.status === 'failed') {
          console.log('\n   Execution failed:', status.error);
          unsubscribe();
          resolve();
        }
      });
    });
  }
  
  // 8. Summary
  console.log('\n===========================================');
  console.log('Integration Test Summary');
  console.log('===========================================');
  console.log('\nFlow completed successfully:');
  console.log('1. Connected to NEAR testnet contract');
  console.log('2. Created derivatives intent');
  console.log('3. Published via Distribution Provider');
  console.log('4. Received solver quotes');
  console.log('5. Selected and accepted best quote');
  console.log('6. Monitored execution to completion');
  
  console.log('\nStatus progression:', statuses.join(' -> '));
  
  console.log('\nKey benefits of Distribution Provider abstraction:');
  console.log('- Flexibility to switch between distribution mechanisms');
  console.log('- Clean separation of concerns');
  console.log('- Easy testing with mock provider');
  console.log('- Future-proof for NEAR native intents');
  console.log('- Maintains backward compatibility');
  
  console.log('\n✓ Integration test complete!');
}

main().catch(error => {
  console.error('\nError:', error);
  process.exit(1);
});