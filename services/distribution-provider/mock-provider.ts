/**
 * Mock Distribution Provider
 * 
 * For testing purposes - provides deterministic responses
 */

import { DistributionProvider, IntentQuote, IntentStatus, ProviderConfig } from './interface';
import { SignedIntent } from '@deltanear/proto';

export class MockProvider implements DistributionProvider {
  private intents = new Map<string, IntentStatus>();
  private quotes = new Map<string, IntentQuote[]>();
  private subscriptions = new Map<string, Set<(status: IntentStatus) => void>>();
  
  // Control test behavior
  public simulateDelay = 100;
  public simulateFailure = false;
  public simulateQuoteCount = 2;

  constructor(private config: ProviderConfig) {}

  async publishIntent(intent: SignedIntent): Promise<{ intent_hash: string }> {
    if (this.simulateFailure) {
      throw new Error('Mock: Intent publication failed');
    }

    await this.delay();
    
    const intent_hash = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.intents.set(intent_hash, {
      intent_hash,
      status: 'pending',
      quotes: []
    });

    return { intent_hash };
  }

  async requestQuotes(intent_hash: string): Promise<void> {
    await this.delay();
    
    const status = this.intents.get(intent_hash);
    if (!status) {
      throw new Error('Intent not found');
    }

    // Generate mock quotes
    const mockQuotes: IntentQuote[] = [];
    for (let i = 0; i < this.simulateQuoteCount; i++) {
      mockQuotes.push({
        solver_id: `mock_solver_${i + 1}`,
        quote: {
          solver_id: `mock_solver_${i + 1}`,
          intent_hash,
          price: (1000 + i * 50).toString(),
          estimated_funding_bps: 20 + i * 5,
          fees_bps: 5 + i,
          estimated_slippage_bps: 10 + i * 2,
          venue: 'gmx-v2',
          valid_until: Math.floor(Date.now() / 1000) + 300
        },
        timestamp: Date.now()
      });
    }

    this.quotes.set(intent_hash, mockQuotes);
    
    // Update status
    status.status = 'quoted';
    status.quotes = mockQuotes;
    this.notifySubscribers(intent_hash, status);
  }

  async getQuotes(intent_hash: string): Promise<IntentQuote[]> {
    await this.delay();
    return this.quotes.get(intent_hash) || [];
  }

  async acceptQuote(intent_hash: string, solver_id: string): Promise<void> {
    await this.delay();
    
    const status = this.intents.get(intent_hash);
    if (!status) {
      throw new Error('Intent not found');
    }

    const quote = this.quotes.get(intent_hash)?.find(q => q.solver_id === solver_id);
    if (!quote) {
      throw new Error('Quote not found');
    }

    status.status = 'accepted';
    status.winning_solver = solver_id;
    this.notifySubscribers(intent_hash, status);

    // Simulate execution after a delay
    setTimeout(() => {
      status.status = 'executing';
      this.notifySubscribers(intent_hash, status);

      // Simulate settlement after another delay
      setTimeout(() => {
        if (this.simulateFailure) {
          status.status = 'failed';
          status.error = 'Mock: Execution failed';
        } else {
          status.status = 'settled';
          status.execution_details = {
            tx_hash: `0x${Math.random().toString(16).substr(2)}`,
            gas_used: '25000000000000',
            final_price: quote.quote.price
          };
        }
        this.notifySubscribers(intent_hash, status);
      }, this.simulateDelay * 2);
    }, this.simulateDelay);
  }

  async getStatus(intent_hash: string): Promise<IntentStatus> {
    await this.delay();
    
    const status = this.intents.get(intent_hash);
    if (!status) {
      throw new Error('Intent not found');
    }

    return { ...status };
  }

  subscribeToUpdates(intent_hash: string, callback: (status: IntentStatus) => void): () => void {
    if (!this.subscriptions.has(intent_hash)) {
      this.subscriptions.set(intent_hash, new Set());
    }
    
    this.subscriptions.get(intent_hash)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(intent_hash);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(intent_hash);
        }
      }
    };
  }

  async isHealthy(): Promise<boolean> {
    return !this.simulateFailure;
  }

  // Helper methods for testing
  private async delay() {
    if (this.simulateDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.simulateDelay));
    }
  }

  private notifySubscribers(intent_hash: string, status: IntentStatus) {
    const callbacks = this.subscriptions.get(intent_hash);
    if (callbacks) {
      callbacks.forEach(cb => {
        // Call async to simulate real behavior
        setTimeout(() => cb(status), 0);
      });
    }
  }

  // Test control methods
  reset() {
    this.intents.clear();
    this.quotes.clear();
    this.subscriptions.clear();
    this.simulateDelay = 100;
    this.simulateFailure = false;
    this.simulateQuoteCount = 2;
  }

  setIntentStatus(intent_hash: string, status: IntentStatus) {
    this.intents.set(intent_hash, status);
  }

  getStoredIntent(intent_hash: string): IntentStatus | undefined {
    return this.intents.get(intent_hash);
  }
}