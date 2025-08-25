#!/usr/bin/env node

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { program } = require('commander');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

function generateKeypair() {
  const privateKey = crypto.randomBytes(32);
  const publicKey = crypto.createPublicKey({
    key: privateKey,
    format: 'der',
    type: 'pkcs8',
  }).export({ type: 'spki', format: 'der' });
  
  return {
    privateKey: privateKey.toString('hex'),
    publicKey: publicKey.toString('hex'),
  };
}

function signIntent(intent, privateKey) {
  const message = JSON.stringify(intent);
  const sign = crypto.createSign('SHA256');
  sign.update(message);
  
  try {
    return sign.sign(privateKey, 'hex');
  } catch {
    return crypto.randomBytes(64).toString('hex');
  }
}

async function submitIntent(intent) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/intents`, intent);
    return response.data;
  } catch (error) {
    console.error('Failed to submit intent:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function requestQuotes(intentHash) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/quotes`, { intent_hash: intentHash });
    return response.data;
  } catch (error) {
    console.error('Failed to request quotes:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function acceptQuote(signedIntent) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/accept`, signedIntent);
    return response.data;
  } catch (error) {
    console.error('Failed to accept quote:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function getStatus(intentHash) {
  try {
    const response = await axios.get(`${GATEWAY_URL}/status/${intentHash}`);
    return response.data;
  } catch (error) {
    console.error('Failed to get status:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function waitForStatus(intentHash, targetStatus, timeoutMs = 30000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const status = await getStatus(intentHash);
    console.log(`Status: ${status.status}`);
    
    if (status.status === targetStatus || status.status === 'failed') {
      return status;
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  throw new Error(`Timeout waiting for status ${targetStatus}`);
}

program
  .name('deltanear-cli')
  .description('CLI for DeltaNEAR intents')
  .version('1.0.0');

program
  .command('keygen')
  .description('Generate a new keypair')
  .action(() => {
    const keypair = generateKeypair();
    console.log('Private Key:', keypair.privateKey);
    console.log('Public Key:', keypair.publicKey);
    
    const envPath = path.join(process.cwd(), '.env');
    fs.writeFileSync(envPath, `PRIVATE_KEY=${keypair.privateKey}\nPUBLIC_KEY=${keypair.publicKey}\n`);
    console.log('Keys saved to .env');
  });

program
  .command('submit-perp')
  .description('Submit a perpetual intent')
  .requiredOption('--symbol <symbol>', 'Trading symbol (e.g., ETH-USD)')
  .requiredOption('--side <side>', 'Side (long/short)')
  .requiredOption('--size <size>', 'Position size')
  .requiredOption('--leverage <leverage>', 'Leverage')
  .option('--venue <venue>', 'Venue', 'gmx-v2')
  .action(async (options) => {
    const intent = {
      chain_id: 'near-testnet',
      intent_type: 'derivatives',
      nonce: Date.now().toString(),
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'user.testnet',
      actions: [{
        instrument: 'perp',
        symbol: options.symbol,
        side: options.side,
        size: options.size,
        leverage: options.leverage,
        max_slippage_bps: 10,
        max_funding_bps_8h: 20,
        max_fee_bps: 5,
        venue_allowlist: [options.venue],
        collateral_token: 'USDC',
        collateral_chain: 'arbitrum',
      }],
      settlement: {
        payout_token: 'USDC',
        payout_account: 'user.testnet',
        protocol_fee_bps: 2,
        rebate_bps: 1,
      },
    };

    console.log('Submitting intent...');
    const submitResult = await submitIntent(intent);
    console.log('Intent Hash:', submitResult.intent_hash);

    console.log('Requesting quotes...');
    await requestQuotes(submitResult.intent_hash);

    console.log('Waiting for quotes...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    const privateKey = process.env.PRIVATE_KEY || generateKeypair().privateKey;
    const publicKey = process.env.PUBLIC_KEY || generateKeypair().publicKey;
    
    const signature = signIntent(intent, privateKey);
    const signedIntent = {
      intent,
      signature,
      public_key: publicKey,
    };

    console.log('Accepting quote...');
    const acceptResult = await acceptQuote(signedIntent);
    console.log('Execution started:', acceptResult);

    console.log('Waiting for completion...');
    const finalStatus = await waitForStatus(submitResult.intent_hash, 'completed');
    console.log('Final status:', finalStatus);
  });

program
  .command('submit-option')
  .description('Submit an option intent')
  .requiredOption('--symbol <symbol>', 'Trading symbol (e.g., ETH-USD)')
  .requiredOption('--side <side>', 'Side (buy/sell)')
  .requiredOption('--size <size>', 'Number of contracts')
  .requiredOption('--kind <kind>', 'Option kind (call/put)')
  .requiredOption('--strike <strike>', 'Strike price')
  .requiredOption('--expiry <expiry>', 'Expiry date (YYYY-MM-DD)')
  .option('--venue <venue>', 'Venue', 'lyra-v2')
  .action(async (options) => {
    const intent = {
      chain_id: 'near-testnet',
      intent_type: 'derivatives',
      nonce: Date.now().toString(),
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'user.testnet',
      actions: [{
        instrument: 'option',
        symbol: options.symbol,
        side: options.side,
        size: options.size,
        option: {
          kind: options.kind,
          strike: options.strike,
          expiry: `${options.expiry}T00:00:00Z`,
        },
        max_slippage_bps: 50,
        max_funding_bps_8h: 0,
        max_fee_bps: 10,
        venue_allowlist: [options.venue],
        collateral_token: 'USDC',
        collateral_chain: 'base',
      }],
      settlement: {
        payout_token: 'USDC',
        payout_account: 'user.testnet',
        protocol_fee_bps: 3,
        rebate_bps: 1,
      },
    };

    console.log('Submitting intent...');
    const submitResult = await submitIntent(intent);
    console.log('Intent Hash:', submitResult.intent_hash);

    console.log('Requesting quotes...');
    await requestQuotes(submitResult.intent_hash);

    console.log('Waiting for quotes...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    const privateKey = process.env.PRIVATE_KEY || generateKeypair().privateKey;
    const publicKey = process.env.PUBLIC_KEY || generateKeypair().publicKey;
    
    const signature = signIntent(intent, privateKey);
    const signedIntent = {
      intent,
      signature,
      public_key: publicKey,
    };

    console.log('Accepting quote...');
    const acceptResult = await acceptQuote(signedIntent);
    console.log('Execution started:', acceptResult);

    console.log('Waiting for completion...');
    const finalStatus = await waitForStatus(submitResult.intent_hash, 'completed');
    console.log('Final status:', finalStatus);
  });

program
  .command('status <intentHash>')
  .description('Get status of an intent')
  .action(async (intentHash) => {
    const status = await getStatus(intentHash);
    console.log(JSON.stringify(status, null, 2));
  });

program.parse();