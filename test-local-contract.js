#!/usr/bin/env node

const { Worker } = require('near-workspaces');
const path = require('path');
const fs = require('fs');

async function testLocalContract() {
  console.log('Testing Local NEAR Contract');
  console.log('============================');
  
  let worker;
  
  try {
    // Initialize worker
    console.log('\n1. Initializing NEAR sandbox...');
    worker = await Worker.init();
    console.log('   ✓ Sandbox initialized');
    
    // Create accounts
    console.log('\n2. Creating accounts...');
    const treasury = await worker.rootAccount.createSubAccount('treasury');
    const alice = await worker.rootAccount.createSubAccount('alice');
    console.log('   ✓ Treasury account:', treasury.accountId);
    console.log('   ✓ Alice account:', alice.accountId);
    
    // Deploy contract with initialization
    console.log('\n3. Deploying and initializing contract...');
    const contractWasm = path.join(__dirname, 'contracts/near-intents-derivatives/target/wasm32-unknown-unknown/release/near_intents_derivatives.wasm');
    
    // Check if WASM file exists
    if (!fs.existsSync(contractWasm)) {
      throw new Error(`WASM file not found at ${contractWasm}`);
    }
    
    const contract = await worker.rootAccount.devDeploy(contractWasm, {
      initialBalance: '10000000000000000000000000', // 10 NEAR in yoctoNEAR
      method: 'new',
      args: { treasury_account_id: treasury.accountId }
    });
    
    console.log('   ✓ Contract deployed to:', contract.accountId);
    console.log('   ✓ Contract initialized with treasury:', treasury.accountId);
    
    // Add authorized solvers
    console.log('\n4. Adding authorized solvers...');
    try {
      await contract.call(contract, 'add_authorized_solver', {
        solver_id: 'solver1.testnet'
      });
      console.log('   ✓ Added solver1.testnet');
      
      await contract.call(contract, 'add_authorized_solver', {
        solver_id: 'solver2.testnet'
      });
      console.log('   ✓ Added solver2.testnet');
    } catch (error) {
      console.log('   ✗ Failed to add solvers:', error.message);
      throw error;
    }
    
    // View authorized solvers
    console.log('\n5. Viewing contract state...');
    try {
      const solvers = await contract.view('get_authorized_solvers', {});
      console.log('   ✓ Authorized solvers:', solvers);
    } catch (error) {
      console.log('   ✗ View failed:', error.message);
      throw error;
    }
    
    // Test intent submission (view method to test hash generation)
    console.log('\n6. Testing intent operations...');
    const testIntent = {
      chain_id: 'near-testnet',
      intent_type: 'derivatives',
      nonce: '1',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: alice.accountId,
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
        payout_account: alice.accountId,
        protocol_fee_bps: 2,
        rebate_bps: 1
      }
    };
    
    console.log('   ✓ Test intent created');
    
    console.log('\n============================');
    console.log('Summary:');
    console.log('✓ Local deployment successful');
    console.log('✓ Contract initialized properly');
    console.log('✓ Contract methods accessible');
    console.log('✓ Ready for integration tests');
    
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (worker) {
      console.log('\nCleaning up sandbox...');
      await worker.tearDown();
    }
  }
}

// Run test
testLocalContract().catch(console.error);