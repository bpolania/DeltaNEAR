import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import {
  DerivativesIntent,
  SignedIntent,
  QuoteRequest,
  QuoteResponse,
  ExecutionRequest,
  ExecutionResult,
  IntentReceipt,
  SolverRegistration,
  computeIntentHash,
  validateIntent,
  calculateTotalCost,
} from '@deltanear/proto';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

interface PendingIntent {
  intent: DerivativesIntent;
  intent_hash: string;
  status: 'pending' | 'quoted' | 'accepted' | 'executing' | 'completed' | 'failed';
  quotes: Map<string, QuoteResponse>;
  winning_solver?: string;
  exclusive_until?: number;
  signature?: string;
  public_key?: string;
  created_at: number;
}

interface SolverConnection {
  id: string;
  ws: WebSocket;
  registration: SolverRegistration;
  last_heartbeat: number;
  pending_requests: Set<string>;
}

class OFAGateway {
  private app: express.Application;
  private wss: WebSocketServer;
  private intents: Map<string, PendingIntent> = new Map();
  private solvers: Map<string, SolverConnection> = new Map();
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.wss = new WebSocketServer({ port: port + 1 });
    this.setupRoutes();
    this.setupWebSocket();
    this.startHeartbeatMonitor();
  }

  private setupRoutes() {
    this.app.post('/intents', this.handleSubmitIntent.bind(this));
    this.app.post('/quotes', this.handleRequestQuotes.bind(this));
    this.app.post('/accept', this.handleAcceptQuote.bind(this));
    this.app.get('/status/:intent_hash', this.handleGetStatus.bind(this));
    this.app.get('/health', (req, res) => res.json({ status: 'ok', solvers: this.solvers.size }));
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket) => {
      const solverId = uuidv4();
      logger.info({ solverId }, 'New solver connection');

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleSolverMessage(solverId, ws, message);
        } catch (error) {
          logger.error({ error, solverId }, 'Failed to parse solver message');
        }
      });

      ws.on('close', () => {
        logger.info({ solverId }, 'Solver disconnected');
        this.solvers.delete(solverId);
      });

      ws.on('error', (error) => {
        logger.error({ error, solverId }, 'Solver connection error');
      });
    });
  }

  private handleSolverMessage(solverId: string, ws: WebSocket, message: any) {
    switch (message.type) {
      case 'register':
        this.registerSolver(solverId, ws, message.data as SolverRegistration);
        break;
      case 'quote':
        this.handleSolverQuote(solverId, message.data as QuoteResponse);
        break;
      case 'execution_result':
        this.handleExecutionResult(solverId, message.data as ExecutionResult);
        break;
      case 'heartbeat':
        this.updateSolverHeartbeat(solverId);
        break;
      default:
        logger.warn({ solverId, type: message.type }, 'Unknown message type');
    }
  }

  private registerSolver(solverId: string, ws: WebSocket, registration: SolverRegistration) {
    const solver: SolverConnection = {
      id: solverId,
      ws,
      registration: { ...registration, solver_id: solverId },
      last_heartbeat: Date.now(),
      pending_requests: new Set(),
    };
    
    this.solvers.set(solverId, solver);
    ws.send(JSON.stringify({ type: 'registered', solver_id: solverId }));
    logger.info({ solverId, venues: registration.supported_venues }, 'Solver registered');
  }

  private updateSolverHeartbeat(solverId: string) {
    const solver = this.solvers.get(solverId);
    if (solver) {
      solver.last_heartbeat = Date.now();
    }
  }

  private startHeartbeatMonitor() {
    setInterval(() => {
      const now = Date.now();
      const timeout = 30000; // 30 seconds

      for (const [solverId, solver] of this.solvers.entries()) {
        if (now - solver.last_heartbeat > timeout) {
          logger.warn({ solverId }, 'Solver heartbeat timeout');
          solver.ws.close();
          this.solvers.delete(solverId);
        }
      }
    }, 10000);
  }

  private async handleSubmitIntent(req: express.Request, res: express.Response) {
    try {
      const intent = req.body as DerivativesIntent;
      
      const errors = validateIntent(intent);
      if (errors.length > 0) {
        return res.status(400).json({ error: 'Invalid intent', details: errors });
      }

      const intent_hash = computeIntentHash(intent);
      
      if (this.intents.has(intent_hash)) {
        return res.status(409).json({ error: 'Intent already exists', intent_hash });
      }

      const pendingIntent: PendingIntent = {
        intent,
        intent_hash,
        status: 'pending',
        quotes: new Map(),
        created_at: Date.now(),
      };

      this.intents.set(intent_hash, pendingIntent);
      logger.info({ intent_hash }, 'Intent submitted');

      res.json({ intent_hash, status: 'pending' });
    } catch (error) {
      logger.error({ error }, 'Failed to submit intent');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async handleRequestQuotes(req: express.Request, res: express.Response) {
    try {
      const { intent_hash } = req.body;
      
      const pendingIntent = this.intents.get(intent_hash);
      if (!pendingIntent) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (pendingIntent.status !== 'pending') {
        return res.status(400).json({ error: 'Intent already processed' });
      }

      const quoteRequest: QuoteRequest = {
        intent_hash,
        intent: pendingIntent.intent,
        deadline: Date.now() + 5000, // 5 second deadline
      };

      const eligibleSolvers = this.getEligibleSolvers(pendingIntent.intent);
      if (eligibleSolvers.length === 0) {
        return res.status(503).json({ error: 'No solvers available' });
      }

      pendingIntent.quotes.clear();
      pendingIntent.status = 'quoted';

      for (const solver of eligibleSolvers) {
        solver.pending_requests.add(intent_hash);
        solver.ws.send(JSON.stringify({
          type: 'quote_request',
          data: quoteRequest,
        }));
      }

      setTimeout(() => {
        this.selectWinningSolver(intent_hash);
      }, 5000);

      res.json({ 
        intent_hash, 
        status: 'requesting_quotes',
        solvers_contacted: eligibleSolvers.length 
      });
    } catch (error) {
      logger.error({ error }, 'Failed to request quotes');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getEligibleSolvers(intent: DerivativesIntent): SolverConnection[] {
    const eligible: SolverConnection[] = [];
    
    for (const solver of this.solvers.values()) {
      const venuesMatch = intent.actions.every(action =>
        action.venue_allowlist.some(venue =>
          solver.registration.supported_venues.includes(venue)
        )
      );
      
      if (venuesMatch) {
        eligible.push(solver);
      }
    }
    
    return eligible;
  }

  private handleSolverQuote(solverId: string, quote: QuoteResponse) {
    const pendingIntent = this.intents.get(quote.intent_hash);
    const solver = this.solvers.get(solverId);
    
    if (!pendingIntent || !solver) {
      return;
    }

    if (!solver.pending_requests.has(quote.intent_hash)) {
      logger.warn({ solverId, intent_hash: quote.intent_hash }, 'Unexpected quote');
      return;
    }

    pendingIntent.quotes.set(solverId, quote);
    solver.pending_requests.delete(quote.intent_hash);
    
    logger.info({ 
      solverId, 
      intent_hash: quote.intent_hash,
      price: quote.price,
      venue: quote.venue 
    }, 'Quote received');
  }

  private selectWinningSolver(intent_hash: string) {
    const pendingIntent = this.intents.get(intent_hash);
    if (!pendingIntent || pendingIntent.quotes.size === 0) {
      logger.warn({ intent_hash }, 'No quotes received');
      if (pendingIntent) {
        pendingIntent.status = 'failed';
      }
      return;
    }

    let bestQuote: QuoteResponse | null = null;
    let bestSolverId: string | null = null;
    let lowestCost = Infinity;

    for (const [solverId, quote] of pendingIntent.quotes) {
      const intent = pendingIntent.intent;
      const action = intent.actions[0];
      
      if (quote.estimated_slippage_bps > action.max_slippage_bps) continue;
      if (quote.fees_bps > action.max_fee_bps) continue;
      if (quote.estimated_funding_bps > action.max_funding_bps_8h) continue;

      const totalCost = calculateTotalCost(quote);
      if (totalCost < lowestCost) {
        lowestCost = totalCost;
        bestQuote = quote;
        bestSolverId = solverId;
      }
    }

    if (bestQuote && bestSolverId) {
      pendingIntent.winning_solver = bestSolverId;
      pendingIntent.exclusive_until = Date.now() + 10000; // 10 second exclusive window
      
      logger.info({ 
        intent_hash, 
        solver_id: bestSolverId,
        price: bestQuote.price,
        venue: bestQuote.venue,
        total_cost: lowestCost
      }, 'Winner selected');
    } else {
      pendingIntent.status = 'failed';
      logger.warn({ intent_hash }, 'No valid quotes after filtering');
    }
  }

  private async handleAcceptQuote(req: express.Request, res: express.Response) {
    try {
      const signedIntent = req.body as SignedIntent;
      const intent_hash = computeIntentHash(signedIntent.intent);
      
      const pendingIntent = this.intents.get(intent_hash);
      if (!pendingIntent) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (!pendingIntent.winning_solver) {
        return res.status(400).json({ error: 'No winning solver selected' });
      }

      pendingIntent.signature = signedIntent.signature;
      pendingIntent.public_key = signedIntent.public_key;
      pendingIntent.status = 'accepted';

      const solver = this.solvers.get(pendingIntent.winning_solver);
      if (!solver) {
        return res.status(503).json({ error: 'Winning solver disconnected' });
      }

      const executionRequest: ExecutionRequest = {
        intent_hash,
        intent: pendingIntent.intent,
        solver_id: pendingIntent.winning_solver,
        exclusive_until: pendingIntent.exclusive_until!,
      };

      solver.ws.send(JSON.stringify({
        type: 'execute',
        data: executionRequest,
      }));

      pendingIntent.status = 'executing';
      
      res.json({ 
        intent_hash, 
        status: 'executing',
        solver_id: pendingIntent.winning_solver,
        exclusive_until: pendingIntent.exclusive_until
      });
    } catch (error) {
      logger.error({ error }, 'Failed to accept quote');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private handleExecutionResult(solverId: string, result: ExecutionResult) {
    const pendingIntent = this.intents.get(result.intent_hash);
    if (!pendingIntent || pendingIntent.winning_solver !== solverId) {
      logger.warn({ solverId, intent_hash: result.intent_hash }, 'Invalid execution result');
      return;
    }

    if (result.status === 'filled') {
      pendingIntent.status = 'completed';
      logger.info({ 
        intent_hash: result.intent_hash,
        solver_id: solverId,
        fill_price: result.fill_price,
        pnl: result.pnl
      }, 'Execution completed');
    } else {
      pendingIntent.status = 'failed';
      logger.error({ 
        intent_hash: result.intent_hash,
        solver_id: solverId,
        status: result.status
      }, 'Execution failed');
    }
  }

  private async handleGetStatus(req: express.Request, res: express.Response) {
    try {
      const { intent_hash } = req.params;
      
      const pendingIntent = this.intents.get(intent_hash);
      if (!pendingIntent) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      const receipt: IntentReceipt = {
        intent_hash,
        status: pendingIntent.status as any,
        solver_id: pendingIntent.winning_solver,
        timestamp: pendingIntent.created_at,
      };

      if (pendingIntent.winning_solver && pendingIntent.quotes.has(pendingIntent.winning_solver)) {
        const quote = pendingIntent.quotes.get(pendingIntent.winning_solver)!;
        receipt.venue = quote.venue;
        receipt.fill_price = quote.price;
        receipt.fees_bps = quote.fees_bps;
      }

      res.json(receipt);
    } catch (error) {
      logger.error({ error }, 'Failed to get status');
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  start() {
    this.app.listen(this.port, () => {
      logger.info({ port: this.port }, 'OFA Gateway started');
      logger.info({ port: this.port + 1 }, 'WebSocket server started');
    });
  }
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000');
  const gateway = new OFAGateway(port);
  gateway.start();
}

export default OFAGateway;