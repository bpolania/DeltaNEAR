/**
 * Intent Storage Mechanism for Solver Node
 * 
 * Stores intents when quotes are requested so they can be
 * retrieved later during execution requests.
 */

import { DerivativesIntent } from '@deltanear/proto';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

export class IntentStore {
  private intents: Map<string, DerivativesIntent>;
  private timestamps: Map<string, number>;
  private readonly ttlMs: number;

  constructor(ttlMs: number = 5 * 60 * 1000) { // Default 5 minute TTL
    this.intents = new Map();
    this.timestamps = new Map();
    this.ttlMs = ttlMs;
    
    // Clean up expired intents every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Store an intent with its hash
   */
  store(intentHash: string, intent: DerivativesIntent): void {
    this.intents.set(intentHash, intent);
    this.timestamps.set(intentHash, Date.now());
    
    logger.debug({
      intentHash,
      symbol: intent.derivatives.symbol,
      side: intent.derivatives.side,
      size: intent.derivatives.size
    }, 'Intent stored');
  }

  /**
   * Retrieve an intent by hash
   */
  get(intentHash: string): DerivativesIntent | undefined {
    const timestamp = this.timestamps.get(intentHash);
    
    // Check if intent exists and hasn't expired
    if (timestamp && Date.now() - timestamp < this.ttlMs) {
      return this.intents.get(intentHash);
    }
    
    // Clean up expired intent if found
    if (timestamp) {
      this.remove(intentHash);
    }
    
    return undefined;
  }

  /**
   * Remove an intent from storage
   */
  remove(intentHash: string): void {
    this.intents.delete(intentHash);
    this.timestamps.delete(intentHash);
    
    logger.debug({ intentHash }, 'Intent removed');
  }

  /**
   * Clean up expired intents
   */
  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [hash, timestamp] of this.timestamps) {
      if (now - timestamp >= this.ttlMs) {
        expired.push(hash);
      }
    }
    
    for (const hash of expired) {
      this.remove(hash);
    }
    
    if (expired.length > 0) {
      logger.info({ count: expired.length }, 'Cleaned up expired intents');
    }
  }

  /**
   * Get statistics about stored intents
   */
  getStats(): { total: number; oldest: number | null } {
    const timestamps = Array.from(this.timestamps.values());
    return {
      total: this.intents.size,
      oldest: timestamps.length > 0 ? Math.min(...timestamps) : null
    };
  }
}