#!/usr/bin/env node

const axios = require('axios');
const crypto = require('crypto');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOptionDemo() {
  console.log('🎯 DeltaNEAR Options Demo');
  console.log('=========================\n');

  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + 1);
  const expiryStr = expiryDate.toISOString().split('T')[0];

  const intent = {
    chain_id: 'near-testnet',
    intent_type: 'derivatives',
    nonce: Date.now().toString(),
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: 'demo-user.testnet',
    actions: [{
      instrument: 'option',
      symbol: 'ETH-USD',
      side: 'buy',
      size: '10',
      option: {
        kind: 'call',
        strike: '4000',
        expiry: `${expiryStr}T00:00:00Z`,
      },
      max_slippage_bps: 50,
      max_funding_bps_8h: 0,
      max_fee_bps: 10,
      venue_allowlist: ['lyra-v2'],
      collateral_token: 'USDC',
      collateral_chain: 'base',
    }],
    settlement: {
      payout_token: 'USDC',
      payout_account: 'demo-user.testnet',
      protocol_fee_bps: 3,
      rebate_bps: 1,
    },
  };

  console.log('📝 Option Details:');
  console.log(`  Symbol: ${intent.actions[0].symbol}`);
  console.log(`  Type: ${intent.actions[0].option.kind.toUpperCase()}`);
  console.log(`  Strike: $${intent.actions[0].option.strike}`);
  console.log(`  Expiry: ${expiryStr}`);
  console.log(`  Size: ${intent.actions[0].size} contracts`);
  console.log(`  Venue: ${intent.actions[0].venue_allowlist[0]}\n`);

  console.log('1️⃣ Submitting option intent...');
  const submitResponse = await axios.post(`${GATEWAY_URL}/intents`, intent);
  const { intent_hash } = submitResponse.data;
  console.log(`✅ Intent submitted: ${intent_hash}\n`);

  console.log('2️⃣ Requesting option quotes...');
  await axios.post(`${GATEWAY_URL}/quotes`, { intent_hash });
  console.log('⏳ Calculating option prices (5 seconds)...');
  
  await sleep(6000);

  console.log('3️⃣ Retrieving option pricing...');
  const statusResponse = await axios.get(`${GATEWAY_URL}/status/${intent_hash}`);
  console.log(`📊 Quote Status: ${statusResponse.data.status}`);
  
  if (statusResponse.data.solver_id) {
    console.log(`🏆 Selected Solver: ${statusResponse.data.solver_id}`);
    console.log(`📍 Venue: ${statusResponse.data.venue || 'Pending'}`);
    
    const spotPrice = 3500;
    const strike = parseFloat(intent.actions[0].option.strike);
    const intrinsic = Math.max(0, spotPrice - strike);
    console.log(`\n💰 Option Metrics:`);
    console.log(`  Spot Price: $${spotPrice}`);
    console.log(`  Strike Price: $${strike}`);
    console.log(`  Intrinsic Value: $${intrinsic.toFixed(2)}`);
    console.log(`  Time Value: ~$${Math.max(0, 150 - intrinsic).toFixed(2)}`);
  }

  console.log('\n4️⃣ Executing option order...');
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
    console.log(`✅ Option order accepted!`);
    console.log(`⚡ Execution Status: ${acceptResponse.data.status}`);
    console.log(`🔒 Exclusive Until: ${new Date(acceptResponse.data.exclusive_until).toLocaleTimeString()}\n`);

    console.log('5️⃣ Tracking option execution...');
    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      const execStatus = await axios.get(`${GATEWAY_URL}/status/${intent_hash}`);
      console.log(`  [${i+1}/5] Status: ${execStatus.data.status}`);
      
      if (execStatus.data.status === 'completed' || execStatus.data.status === 'failed') {
        console.log('\n📊 Final Option Details:');
        console.log(`  Premium Paid: $${execStatus.data.fill_price || 'N/A'} per contract`);
        console.log(`  Total Cost: $${(parseFloat(execStatus.data.fill_price || '0') * 10).toFixed(2)}`);
        console.log(`  Fees: ${execStatus.data.fees_bps || 0} bps`);
        console.log(`  Venue: ${execStatus.data.venue || 'N/A'}`);
        
        console.log('\n🎲 Greeks (Estimated):');
        console.log(`  Delta: 0.45`);
        console.log(`  Gamma: 0.002`);
        console.log(`  Theta: -2.5`);
        console.log(`  Vega: 15.3`);
        console.log(`  IV: 65%`);
        break;
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.response?.data?.error || error.message);
  }

  console.log('\n✨ Option demo completed!');
}

runOptionDemo().catch(console.error);