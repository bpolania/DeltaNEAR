import WebSocket from 'ws';
import pino from 'pino';
import Decimal from 'decimal.js';
import {
  DerivativesIntent,
  QuoteRequest,
  QuoteResponse,
  ExecutionRequest,
  ExecutionResult,
  SettlementData,
  SolverRegistration,
  DerivativeAction,
  VenueQuote,
  RiskMetrics,
} from '@deltanear/proto';
import { VenueAdapter } from './adapters/base';
import { GMXv2Adapter } from './adapters/gmx-v2';
import { LyraV2Adapter } from './adapters/lyra-v2';
import { ChainSignatures } from './chain-signatures';
import { VerifierCompatibleSettlement } from './settlement';
import { RiskManager } from './risk-manager';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

interface SolverConfig {
  id: string;
  gateway_url: string;
  supported_venues: string[];
  max_exposure: string;
  near_account: string;
  near_private_key: string;
}

export class SolverNode {
  private ws?: WebSocket;
  private config: SolverConfig;
  private adapters: Map<string, VenueAdapter> = new Map();
  private chainSigner: ChainSignatures;
  private riskManager: RiskManager;
  private activeExecutions: Map<string, ExecutionRequest> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(config: SolverConfig) {
    this.config = config;
    this.chainSigner = new ChainSignatures(config.near_private_key);
    this.riskManager = new RiskManager(config.max_exposure);
    this.initializeAdapters();
  }

  private initializeAdapters() {
    if (this.config.supported_venues.includes('gmx-v2')) {
      this.adapters.set('gmx-v2', new GMXv2Adapter());
    }
    if (this.config.supported_venues.includes('lyra-v2')) {
      this.adapters.set('lyra-v2', new LyraV2Adapter());
    }
    
    logger.info({ venues: Array.from(this.adapters.keys()) }, 'Adapters initialized');
  }

  async start() {
    await this.connect();
    this.startHeartbeat();
  }

  private async connect() {
    const wsUrl = this.config.gateway_url.replace('http', 'ws');
    logger.info({ url: wsUrl }, 'Connecting to gateway');

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info('Connected to gateway');
      this.reconnectAttempts = 0;
      this.register();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.error({ error }, 'Failed to parse message');
      }
    });

    this.ws.on('close', () => {
      logger.warn('Disconnected from gateway');
      this.attemptReconnect();
    });

    this.ws.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      process.exit(1);
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    logger.info({ attempt: this.reconnectAttempts, delay }, 'Reconnecting...');
    setTimeout(() => this.connect(), delay);
  }

  private register() {
    const registration: SolverRegistration = {
      solver_id: this.config.id,
      endpoint: `solver-${this.config.id}`,
      supported_venues: this.config.supported_venues,
      max_exposure: this.config.max_exposure,
      heartbeat_interval: 10000,
    };

    this.send('register', registration);
  }

  private startHeartbeat() {
    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send('heartbeat', { timestamp: Date.now() });
      }
    }, 10000);
  }

  private send(type: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  private async handleMessage(message: any) {
    switch (message.type) {
      case 'registered':
        logger.info({ solver_id: message.solver_id }, 'Registered with gateway');
        break;
      case 'quote_request':
        await this.handleQuoteRequest(message.data as QuoteRequest);
        break;
      case 'execute':
        await this.handleExecutionRequest(message.data as ExecutionRequest);
        break;
      default:
        logger.warn({ type: message.type }, 'Unknown message type');
    }
  }

  private async handleQuoteRequest(request: QuoteRequest) {
    try {
      logger.info({ intent_hash: request.intent_hash }, 'Processing quote request');
      
      const action = request.intent.derivatives;
      const bestQuote = await this.findBestQuote(action);
      
      if (!bestQuote) {
        logger.warn({ intent_hash: request.intent_hash }, 'No valid quote available');
        return;
      }

      const riskCheck = this.riskManager.checkConstraints(
        action,
        bestQuote.quote,
        new Decimal(action.size)
      );

      if (!riskCheck.allowed) {
        logger.warn({ 
          intent_hash: request.intent_hash,
          reason: riskCheck.reason 
        }, 'Risk check failed');
        return;
      }

      const quote: QuoteResponse = {
        intent_hash: request.intent_hash,
        solver_id: this.config.id,
        quote: {
          price: bestQuote.quote.mid || bestQuote.quote.ask || '0',
          size: action.size,
          fee: (parseFloat(action.size) * 5 / 10000).toString(),
          expiry: new Date(Date.now() + 30000).toISOString(),
          venue: bestQuote.venue,
          chain: action.collateral.chain
        },
        status: 'success' as const,
        timestamp: new Date().toISOString()
      };

      this.send('quote', quote);
      logger.info({ 
        intent_hash: request.intent_hash,
        venue: bestQuote.venue,
        price: quote.quote.price
      }, 'Quote sent');
    } catch (error) {
      logger.error({ error, intent_hash: request.intent_hash }, 'Failed to generate quote');
    }
  }

  private async findBestQuote(action: DerivativeAction): Promise<{ venue: string; quote: VenueQuote } | null> {
    const quotes: { venue: string; quote: VenueQuote }[] = [];

    for (const venue of action.constraints.venue_allowlist) {
      const adapter = this.adapters.get(venue);
      if (!adapter) continue;

      try {
        const quote = await adapter.quote({
          instrument: action.instrument,
          symbol: action.symbol,
          side: action.side,
          size: action.size,
          leverage: action.leverage,
          option: action.option || undefined,
        });
        
        quotes.push({ venue, quote });
      } catch (error) {
        logger.error({ error, venue }, 'Failed to get quote');
      }
    }

    if (quotes.length === 0) return null;

    quotes.sort((a, b) => {
      const priceA = parseFloat(a.quote.mid || a.quote.ask || '0');
      const priceB = parseFloat(b.quote.mid || b.quote.ask || '0');
      return action.side === 'long' || action.side === 'buy' ? priceA - priceB : priceB - priceA;
    });

    return quotes[0];
  }

  private async handleExecutionRequest(request: ExecutionRequest) {
    try {
      logger.info({ 
        intent_hash: request.intent_hash
      }, 'Starting execution');

      this.activeExecutions.set(request.intent_hash, request);
      
      // TODO: In a real system, look up the intent by request.intent_hash
      // For now, create a mock derivatives object for compilation
      const action = {
        collateral: { chain: 'near', token: 'usdc.fakes' },
        constraints: { 
          venue_allowlist: ['gmx-v2'], 
          max_funding_bps_8h: 50,
          max_fee_bps: 30,
          max_slippage_bps: 100
        },
        instrument: 'perp' as const,
        size: '1000',
        symbol: 'BTC',
        side: 'long' as const,
        leverage: '10',
        option: null
      };
      const adapter = this.adapters.get(action.constraints.venue_allowlist[0]);
      
      if (!adapter) {
        throw new Error('No adapter available for execution');
      }

      await this.allocateCollateral(action);

      const executionResult = await adapter.execute({
        instrument: action.instrument,
        symbol: action.symbol,
        side: action.side,
        size: action.size,
        leverage: action.leverage,
        option: action.option || undefined,
      }, Date.now() + 60000);

      const pnl = await this.calculatePnL(action, executionResult);
      
      await this.settleOnNEAR(request.intent_hash, action, executionResult, pnl);

      const result: ExecutionResult = {
        intent_hash: request.intent_hash,
        solver_id: this.config.id,
        status: 'accepted' as const,
        execution_id: `exec_${Date.now()}`,
        estimated_completion: new Date(Date.now() + 60000).toISOString(),
        venue: action.constraints.venue_allowlist[0],
        chain: action.collateral.chain
      };

      this.send('execution_result', result);
      logger.info({ 
        intent_hash: request.intent_hash,
        execution_id: result.execution_id,
        venue: result.venue
      }, 'Execution completed');

      this.activeExecutions.delete(request.intent_hash);
    } catch (error) {
      logger.error({ error, intent_hash: request.intent_hash }, 'Execution failed');
      
      const result: ExecutionResult = {
        intent_hash: request.intent_hash,
        solver_id: this.config.id,
        status: 'rejected' as const,
        execution_id: `exec_${Date.now()}`,
        estimated_completion: new Date().toISOString(),
        venue: 'gmx-v2',
        chain: 'near'
      };
      
      this.send('execution_result', result);
      this.activeExecutions.delete(request.intent_hash);
    }
  }

  private async allocateCollateral(action: DerivativeAction) {
    const size = new Decimal(action.size);
    const leverage = action.leverage ? new Decimal(action.leverage) : new Decimal(1);
    const requiredCollateral = size.div(leverage);

    logger.info({ 
      token: action.collateral.token,
      chain: action.collateral.chain,
      amount: requiredCollateral.toString()
    }, 'Allocating collateral');

    await this.chainSigner.signAndBroadcast({
      chain: action.collateral.chain,
      to: 'vault.address',
      data: {
        action: 'deposit',
        token: action.collateral.token,
        amount: requiredCollateral.toString(),
      },
    });
  }

  private async calculatePnL(action: DerivativeAction, execution: any): Promise<Decimal> {
    const entryPrice = new Decimal(execution.fill_price);
    const size = new Decimal(action.size);
    
    const currentPrice = entryPrice.mul(1.01);
    
    let pnl: Decimal;
    if (action.side === 'long' || action.side === 'buy') {
      pnl = currentPrice.sub(entryPrice).mul(size);
    } else {
      pnl = entryPrice.sub(currentPrice).mul(size);
    }

    const fees = entryPrice.mul(size).mul(0.0005);
    return pnl.sub(fees);
  }

  private async settleOnNEAR(
    intent_hash: string,
    action: DerivativeAction,
    execution: any,
    pnl: Decimal
  ) {
    // Use Verifier for atomic settlement, not custom contract
    // The metadata contract only logs, doesn't handle tokens
    
    const settlementParams = {
      userAccount: 'user.testnet',
      solverAccount: this.config.near_account,
      collateralToken: action.collateral.token,
      settlementToken: action.collateral.token, // Same as collateral for simplicity
      entryPrice: execution.entryPrice.toString(),
      exitPrice: execution.exitPrice.toString(),
      size: action.size,
      leverage: action.leverage || '1',
      side: action.side as 'long' | 'short',
      venue: execution.venue,
      intentHash: intent_hash
    };
    
    logger.info({ settlementParams }, 'Settling via Verifier');
    
    // In production, this would use the VerifierSettlement class
    // For now, we simulate the settlement
    logger.info({
      intent_hash,
      pnl: pnl.toString(),
      message: 'Settlement would go through Verifier.execute_intents with TokenDiff'
    }, 'Settlement prepared for Verifier');
    
    // Log execution in metadata contract (no token handling)
    await this.logExecutionMetadata(intent_hash, execution);
  }
  
  private async logExecutionMetadata(intent_hash: string, execution: any) {
    // This only logs to the thin metadata contract
    // No token transfers happen here
    await this.chainSigner.signAndBroadcast({
      chain: 'near',
      to: 'derivatives-metadata.testnet',
      data: {
        action: 'log_execution',
        intent_hash,
        solver_id: this.config.near_account,
        venue: execution.venue,
        fill_price: execution.exitPrice.toString(),
        notional: execution.notional,
        fees_bps: 20
      }
    });
  }
}

if (require.main === module) {
  const config: SolverConfig = {
    id: process.env.SOLVER_ID || 'solver-1',
    gateway_url: process.env.GATEWAY_URL || 'ws://localhost:3001',
    supported_venues: (process.env.SUPPORTED_VENUES || 'gmx-v2,lyra-v2').split(','),
    max_exposure: process.env.MAX_EXPOSURE || '1000000',
    near_account: process.env.NEAR_ACCOUNT || 'solver1.testnet',
    near_private_key: process.env.NEAR_PRIVATE_KEY || '',
  };

  const solver = new SolverNode(config);
  solver.start().catch(error => {
    logger.error({ error }, 'Failed to start solver');
    process.exit(1);
  });
}

export default SolverNode;