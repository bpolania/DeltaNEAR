/**
 * DeltaNEAR Proto Types - Rust-Compliant Schema V2
 * These types match the Rust canonicalization implementation exactly
 */

// Root intent structure matching Rust
export interface DerivativesIntent {
  version: string;           // Must be "1.0.0"
  intent_type: string;        // Must be "derivatives"
  derivatives: Derivatives;
  signer_id: string;
  deadline: string;           // ISO 8601 timestamp with Z
  nonce: string;
  // NO metadata field allowed at root level
}

// Derivatives structure matching Rust
export interface Derivatives {
  collateral: Collateral;       // REQUIRED
  constraints: Constraints;     // REQUIRED (with defaults)
  instrument: 'perp' | 'option';
  leverage?: string;             // Optional, default "1"
  option?: Option | null;        // Required for options, null for perps
  side: 'long' | 'short' | 'buy' | 'sell';
  size: string;                  // Canonical decimal
  symbol: string;                // UPPERCASE
}

// Collateral structure
export interface Collateral {
  chain: string;  // lowercase: near, ethereum, arbitrum, base, solana
  token: string;  // Preserve case
}

// Constraints structure
export interface Constraints {
  max_fee_bps: number;         // Default 30, max 100
  max_funding_bps_8h: number;  // Default 50, max 100
  max_slippage_bps: number;    // Default 100, max 1000
  venue_allowlist: string[];   // Lowercase, sorted
}

// Option structure
export interface Option {
  expiry: string;  // ISO 8601 timestamp
  kind: 'call' | 'put';
  strike: string;  // Canonical decimal
}

// Signed intent wrapper
export interface SignedIntent {
  intent: DerivativesIntent;
  signature: string;
  public_key: string;
}

// Solver API types (not canonicalized)
export interface QuoteRequest {
  intent_hash: string;
  intent: DerivativesIntent;
  solver_id: string;
  preferences?: {
    max_slippage?: string;
    min_fill_rate?: string;
    preferred_chains?: string[];
  };
}

export interface QuoteResponse {
  intent_hash: string;
  solver_id: string;
  quote: {
    price: string;
    size: string;
    fee: string;
    expiry: string;
    venue: string;
    chain: string;
  };
  status: 'success' | 'failed';
  timestamp: string;
}

export interface AcceptRequest {
  intent_hash: string;
  solver_id: string;
  quote_id: string;
  signature: string;
  signer_id: string;
  timestamp: string;
}

export interface AcceptResponse {
  intent_hash: string;
  status: 'accepted' | 'rejected';
  execution_id: string;
  solver_id: string;
  estimated_completion: string;
  venue: string;
  chain: string;
}

export interface Settlement {
  intent_hash: string;
  execution_id: string;
  settlement: {
    type: 'token_diff';
    diffs: TokenDiff[];
    timestamp: string;
    block_height: number;
    transaction_hash: string;
  };
  status: 'settled' | 'failed';
}

export interface TokenDiff {
  token: string;
  chain: string;
  amount: string;  // Can be negative
  account: string;
}

// Legacy types that services still use
export interface SolverRegistration {
  solver_id: string;
  endpoint: string;
  supported_venues: string[];
  max_exposure: string;
  heartbeat_interval: number;
}

export interface IntentReceipt {
  intent_hash: string;
  status: 'submitted' | 'quoted' | 'executing' | 'settled' | 'finalized' | 'failed';
  solver_id?: string;
  venue?: string;
  fill_price?: string;
  notional?: string;
  fees_bps?: number;
  pnl?: string;
  settlement_amount?: string;
  timestamp: number;
  error?: string;
}

export interface VenueQuote {
  venue: string;
  bid?: string;
  ask?: string;
  mid?: string;
  funding_rate_8h?: string;
  open_interest?: string;
  volume_24h?: string;
  iv?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
}

export interface RiskMetrics {
  max_exposure: string;
  current_exposure: string;
  margin_requirement: string;
  liquidation_price?: string;
  var_95?: string;
  stress_pnl?: string;
}

export interface AuctionConfig {
  quote_timeout_ms: number;
  execution_timeout_ms: number;
  min_solvers: number;
  selection_strategy: 'lowest_cost' | 'best_execution' | 'fastest';
}

export const NEP413_TAG = 'near-intents-derivatives';
export const INTENT_VERSION = '1.0.0';

// Utility functions
export function createMinimalPerpIntent(
  symbol: string,
  side: 'long' | 'short',
  size: string,
  collateral: Collateral,
  signer_id: string,
  deadline: string,
  nonce: string
): DerivativesIntent {
  return {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      collateral,
      constraints: {
        max_fee_bps: 30,
        max_funding_bps_8h: 50,
        max_slippage_bps: 100,
        venue_allowlist: []
      },
      instrument: 'perp',
      leverage: '1',
      option: null,
      side,
      size,
      symbol: symbol.toUpperCase()
    },
    signer_id: signer_id.toLowerCase(),
    deadline,
    nonce
  };
}

export function createMinimalOptionIntent(
  symbol: string,
  side: 'buy' | 'sell',
  size: string,
  option: Option,
  collateral: Collateral,
  signer_id: string,
  deadline: string,
  nonce: string
): DerivativesIntent {
  return {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      collateral,
      constraints: {
        max_fee_bps: 30,
        max_funding_bps_8h: 50,
        max_slippage_bps: 100,
        venue_allowlist: []
      },
      instrument: 'option',
      leverage: '1',
      option,
      side,
      size,
      symbol: symbol.toUpperCase()
    },
    signer_id: signer_id.toLowerCase(),
    deadline,
    nonce
  };
}

export function computeIntentHash(intent: DerivativesIntent): string {
  const crypto = require('crypto');
  // Note: In production, this should use proper canonicalization
  const message = JSON.stringify(intent);
  const hash = crypto.createHash('sha256').update(message).digest('hex');
  return hash;
}

// Re-export migration utilities
export { migrateV1ToV2, CHAIN_MAPPING, DEFAULT_CONSTRAINTS } from './migration';

export function validateIntent(intent: DerivativesIntent): string[] {
  const errors: string[] = [];
  
  // Check version
  if (intent.version !== '1.0.0') {
    errors.push(`Invalid version: ${intent.version}. Must be 1.0.0`);
  }
  
  // Check intent_type
  if (intent.intent_type !== 'derivatives') {
    errors.push(`Invalid intent_type: ${intent.intent_type}. Must be 'derivatives'`);
  }
  
  // Check derivatives
  if (!intent.derivatives) {
    errors.push('Missing derivatives field');
  } else {
    // Check collateral
    if (!intent.derivatives.collateral) {
      errors.push('Missing required field: collateral');
    } else {
      if (!intent.derivatives.collateral.chain || !intent.derivatives.collateral.token) {
        errors.push('Collateral must have chain and token');
      }
    }
    
    // Check constraints
    if (!intent.derivatives.constraints) {
      errors.push('Missing required field: constraints');
    }
    
    // Check instrument
    if (!['perp', 'option'].includes(intent.derivatives.instrument)) {
      errors.push(`Invalid instrument: ${intent.derivatives.instrument}`);
    }
    
    // Check option structure
    if (intent.derivatives.instrument === 'option' && !intent.derivatives.option) {
      errors.push('Missing option params for option instrument');
    }
    if (intent.derivatives.instrument === 'perp' && intent.derivatives.option !== null && intent.derivatives.option !== undefined) {
      errors.push('Option params must be null for perp instrument');
    }
    
    // Check required fields
    if (!intent.derivatives.side) errors.push('Missing required field: side');
    if (!intent.derivatives.size) errors.push('Missing required field: size');
    if (!intent.derivatives.symbol) errors.push('Missing required field: symbol');
  }
  
  // Check root fields
  if (!intent.signer_id) errors.push('Missing required field: signer_id');
  if (!intent.deadline) errors.push('Missing required field: deadline');
  if (!intent.nonce) errors.push('Missing required field: nonce');
  
  return errors;
}

export function calculateTotalCost(quote: QuoteResponse): number {
  // Parse fee as a number
  const fee = parseFloat(quote.quote.fee || '0');
  const price = parseFloat(quote.quote.price || '0');
  const size = parseFloat(quote.quote.size || '1');
  
  // Calculate as basis points if needed
  const totalValue = price * size;
  const bps = totalValue > 0 ? (fee / totalValue) * 10000 : 0;
  return Math.round(bps);
}

// Backwards compatibility exports (to be removed)
export type DerivativeAction = Derivatives;  // Temporary alias
export type OptionDetails = Option;  // Temporary alias
export type SettlementConfig = any;  // Deprecated
export type ExecutionRequest = AcceptRequest;  // Renamed
export type ExecutionResult = AcceptResponse;  // Renamed
export type SettlementData = Settlement;  // Renamed