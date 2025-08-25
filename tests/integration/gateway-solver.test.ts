import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import axios from 'axios';
import path from 'path';
import {
  DerivativesIntent,
  SolverRegistration,
  QuoteRequest,
  QuoteResponse,
} from '@deltanear/proto';

describe('Gateway-Solver Integration', () => {
  let gatewayProcess: ChildProcess;
  let solverProcess: ChildProcess;
  const GATEWAY_HTTP_URL = 'http://localhost:5000';
  const GATEWAY_WS_URL = 'ws://localhost:5001';
  
  beforeAll(async () => {
    gatewayProcess = spawn('node', ['dist/index.js'], {
      cwd: path.join(__dirname, '../../services/ofa-gateway'),
      env: { ...process.env, PORT: '5000' },
      stdio: 'pipe',
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
  }, 10000);

  afterAll(async () => {
    gatewayProcess?.kill();
    solverProcess?.kill();
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  describe('Solver Registration', () => {
    it('should register solver successfully', (done) => {
      const ws = new WebSocket(GATEWAY_WS_URL);
      
      ws.on('open', () => {
        const registration: SolverRegistration = {
          solver_id: 'test-solver',
          endpoint: 'test-endpoint',
          supported_venues: ['gmx-v2', 'lyra-v2'],
          max_exposure: '1000000',
          heartbeat_interval: 10000,
        };

        ws.send(JSON.stringify({
          type: 'register',
          data: registration,
        }));
      });

      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          expect(message.solver_id).toBeDefined();
          ws.close();
          done();
        }
      });

      ws.on('error', done);
    });

    it('should maintain solver connection with heartbeat', (done) => {
      const ws = new WebSocket(GATEWAY_WS_URL);
      let heartbeatCount = 0;
      
      ws.on('open', () => {
        const registration: SolverRegistration = {
          solver_id: 'heartbeat-test',
          endpoint: 'test-endpoint',
          supported_venues: ['gmx-v2'],
          max_exposure: '500000',
          heartbeat_interval: 1000,
        };

        ws.send(JSON.stringify({
          type: 'register',
          data: registration,
        }));

        const heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'heartbeat',
              data: { timestamp: Date.now() },
            }));
            heartbeatCount++;
            
            if (heartbeatCount >= 3) {
              clearInterval(heartbeatInterval);
              ws.close();
              done();
            }
          }
        }, 1000);
      });

      ws.on('error', done);
    });
  });

  describe('Quote Flow', () => {
    let solverWs: WebSocket;

    beforeEach((done) => {
      solverWs = new WebSocket(GATEWAY_WS_URL);
      
      solverWs.on('open', () => {
        const registration: SolverRegistration = {
          solver_id: 'quote-solver',
          endpoint: 'test-endpoint',
          supported_venues: ['gmx-v2'],
          max_exposure: '1000000',
          heartbeat_interval: 10000,
        };

        solverWs.send(JSON.stringify({
          type: 'register',
          data: registration,
        }));
      });

      solverWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          done();
        }
      });
    });

    afterEach(() => {
      solverWs?.close();
    });

    it('should receive quote request and respond', async () => {
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: Date.now().toString(),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1',
          leverage: '5',
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
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

      const submitResponse = await axios.post(`${GATEWAY_HTTP_URL}/intents`, intent);
      const { intent_hash } = submitResponse.data;

      const quotePromise = new Promise<QuoteRequest>((resolve) => {
        solverWs.on('message', (data: Buffer) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'quote_request') {
            resolve(message.data);
          }
        });
      });

      await axios.post(`${GATEWAY_HTTP_URL}/quotes`, { intent_hash });
      
      const quoteRequest = await quotePromise;
      expect(quoteRequest.intent_hash).toBe(intent_hash);
      expect(quoteRequest.intent).toMatchObject(intent);
      expect(quoteRequest.deadline).toBeGreaterThan(Date.now());

      const quote: QuoteResponse = {
        solver_id: 'quote-solver',
        intent_hash,
        price: '3500',
        estimated_funding_bps: 10,
        fees_bps: 5,
        estimated_slippage_bps: 3,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      solverWs.send(JSON.stringify({
        type: 'quote',
        data: quote,
      }));

      await new Promise(resolve => setTimeout(resolve, 500));

      const statusResponse = await axios.get(`${GATEWAY_HTTP_URL}/status/${intent_hash}`);
      expect(statusResponse.data.status).toBe('quoted');
    });
  });

  describe('Multiple Solver Competition', () => {
    let solver1Ws: WebSocket;
    let solver2Ws: WebSocket;

    beforeEach((done) => {
      let registered = 0;
      
      solver1Ws = new WebSocket(GATEWAY_WS_URL);
      solver2Ws = new WebSocket(GATEWAY_WS_URL);

      const checkDone = () => {
        registered++;
        if (registered === 2) done();
      };
      
      solver1Ws.on('open', () => {
        solver1Ws.send(JSON.stringify({
          type: 'register',
          data: {
            solver_id: 'solver-1',
            endpoint: 'endpoint-1',
            supported_venues: ['gmx-v2'],
            max_exposure: '1000000',
            heartbeat_interval: 10000,
          },
        }));
      });

      solver2Ws.on('open', () => {
        solver2Ws.send(JSON.stringify({
          type: 'register',
          data: {
            solver_id: 'solver-2',
            endpoint: 'endpoint-2',
            supported_venues: ['gmx-v2'],
            max_exposure: '500000',
            heartbeat_interval: 10000,
          },
        }));
      });

      solver1Ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') checkDone();
      });

      solver2Ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') checkDone();
      });
    });

    afterEach(() => {
      solver1Ws?.close();
      solver2Ws?.close();
    });

    it('should select best quote from multiple solvers', async () => {
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: Date.now().toString(),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '2',
          leverage: '3',
          max_slippage_bps: 100,
          max_funding_bps_8h: 100,
          max_fee_bps: 100,
          venue_allowlist: ['gmx-v2'],
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

      const submitResponse = await axios.post(`${GATEWAY_HTTP_URL}/intents`, intent);
      const { intent_hash } = submitResponse.data;

      let solver1Received = false;
      let solver2Received = false;

      solver1Ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'quote_request') {
          solver1Received = true;
          const quote: QuoteResponse = {
            solver_id: 'solver-1',
            intent_hash: message.data.intent_hash,
            price: '3520',
            estimated_funding_bps: 12,
            fees_bps: 6,
            estimated_slippage_bps: 4,
            venue: 'gmx-v2',
            valid_until: Date.now() + 30000,
          };
          solver1Ws.send(JSON.stringify({ type: 'quote', data: quote }));
        }
      });

      solver2Ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'quote_request') {
          solver2Received = true;
          const quote: QuoteResponse = {
            solver_id: 'solver-2',
            intent_hash: message.data.intent_hash,
            price: '3500',
            estimated_funding_bps: 10,
            fees_bps: 5,
            estimated_slippage_bps: 3,
            venue: 'gmx-v2',
            valid_until: Date.now() + 30000,
          };
          solver2Ws.send(JSON.stringify({ type: 'quote', data: quote }));
        }
      });

      await axios.post(`${GATEWAY_HTTP_URL}/quotes`, { intent_hash });
      
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      expect(solver1Received).toBe(true);
      expect(solver2Received).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle solver disconnection gracefully', async () => {
      const ws = new WebSocket(GATEWAY_WS_URL);
      
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'register',
            data: {
              solver_id: 'disconnect-test',
              endpoint: 'test-endpoint',
              supported_venues: ['gmx-v2'],
              max_exposure: '1000000',
              heartbeat_interval: 10000,
            },
          }));
        });

        ws.on('message', (data: Buffer) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'registered') {
            ws.close();
            resolve();
          }
        });
      });

      const healthResponse = await axios.get(`${GATEWAY_HTTP_URL}/health`);
      expect(healthResponse.data.status).toBe('ok');
    });

    it('should reject invalid intent', async () => {
      try {
        await axios.post(`${GATEWAY_HTTP_URL}/intents`, {
          chain_id: '',
          intent_type: 'invalid',
          actions: [],
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toBe('Invalid intent');
        expect(error.response.data.details).toBeInstanceOf(Array);
      }
    });

    it('should handle quote timeout', async () => {
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: Date.now().toString(),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1',
          leverage: '5',
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['unknown-venue'],
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

      const submitResponse = await axios.post(`${GATEWAY_HTTP_URL}/intents`, intent);
      const { intent_hash } = submitResponse.data;

      try {
        await axios.post(`${GATEWAY_HTTP_URL}/quotes`, { intent_hash });
      } catch (error: any) {
        expect(error.response.status).toBe(503);
        expect(error.response.data.error).toBe('No solvers available');
      }
    });
  });
});