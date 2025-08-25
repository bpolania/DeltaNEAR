export interface DerivativesIntent {
  chain_id: string;
  intent_type: 'derivatives';
  nonce: string;
  expiry: number;
  account_id: string;
  actions: DerivativeAction[];
  settlement: SettlementConfig;
}

export interface DerivativeAction {
  instrument: 'perp' | 'option';
  symbol: string;
  side: 'long' | 'short' | 'buy' | 'sell';
  size: string;
  leverage?: string;
  option?: OptionDetails;
  max_slippage_bps: number;
  max_funding_bps_8h: number;
  max_fee_bps: number;
  venue_allowlist: string[];
  collateral_token: string;
  collateral_chain: string;
}

export interface OptionDetails {
  kind: 'call' | 'put';
  strike: string;
  expiry: string;
}

export interface SettlementConfig {
  payout_token: string;
  payout_account: string;
  protocol_fee_bps: number;
  rebate_bps: number;
}

export interface SignedIntent {
  intent: DerivativesIntent;
  signature: string;
  public_key: string;
}

export interface QuoteRequest {
  intent_hash: string;
  intent: DerivativesIntent;
  deadline: number;
}

export interface QuoteResponse {
  solver_id: string;
  intent_hash: string;
  price: string;
  estimated_funding_bps: number;
  fees_bps: number;
  estimated_slippage_bps: number;
  venue: string;
  valid_until: number;
}

export interface ExecutionRequest {
  intent_hash: string;
  intent: DerivativesIntent;
  solver_id: string;
  exclusive_until: number;
}

export interface ExecutionResult {
  intent_hash: string;
  solver_id: string;
  venue: string;
  fill_price: string;
  notional: string;
  fees_bps: number;
  pnl: string;
  status: 'filled' | 'partial' | 'failed';
}

export interface SettlementData {
  intent_hash: string;
  token: string;
  amount: string;
  pnl: string;
  fee: string;
  rebate: string;
}

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

export function computeIntentHash(intent: DerivativesIntent): string {
  const crypto = require('crypto');
  const message = JSON.stringify(intent);
  const hash = crypto.createHash('sha256').update(message).digest('hex');
  return hash.substring(0, 64);
}

export function validateIntent(intent: DerivativesIntent): string[] {
  const errors: string[] = [];

  if (!intent.chain_id) errors.push('chain_id is required');
  if (intent.intent_type !== 'derivatives') errors.push('intent_type must be derivatives');
  if (!intent.nonce || parseInt(intent.nonce) <= 0) errors.push('invalid nonce');
  if (!intent.expiry || intent.expiry <= Date.now() / 1000) errors.push('intent expired');
  if (!intent.account_id) errors.push('account_id is required');
  if (!intent.actions || intent.actions.length === 0) errors.push('at least one action required');

  intent.actions.forEach((action, i) => {
    if (!['perp', 'option'].includes(action.instrument)) {
      errors.push(`action ${i}: invalid instrument`);
    }
    if (!action.symbol) errors.push(`action ${i}: symbol required`);
    if (!['long', 'short', 'buy', 'sell'].includes(action.side)) {
      errors.push(`action ${i}: invalid side`);
    }
    if (!action.size || parseFloat(action.size) <= 0) {
      errors.push(`action ${i}: invalid size`);
    }
    if (action.instrument === 'perp' && !action.leverage) {
      errors.push(`action ${i}: leverage required for perps`);
    }
    if (action.instrument === 'option' && !action.option) {
      errors.push(`action ${i}: option details required`);
    }
    if (action.max_slippage_bps > 1000) {
      errors.push(`action ${i}: max_slippage_bps too high`);
    }
    if (action.max_fee_bps > 100) {
      errors.push(`action ${i}: max_fee_bps too high`);
    }
    if (!action.venue_allowlist || action.venue_allowlist.length === 0) {
      errors.push(`action ${i}: venue_allowlist required`);
    }
  });

  if (!intent.settlement) errors.push('settlement config required');
  else {
    if (intent.settlement.protocol_fee_bps > 50) {
      errors.push('protocol_fee_bps too high');
    }
    if (intent.settlement.rebate_bps > intent.settlement.protocol_fee_bps) {
      errors.push('rebate_bps exceeds protocol_fee_bps');
    }
  }

  return errors;
}

export function calculateTotalCost(quote: QuoteResponse): number {
  const price = parseFloat(quote.price);
  const fundingCost = price * quote.estimated_funding_bps / 10000;
  const feeCost = price * quote.fees_bps / 10000;
  const slippageCost = price * quote.estimated_slippage_bps / 10000;
  return price + fundingCost + feeCost + slippageCost;
}