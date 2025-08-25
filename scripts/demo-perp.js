#!/usr/bin/env node

const axios = require('axios');
const crypto = require('crypto');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runPerpDemo() {
  console.log('🚀 DeltaNEAR Perpetual Demo');
  console.log('============================\n');

  const intent = {
    chain_id: 'near-testnet',
    intent_type: 'derivatives',
    nonce: Date.now().toString(),
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: 'demo-user.testnet',
    actions: [{
      instrument: 'perp',
      symbol: 'ETH-USD',
      side: 'long',
      size: '2.5',
      leverage: '5',
      max_slippage_bps: 10,
      max_funding_bps_8h: 20,
      max_fee_bps: 5,
      venue_allowlist: ['gmx-v2', 'lyra-v2'],
      collateral_token: 'USDC',
      collateral_chain: 'arbitrum',
    }],
    settlement: {
      payout_token: 'USDC',
      payout_account: 'demo-user.testnet',
      protocol_fee_bps: 2,
      rebate_bps: 1,
    },
  };

  console.log('📝 Intent Details:');
  console.log(`  Symbol: ${intent.actions[0].symbol}`);
  console.log(`  Side: ${intent.actions[0].side}`);
  console.log(`  Size: ${intent.actions[0].size} ETH`);
  console.log(`  Leverage: ${intent.actions[0].leverage}x`);
  console.log(`  Venues: ${intent.actions[0].venue_allowlist.join(', ')}\n`);

  console.log('1️⃣ Submitting intent to OFA Gateway...');
  const submitResponse = await axios.post(`${GATEWAY_URL}/intents`, intent);
  const { intent_hash } = submitResponse.data;
  console.log(`✅ Intent submitted: ${intent_hash}\n`);

  console.log('2️⃣ Requesting quotes from solvers...');
  await axios.post(`${GATEWAY_URL}/quotes`, { intent_hash });
  console.log('⏳ Waiting for solver quotes (5 seconds)...');
  
  await sleep(6000);

  console.log('3️⃣ Checking auction results...');
  const statusResponse = await axios.get(`${GATEWAY_URL}/status/${intent_hash}`);
  console.log(`📊 Auction Status: ${statusResponse.data.status}`);
  
  if (statusResponse.data.solver_id) {
    console.log(`🏆 Winning Solver: ${statusResponse.data.solver_id}`);
    console.log(`📍 Selected Venue: ${statusResponse.data.venue || 'Pending'}\n`);
  }

  console.log('4️⃣ Signing and accepting quote...');
  const privateKey = crypto.randomBytes(32).toString('hex');
  const publicKey = crypto.randomBytes(32).toString('hex');
  const signature = crypto.randomBytes(64).toString('hex');

  const signedIntent = {
    intent,
    signature,
    public_key: publicKey,
  };

  try {
    const acceptResponse = await axios.post(`${GATEWAY_URL}/accept`, signedIntent);
    console.log(`✅ Quote accepted!`);
    console.log(`⚡ Execution Status: ${acceptResponse.data.status}`);
    console.log(`🔒 Exclusive Until: ${new Date(acceptResponse.data.exclusive_until).toLocaleTimeString()}\n`);

    console.log('5️⃣ Monitoring execution...');
    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      const execStatus = await axios.get(`${GATEWAY_URL}/status/${intent_hash}`);
      console.log(`  [${i+1}/5] Status: ${execStatus.data.status}`);
      
      if (execStatus.data.status === 'completed' || execStatus.data.status === 'failed') {
        console.log('\n📈 Final Execution Details:');
        console.log(`  Fill Price: $${execStatus.data.fill_price || 'N/A'}`);
        console.log(`  Fees: ${execStatus.data.fees_bps || 0} bps`);
        console.log(`  Venue: ${execStatus.data.venue || 'N/A'}`);
        break;
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.response?.data?.error || error.message);
  }

  console.log('\n✨ Demo completed!');
}

runPerpDemo().catch(console.error);