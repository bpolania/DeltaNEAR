import { Worker, NearAccount } from 'near-workspaces';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import axios from 'axios';
import {
  DerivativesIntent,
  SignedIntent,
  computeIntentHash,
} from '@deltanear/proto';
import * as ed25519 from 'ed25519-dalek';

describe('End-to-End Tests', () => {
  let worker: Worker;
  let contract: NearAccount;
  let alice: NearAccount;
  let treasury: NearAccount;
  let gatewayProcess: ChildProcess;
  let solver1Process: ChildProcess;
  let solver2Process: ChildProcess;

  const GATEWAY_URL = 'http://localhost:3000';
  const GATEWAY_WS_URL = 'ws://localhost:3001';

  beforeAll(async () => {
    worker = await Worker.init();
    
    treasury = await worker.rootAccount.createSubAccount('treasury');
    alice = await worker.rootAccount.createSubAccount('alice');
    
    const contractPath = path.join(__dirname, '../contracts/near-intents-derivatives');
    contract = await worker.rootAccount.devDeploy(contractPath, {
      initialBalance: '10 N',
      method: 'new',
      args: { treasury_account_id: treasury.accountId },
    });

    await contract.call(contract, 'add_authorized_solver', {
      solver_id: 'solver1.testnet',
    });
    await contract.call(contract, 'add_authorized_solver', {
      solver_id: 'solver2.testnet',
    });

    gatewayProcess = spawn('node', ['dist/index.js'], {
      cwd: path.join(__dirname, '../services/ofa-gateway'),
      env: { ...process.env, PORT: '3000' },
    });

    solver1Process = spawn('node', ['dist/index.js'], {
      cwd: path.join(__dirname, '../services/solver-node'),
      env: {
        ...process.env,
        SOLVER_ID: 'solver-1',
        GATEWAY_URL: GATEWAY_WS_URL,
        SUPPORTED_VENUES: 'gmx-v2,lyra-v2',
        MAX_EXPOSURE: '1000000',
        NEAR_ACCOUNT: 'solver1.testnet',
      },
    });

    solver2Process = spawn('node', ['dist/index.js'], {
      cwd: path.join(__dirname, '../services/solver-node'),
      env: {
        ...process.env,
        SOLVER_ID: 'solver-2',
        GATEWAY_URL: GATEWAY_WS_URL,
        SUPPORTED_VENUES: 'gmx-v2',
        MAX_EXPOSURE: '500000',
        NEAR_ACCOUNT: 'solver2.testnet',
      },
    });

    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  afterAll(async () => {
    gatewayProcess?.kill();
    solver1Process?.kill();
    solver2Process?.kill();
    await worker?.tearDown();
  });

  test('Perp Long Intent - Full Flow', async () => {
    const intent: DerivativesIntent = {
      chain_id: 'near-testnet',
      intent_type: 'derivatives',
      nonce: '1',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: alice.accountId,
      actions: [{
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        leverage: '5',
        option: undefined,
        max_slippage_bps: 10,
        max_funding_bps_8h: 20,
        max_fee_bps: 5,
        venue_allowlist: ['gmx-v2'],
        collateral_token: 'USDC',
        collateral_chain: 'arbitrum',
      }],
      settlement: {
        payout_token: 'USDC',
        payout_account: alice.accountId,
        protocol_fee_bps: 2,
        rebate_bps: 1,
      },
    };

    const submitResponse = await axios.post(`${GATEWAY_URL}/intents`, intent);
    expect(submitResponse.status).toBe(200);
    
    const { intent_hash } = submitResponse.data;
    expect(intent_hash).toBeDefined();

    const quoteResponse = await axios.post(`${GATEWAY_URL}/quotes`, { intent_hash });
    expect(quoteResponse.status).toBe(200);

    await new Promise(resolve => setTimeout(resolve, 6000));

    const keypair = ed25519.generateKeypair();
    const message = JSON.stringify(intent);
    const signature = ed25519.sign(message, keypair.secretKey);
    
    const signedIntent: SignedIntent = {
      intent,
      signature: Buffer.from(signature).toString('hex'),
      public_key: Buffer.from(keypair.publicKey).toString('hex'),
    };

    const acceptResponse = await axios.post(`${GATEWAY_URL}/accept`, signedIntent);
    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.data.status).toBe('executing');

    await new Promise(resolve => setTimeout(resolve, 3000));

    const statusResponse = await axios.get(`${GATEWAY_URL}/status/${intent_hash}`);
    expect(statusResponse.status).toBe(200);
    expect(['executing', 'completed']).toContain(statusResponse.data.status);
  });

  test('Option Call Buy Intent - Full Flow', async () => {
    const intent: DerivativesIntent = {
      chain_id: 'near-testnet',
      intent_type: 'derivatives',
      nonce: '2',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: alice.accountId,
      actions: [{
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '10',
        leverage: undefined,
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
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
        payout_account: alice.accountId,
        protocol_fee_bps: 3,
        rebate_bps: 1,
      },
    };

    const submitResponse = await axios.post(`${GATEWAY_URL}/intents`, intent);
    expect(submitResponse.status).toBe(200);
    
    const { intent_hash } = submitResponse.data;

    const quoteResponse = await axios.post(`${GATEWAY_URL}/quotes`, { intent_hash });
    expect(quoteResponse.status).toBe(200);

    await new Promise(resolve => setTimeout(resolve, 6000));

    const keypair = ed25519.generateKeypair();
    const message = JSON.stringify(intent);
    const signature = ed25519.sign(message, keypair.secretKey);
    
    const signedIntent: SignedIntent = {
      intent,
      signature: Buffer.from(signature).toString('hex'),
      public_key: Buffer.from(keypair.publicKey).toString('hex'),
    };

    const acceptResponse = await axios.post(`${GATEWAY_URL}/accept`, signedIntent);
    expect(acceptResponse.status).toBe(200);

    await new Promise(resolve => setTimeout(resolve, 3000));

    const statusResponse = await axios.get(`${GATEWAY_URL}/status/${intent_hash}`);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.data.venue).toBe('lyra-v2');
  });

  test('Risk Checks - Reject High Slippage', async () => {
    const intent: DerivativesIntent = {
      chain_id: 'near-testnet',
      intent_type: 'derivatives',
      nonce: '3',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: alice.accountId,
      actions: [{
        instrument: 'perp',
        symbol: 'BTC-USD',
        side: 'short',
        size: '0.5',
        leverage: '10',
        option: undefined,
        max_slippage_bps: 1,
        max_funding_bps_8h: 5,
        max_fee_bps: 2,
        venue_allowlist: ['gmx-v2'],
        collateral_token: 'USDC',
        collateral_chain: 'arbitrum',
      }],
      settlement: {
        payout_token: 'USDC',
        payout_account: alice.accountId,
        protocol_fee_bps: 2,
        rebate_bps: 1,
      },
    };

    const submitResponse = await axios.post(`${GATEWAY_URL}/intents`, intent);
    expect(submitResponse.status).toBe(200);
    
    const { intent_hash } = submitResponse.data;

    const quoteResponse = await axios.post(`${GATEWAY_URL}/quotes`, { intent_hash });
    expect(quoteResponse.status).toBe(200);

    await new Promise(resolve => setTimeout(resolve, 6000));

    const statusResponse = await axios.get(`${GATEWAY_URL}/status/${intent_hash}`);
    expect(statusResponse.data.status).toBe('quoted');
  });

  test('Contract Events and Settlement', async () => {
    const result = await contract.call(contract, 'submit_intent', {
      signed_intent: {
        intent: {
          chain_id: 'near-testnet',
          intent_type: 'derivatives',
          nonce: 100,
          expiry: Math.floor(Date.now() / 1000) + 3600,
          account_id: alice.accountId,
          actions: [{
            instrument: 'Perp',
            symbol: 'SOL-USD',
            side: 'Long',
            size: '5',
            leverage: '3',
            option: null,
            max_slippage_bps: 15,
            max_funding_bps_8h: 25,
            max_fee_bps: 8,
            venue_allowlist: ['gmx-v2'],
            collateral_token: 'USDC',
            collateral_chain: 'solana',
          }],
          settlement: {
            payout_token: 'USDC',
            payout_account: alice.accountId,
            protocol_fee_bps: 2,
            rebate_bps: 1,
          },
        },
        signature: '0'.repeat(128),
        public_key: '0'.repeat(64),
      },
    });

    expect(result).toBeDefined();
    
    const intentHash = result;
    
    await contract.call(contract, 'commit_execution', {
      intent_hash: intentHash,
      solver_id: 'solver1.testnet',
      venue: 'gmx-v2',
      fill_price: '140.50',
      notional: '702.50',
      fees_bps: 5,
    });

    await contract.call(contract, 'post_settlement', {
      intent_hash: intentHash,
      token: 'usdc.testnet',
      amount: '700',
      pnl: 50,
      fee: '14',
      rebate: '7',
    });

    const receipt = await contract.view('get_receipt', { intent_hash: intentHash });
    expect(receipt.status).toBe('Settled');
    expect(receipt.pnl).toBe(50);
  });
});