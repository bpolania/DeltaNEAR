/**
 * DeltaNEAR V1.0.0 to V2.0.0 Migration Utilities
 * 
 * Converts V1.0.0 intents to V2.0.0 format by:
 * 1. Mapping chain_id -> derivatives.collateral.chain
 * 2. Adding required derivatives.constraints with defaults
 * 3. Requiring explicit collateral token specification
 */

import { DerivativesIntent, Constraints } from './index';

// Chain ID mapping from V1 to V2
export const CHAIN_MAPPING: Record<string, string> = {
  'near-testnet': 'near',
  'near-mainnet': 'near', 
  'arbitrum-testnet': 'arbitrum',
  'arbitrum-mainnet': 'arbitrum',
  'ethereum-testnet': 'ethereum',
  'ethereum-mainnet': 'ethereum',
  'base-testnet': 'base',
  'base-mainnet': 'base',
  'solana-testnet': 'solana',
  'solana-mainnet': 'solana'
};

// Default constraints for V2.0.0
export const DEFAULT_CONSTRAINTS: Constraints = {
  max_fee_bps: 30,
  max_funding_bps_8h: 50,
  max_slippage_bps: 100,
  venue_allowlist: []
};

// V1.0.0 Intent interface (legacy)
interface V1Intent {
  version: string;
  intent_type: string;
  derivatives: any;
  chain_id: string;  // This gets removed in V2
  signer_id: string;
  deadline: string;
  nonce: string;
}

// Migration options
interface MigrationOptions {
  token: string;  // Required: explicit token specification
  constraints?: Partial<Constraints>;  // Optional: custom constraints
}

/**
 * Migrates a V1.0.0 intent to V2.0.0 format
 */
export function migrateV1ToV2(v1Intent: V1Intent, options: MigrationOptions): DerivativesIntent {
  // Validate V1 structure
  if (!v1Intent.chain_id) {
    throw new Error('Missing chain_id in V1.0.0 intent');
  }
  
  if (!v1Intent.derivatives) {
    throw new Error('Missing derivatives in V1.0.0 intent');
  }

  // Map chain_id to collateral.chain
  const chain = CHAIN_MAPPING[v1Intent.chain_id];
  if (!chain) {
    throw new Error(`Unsupported chain_id: ${v1Intent.chain_id}. Supported: ${Object.keys(CHAIN_MAPPING).join(', ')}`);
  }

  // Require explicit token specification
  if (!options.token) {
    throw new Error('Token must be specified explicitly for V2.0.0');
  }

  // Create V2 intent
  const v2Intent: DerivativesIntent = {
    version: v1Intent.version,
    intent_type: v1Intent.intent_type,
    derivatives: {
      ...v1Intent.derivatives,
      collateral: {
        chain,
        token: options.token
      },
      constraints: {
        ...DEFAULT_CONSTRAINTS,
        ...options.constraints
      }
    },
    signer_id: v1Intent.signer_id,
    deadline: v1Intent.deadline,
    nonce: v1Intent.nonce
    // Note: chain_id is NOT copied - it's removed in V2
  };

  return v2Intent;
}