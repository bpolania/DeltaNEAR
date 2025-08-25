/**
 * DeltaNEAR Proto Types v2 - Rust-Compliant Schema
 * These types match the Rust canonicalization implementation exactly
 */

// Root intent structure matching Rust
export interface DerivativesIntentV2 {
  version: string;           // Must be "1.0.0"
  intent_type: string;        // Must be "derivatives"
  derivatives: DerivativesV2;
  signer_id: string;
  deadline: string;           // ISO 8601 timestamp with Z
  nonce: string;
  // NO metadata field allowed at root level
}

// Derivatives structure matching Rust
export interface DerivativesV2 {
  collateral: CollateralV2;       // REQUIRED
  constraints: ConstraintsV2;     // REQUIRED (with defaults)
  instrument: 'perp' | 'option';
  leverage?: string;               // Optional, default "1"
  option?: OptionV2 | null;        // Required for options, null for perps
  side: 'long' | 'short' | 'buy' | 'sell';
  size: string;                    // Canonical decimal
  symbol: string;                  // UPPERCASE
}

// Collateral structure
export interface CollateralV2 {
  chain: string;  // lowercase: near, ethereum, arbitrum, base, solana
  token: string;  // Preserve case
}

// Constraints structure
export interface ConstraintsV2 {
  max_fee_bps: number;         // Default 30, max 100
  max_funding_bps_8h: number;  // Default 50, max 100
  max_slippage_bps: number;    // Default 100, max 1000
  venue_allowlist: string[];   // Lowercase, sorted
}

// Option structure
export interface OptionV2 {
  expiry: string;  // ISO 8601 timestamp
  kind: 'call' | 'put';
  strike: string;  // Canonical decimal
}

// Signed intent wrapper
export interface SignedIntentV2 {
  intent: DerivativesIntentV2;
  signature: string;
  public_key: string;
}

// Solver API types (not canonicalized)
export interface QuoteRequestV2 {
  intent_hash: string;
  intent: DerivativesIntentV2;
  solver_id: string;
  preferences?: {
    max_slippage?: string;
    min_fill_rate?: string;
    preferred_chains?: string[];
  };
}

export interface QuoteResponseV2 {
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

export interface AcceptRequestV2 {
  intent_hash: string;
  solver_id: string;
  quote_id: string;
  signature: string;
  signer_id: string;
  timestamp: string;
}

export interface AcceptResponseV2 {
  intent_hash: string;
  status: 'accepted' | 'rejected';
  execution_id: string;
  solver_id: string;
  estimated_completion: string;
  venue: string;
  chain: string;
}

export interface SettlementV2 {
  intent_hash: string;
  execution_id: string;
  settlement: {
    type: 'token_diff';
    diffs: TokenDiffV2[];
    timestamp: string;
    block_height: number;
    transaction_hash: string;
  };
  status: 'settled' | 'failed';
}

export interface TokenDiffV2 {
  token: string;
  chain: string;
  amount: string;  // Can be negative
  account: string;
}

// Utility functions
export function createMinimalPerpIntent(
  symbol: string,
  side: 'long' | 'short',
  size: string,
  collateral: CollateralV2,
  signer_id: string,
  deadline: string,
  nonce: string
): DerivativesIntentV2 {
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
  option: OptionV2,
  collateral: CollateralV2,
  signer_id: string,
  deadline: string,
  nonce: string
): DerivativesIntentV2 {
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

// Validation functions
export function validateIntentV2(intent: DerivativesIntentV2): string[] {
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
    if (intent.derivatives.instrument === 'perp' && intent.derivatives.option !== null) {
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

export function computeIntentHashV2(intent: DerivativesIntentV2): string {
  const crypto = require('crypto');
  // In production, this should use the canonicalizer
  const message = JSON.stringify(intent);
  const hash = crypto.createHash('sha256').update(message).digest('hex');
  return hash;
}