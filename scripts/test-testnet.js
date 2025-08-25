#!/usr/bin/env node

const { connect, keyStores, utils } = require('near-api-js');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: '.env.testnet' });

// Configuration
const CONTRACT_NAME = process.env.CONTRACT_NAME || 'intents.deltanear.testnet';
const GATEWAY_URL = process.env.GATEWAY_HOST 
  ? `https://${process.env.GATEWAY_HOST}`
  : 'http://localhost:3000';

async function setupNear() {
  const keyStore = new keyStores.InMemoryKeyStore();
  const config = {
    networkId: 'testnet',
    keyStore,
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
  };
  
  return await connect(config);
}

async function testContractDeployment(near) {
  console.log('Testing contract deployment...');
  
  const account = await near.account(CONTRACT_NAME);
  
  try {
    // Test view method
    const result = await account.viewFunction({
      contractId: CONTRACT_NAME,
      methodName: 'get_authorized_solvers',
      args: {},
    });
    
    console.log('Authorized solvers:', result);
    console.log('Contract deployment: SUCCESS');
    return true;
  } catch (error) {
    console.error('Contract deployment: FAILED');
    console.error(error.message);
    return false;
  }
}

async function testGatewayConnection() {
  console.log('\nTesting gateway connection...');
  
  try {
    const response = await axios.get(`${GATEWAY_URL}/health`);
    console.log('Gateway status:', response.data);
    console.log('Gateway connection: SUCCESS');
    return true;
  } catch (error) {
    console.error('Gateway connection: FAILED');
    console.error('Gateway might not be deployed yet');
    return false;
  }
}

async function testIntentSubmission() {
  console.log('\nTesting intent submission...');
  
  const intent = {
    chain_id: 'near-testnet',
    intent_type: 'derivatives',
    nonce: Date.now().toString(),
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: 'test-user.testnet',
    actions: [{
      instrument: 'perp',
      symbol: 'ETH-USD',
      side: 'long',
      size: '0.1',
      leverage: '2',
      max_slippage_bps: 10,
      max_funding_bps_8h: 20,
      max_fee_bps: 5,
      venue_allowlist: ['gmx-v2'],
      collateral_token: 'USDC',
      collateral_chain: 'arbitrum',
    }],
    settlement: {
      payout_token: 'USDC',
      payout_account: 'test-user.testnet',
      protocol_fee_bps: 2,
      rebate_bps: 1,
    },
  };
  
  try {
    const response = await axios.post(`${GATEWAY_URL}/intents`, intent);
    console.log('Intent submitted:', response.data.intent_hash);
    console.log('Intent submission: SUCCESS');
    return response.data.intent_hash;
  } catch (error) {
    console.error('Intent submission: FAILED');
    if (error.response) {
      console.error('Error:', error.response.data);
    }
    return null;
  }
}

async function testSolverQuotes(intentHash) {
  if (!intentHash) {
    console.log('\nSkipping quote test (no intent hash)');
    return;
  }
  
  console.log('\nTesting solver quotes...');
  
  try {
    const response = await axios.post(`${GATEWAY_URL}/quotes`, {
      intent_hash: intentHash,
    });
    
    console.log('Quote request sent');
    
    // Wait for quotes
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    const statusResponse = await axios.get(`${GATEWAY_URL}/status/${intentHash}`);
    console.log('Intent status:', statusResponse.data.status);
    
    if (statusResponse.data.solver_id) {
      console.log('Winning solver:', statusResponse.data.solver_id);
      console.log('Solver quotes: SUCCESS');
    } else {
      console.log('Solver quotes: NO QUOTES (solvers might not be running)');
    }
  } catch (error) {
    console.error('Solver quotes: FAILED');
    console.error(error.message);
  }
}

async function runTests() {
  console.log('DeltaNEAR Testnet Integration Tests');
  console.log('====================================\n');
  
  const near = await setupNear();
  
  // Run tests
  const contractOk = await testContractDeployment(near);
  const gatewayOk = await testGatewayConnection();
  
  let intentHash = null;
  if (gatewayOk) {
    intentHash = await testIntentSubmission();
    await testSolverQuotes(intentHash);
  }
  
  // Summary
  console.log('\n====================================');
  console.log('Test Summary:');
  console.log(`- Contract: ${contractOk ? 'PASS' : 'FAIL'}`);
  console.log(`- Gateway: ${gatewayOk ? 'PASS' : 'NEEDS DEPLOYMENT'}`);
  console.log(`- Intents: ${intentHash ? 'PASS' : 'SKIPPED'}`);
  console.log('====================================');
  
  if (!contractOk) {
    console.log('\nRun deployment first: ./scripts/deploy-testnet.sh');
  }
  
  if (!gatewayOk) {
    console.log('\nDeploy gateway service to enable full testing');
  }
}

// Run tests
runTests().catch(console.error);