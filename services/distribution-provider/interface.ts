/**
 * DistributionProvider Interface
 * 
 * Abstracts the distribution layer to allow switching between:
 * - Our custom OFA gateway (current implementation)
 * - NEAR's native intent infrastructure (future)
 * - Other distribution networks
 */

import { DerivativesIntent, QuoteResponse, SignedIntent } from '@deltanear/proto';

export interface IntentQuote {
  solver_id: string;
  quote: QuoteResponse;
  timestamp: number;
}

export interface IntentStatus {
  intent_hash: string;
  status: 'pending' | 'quoted' | 'accepted' | 'executing' | 'settled' | 'failed';
  quotes?: IntentQuote[];
  winning_solver?: string;
  execution_details?: any;
  error?: string;
}

export interface DistributionProvider {
  /**
   * Publish an intent to the distribution network
   */
  publishIntent(intent: SignedIntent): Promise<{ intent_hash: string }>;

  /**
   * Request quotes from solvers
   */
  requestQuotes(intent_hash: string): Promise<void>;

  /**
   * Get collected quotes for an intent
   */
  getQuotes(intent_hash: string): Promise<IntentQuote[]>;

  /**
   * Accept a quote and assign to solver
   */
  acceptQuote(intent_hash: string, solver_id: string): Promise<void>;

  /**
   * Get current status of an intent
   */
  getStatus(intent_hash: string): Promise<IntentStatus>;

  /**
   * Subscribe to status updates (optional WebSocket support)
   */
  subscribeToUpdates?(intent_hash: string, callback: (status: IntentStatus) => void): () => void;

  /**
   * Health check
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Configuration for different provider types
 */
export interface ProviderConfig {
  type: 'ofa-gateway' | 'near-intents' | 'mock';
  endpoint: string;
  apiKey?: string;
  wsEndpoint?: string;
  options?: Record<string, any>;
}