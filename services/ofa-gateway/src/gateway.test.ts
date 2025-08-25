import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import axios from 'axios';
import OFAGateway from './index';
import {
  DerivativesIntent,
  SignedIntent,
  QuoteResponse,
  ExecutionResult,
} from '@deltanear/proto';

jest.mock('ws');

describe('OFA Gateway', () => {
  let gateway: any;
  let mockWs: jest.Mocked<WebSocket>;
  let mockWss: jest.Mocked<WebSocketServer>;

  beforeEach(() => {
    mockWs = {
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
    } as any;

    mockWss = {
      on: jest.fn((event, handler) => {
        if (event === 'connection') {
          setTimeout(() => handler(mockWs), 10);
        }
      }),
    } as any;

    (WebSocketServer as jest.MockedClass<typeof WebSocketServer>).mockImplementation(() => mockWss);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Intent Submission', () => {
    it('should accept valid intent', async () => {
      const gateway = new OFAGateway(4000);
      
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5',
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

      const req = {
        body: intent,
      } as express.Request;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await gateway['handleSubmitIntent'](req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          intent_hash: expect.any(String),
          status: 'pending',
        })
      );
    });

    it('should reject invalid intent', async () => {
      const gateway = new OFAGateway(4000);
      
      const intent = {
        chain_id: '',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) - 3600,
        account_id: 'user.testnet',
        actions: [],
        settlement: {
          payout_token: 'USDC',
          payout_account: 'user.testnet',
          protocol_fee_bps: 2,
          rebate_bps: 1,
        },
      };

      const req = {
        body: intent,
      } as express.Request;

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await gateway['handleSubmitIntent'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid intent',
          details: expect.any(Array),
        })
      );
    });

    it('should reject duplicate intent', async () => {
      const gateway = new OFAGateway(4000);
      
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5',
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

      const req = {
        body: intent,
      } as express.Request;

      const res1 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      const res2 = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await gateway['handleSubmitIntent'](req, res1);
      await gateway['handleSubmitIntent'](req, res2);

      expect(res2.status).toHaveBeenCalledWith(409);
      expect(res2.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Intent already exists',
        })
      );
    });
  });

  describe('Solver Management', () => {
    it('should register solver', () => {
      const gateway = new OFAGateway(4000);
      const solverId = 'solver-1';
      
      const registration = {
        solver_id: solverId,
        endpoint: 'solver-endpoint',
        supported_venues: ['gmx-v2', 'lyra-v2'],
        max_exposure: '1000000',
        heartbeat_interval: 10000,
      };

      gateway['registerSolver'](solverId, mockWs, registration);

      expect(gateway['solvers'].has(solverId)).toBe(true);
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'registered', solver_id: solverId })
      );
    });

    it('should update solver heartbeat', () => {
      const gateway = new OFAGateway(4000);
      const solverId = 'solver-1';
      
      const solver = {
        id: solverId,
        ws: mockWs,
        registration: {} as any,
        last_heartbeat: 0,
        pending_requests: new Set<string>(),
      };

      gateway['solvers'].set(solverId, solver as any);
      
      const beforeTime = Date.now();
      gateway['updateSolverHeartbeat'](solverId);
      
      const updatedSolver = gateway['solvers'].get(solverId);
      expect(updatedSolver!.last_heartbeat).toBeGreaterThanOrEqual(beforeTime);
    });

    it('should handle solver quote', () => {
      const gateway = new OFAGateway(4000);
      const solverId = 'solver-1';
      const intentHash = 'hash123';
      
      const solver = {
        id: solverId,
        ws: mockWs,
        registration: {} as any,
        last_heartbeat: Date.now(),
        pending_requests: new Set([intentHash]),
      };

      gateway['solvers'].set(solverId, solver as any);
      
      const pendingIntent = {
        intent: {} as any,
        intent_hash: intentHash,
        status: 'quoted' as const,
        quotes: new Map(),
        created_at: Date.now(),
      };

      gateway['intents'].set(intentHash, pendingIntent);

      const quote: QuoteResponse = {
        solver_id: solverId,
        intent_hash: intentHash,
        price: '3500',
        estimated_funding_bps: 10,
        fees_bps: 5,
        estimated_slippage_bps: 3,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      gateway['handleSolverQuote'](solverId, quote);

      expect(pendingIntent.quotes.has(solverId)).toBe(true);
      expect(pendingIntent.quotes.get(solverId)).toEqual(quote);
      expect(solver.pending_requests.has(intentHash)).toBe(false);
    });
  });

  describe('Auction Selection', () => {
    it('should select lowest cost solver', () => {
      const gateway = new OFAGateway(4000);
      const intentHash = 'hash123';
      
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5',
          leverage: '5',
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

      const pendingIntent = {
        intent,
        intent_hash: intentHash,
        status: 'quoted' as const,
        quotes: new Map(),
        created_at: Date.now(),
      };

      const quote1: QuoteResponse = {
        solver_id: 'solver-1',
        intent_hash: intentHash,
        price: '3500',
        estimated_funding_bps: 10,
        fees_bps: 5,
        estimated_slippage_bps: 3,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      const quote2: QuoteResponse = {
        solver_id: 'solver-2',
        intent_hash: intentHash,
        price: '3480',
        estimated_funding_bps: 15,
        fees_bps: 8,
        estimated_slippage_bps: 5,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      pendingIntent.quotes.set('solver-1', quote1);
      pendingIntent.quotes.set('solver-2', quote2);

      gateway['intents'].set(intentHash, pendingIntent);
      gateway['selectWinningSolver'](intentHash);

      expect((pendingIntent as any).winning_solver).toBe('solver-2');
      expect((pendingIntent as any).exclusive_until).toBeGreaterThan(Date.now());
    });

    it('should filter quotes by constraints', () => {
      const gateway = new OFAGateway(4000);
      const intentHash = 'hash123';
      
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5',
          leverage: '5',
          max_slippage_bps: 5,
          max_funding_bps_8h: 10,
          max_fee_bps: 3,
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

      const pendingIntent = {
        intent,
        intent_hash: intentHash,
        status: 'quoted' as const,
        quotes: new Map(),
        created_at: Date.now(),
      };

      const goodQuote: QuoteResponse = {
        solver_id: 'solver-1',
        intent_hash: intentHash,
        price: '3500',
        estimated_funding_bps: 8,
        fees_bps: 2,
        estimated_slippage_bps: 3,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      const badQuote: QuoteResponse = {
        solver_id: 'solver-2',
        intent_hash: intentHash,
        price: '3480',
        estimated_funding_bps: 15,
        fees_bps: 8,
        estimated_slippage_bps: 10,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      pendingIntent.quotes.set('solver-1', goodQuote);
      pendingIntent.quotes.set('solver-2', badQuote);

      gateway['intents'].set(intentHash, pendingIntent);
      gateway['selectWinningSolver'](intentHash);

      expect((pendingIntent as any).winning_solver).toBe('solver-1');
    });

    it('should mark intent as failed if no valid quotes', () => {
      const gateway = new OFAGateway(4000);
      const intentHash = 'hash123';
      
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5',
          leverage: '5',
          max_slippage_bps: 1,
          max_funding_bps_8h: 1,
          max_fee_bps: 1,
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

      const pendingIntent = {
        intent,
        intent_hash: intentHash,
        status: 'quoted' as const,
        quotes: new Map(),
        created_at: Date.now(),
      };

      const badQuote: QuoteResponse = {
        solver_id: 'solver-1',
        intent_hash: intentHash,
        price: '3500',
        estimated_funding_bps: 100,
        fees_bps: 100,
        estimated_slippage_bps: 100,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      pendingIntent.quotes.set('solver-1', badQuote);

      gateway['intents'].set(intentHash, pendingIntent);
      gateway['selectWinningSolver'](intentHash);

      expect(pendingIntent.status).toBe('failed');
      expect((pendingIntent as any).winning_solver).toBeUndefined();
    });
  });

  describe('Execution Handling', () => {
    it('should handle execution result', () => {
      const gateway = new OFAGateway(4000);
      const solverId = 'solver-1';
      const intentHash = 'hash123';
      
      const pendingIntent = {
        intent: {} as any,
        intent_hash: intentHash,
        status: 'executing' as const,
        quotes: new Map(),
        winning_solver: solverId,
        created_at: Date.now(),
      };

      gateway['intents'].set(intentHash, pendingIntent);

      const result: ExecutionResult = {
        intent_hash: intentHash,
        solver_id: solverId,
        venue: 'gmx-v2',
        fill_price: '3505',
        notional: '5257.50',
        fees_bps: 5,
        pnl: '50',
        status: 'filled',
      };

      gateway['handleExecutionResult'](solverId, result);

      expect(pendingIntent.status).toBe('completed');
    });

    it('should mark intent as failed on execution failure', () => {
      const gateway = new OFAGateway(4000);
      const solverId = 'solver-1';
      const intentHash = 'hash123';
      
      const pendingIntent = {
        intent: {} as any,
        intent_hash: intentHash,
        status: 'executing' as const,
        quotes: new Map(),
        winning_solver: solverId,
        created_at: Date.now(),
      };

      gateway['intents'].set(intentHash, pendingIntent);

      const result: ExecutionResult = {
        intent_hash: intentHash,
        solver_id: solverId,
        venue: 'gmx-v2',
        fill_price: '0',
        notional: '0',
        fees_bps: 0,
        pnl: '0',
        status: 'failed',
      };

      gateway['handleExecutionResult'](solverId, result);

      expect(pendingIntent.status).toBe('failed');
    });
  });
});