/**
 * Distribution Provider Tests
 * 
 * Demonstrates the abstraction layer working with different providers
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DistributionProviderFactory, DistributionProvider } from './index';
import { MockProvider } from './mock-provider';
import { SignedIntent } from '@deltanear/proto';

describe('Distribution Provider Abstraction', () => {
  let provider: DistributionProvider;
  
  afterEach(() => {
    DistributionProviderFactory.reset();
  });

  describe('Factory Pattern', () => {
    it('should create OFA Gateway provider', () => {
      provider = DistributionProviderFactory.create({
        type: 'ofa-gateway',
        endpoint: 'http://localhost:3000',
        wsEndpoint: 'ws://localhost:3001'
      });
      
      expect(provider).toBeDefined();
      expect(provider.publishIntent).toBeDefined();
      expect(provider.requestQuotes).toBeDefined();
    });

    it('should create NEAR Intents provider', () => {
      provider = DistributionProviderFactory.create({
        type: 'near-intents',
        endpoint: 'https://intents.near.org/api'
      });
      
      expect(provider).toBeDefined();
      expect(provider.publishIntent).toBeDefined();
    });

    it('should create Mock provider', () => {
      provider = DistributionProviderFactory.create({
        type: 'mock',
        endpoint: 'mock://localhost'
      });
      
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(MockProvider);
    });

    it('should maintain singleton instance', () => {
      const config = { type: 'mock' as const, endpoint: 'mock://' };
      
      const provider1 = DistributionProviderFactory.getInstance(config);
      const provider2 = DistributionProviderFactory.getInstance();
      
      expect(provider1).toBe(provider2);
    });
  });

  describe('Mock Provider Functionality', () => {
    let mockProvider: MockProvider;
    let signedIntent: SignedIntent;

    beforeEach(() => {
      mockProvider = new MockProvider({
        type: 'mock',
        endpoint: 'mock://'
      });
      
      mockProvider.simulateDelay = 0; // Instant responses for tests
      
      signedIntent = {
        intent: {
          chain_id: 'near-testnet',
          intent_type: 'derivatives',
          nonce: '1',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          account_id: 'user.testnet',
          actions: [{
            instrument: 'perp',
            symbol: 'ETH-USD',
            side: 'long',
            size: '1.0',
            leverage: '5',
            max_slippage_bps: 10,
            max_funding_bps_8h: 20,
            max_fee_bps: 5,
            venue_allowlist: ['gmx-v2'],
            collateral_token: 'USDC',
            collateral_chain: 'arbitrum'
          }],
          settlement: {
            payout_token: 'USDC',
            payout_account: 'user.testnet',
            protocol_fee_bps: 2,
            rebate_bps: 1
          }
        },
        signature: 'mock_signature',
        public_key: 'mock_public_key'
      };
    });

    it('should publish intent', async () => {
      const result = await mockProvider.publishIntent(signedIntent);
      
      expect(result.intent_hash).toBeDefined();
      expect(result.intent_hash).toContain('mock_');
    });

    it('should generate quotes', async () => {
      mockProvider.simulateQuoteCount = 3;
      
      const { intent_hash } = await mockProvider.publishIntent(signedIntent);
      await mockProvider.requestQuotes(intent_hash);
      
      const quotes = await mockProvider.getQuotes(intent_hash);
      
      expect(quotes).toHaveLength(3);
      expect(quotes[0].solver_id).toBe('mock_solver_1');
      expect(quotes[0].quote.price).toBe('1000');
      expect(quotes[1].quote.price).toBe('1050');
    });

    it('should accept quote and update status', async () => {
      const { intent_hash } = await mockProvider.publishIntent(signedIntent);
      await mockProvider.requestQuotes(intent_hash);
      
      const quotes = await mockProvider.getQuotes(intent_hash);
      await mockProvider.acceptQuote(intent_hash, quotes[0].solver_id);
      
      const status = await mockProvider.getStatus(intent_hash);
      
      expect(status.status).toBe('accepted');
      expect(status.winning_solver).toBe('mock_solver_1');
    });

    it('should handle subscriptions', async () => {
      const { intent_hash } = await mockProvider.publishIntent(signedIntent);
      
      const statuses: string[] = [];
      
      // Subscribe before triggering any actions
      const waitForSettled = new Promise<void>((resolve) => {
        const unsubscribe = mockProvider.subscribeToUpdates(
          intent_hash,
          (status) => {
            statuses.push(status.status);
            
            if (status.status === 'settled') {
              unsubscribe();
              resolve();
            }
          }
        );
      });
      
      // Trigger the flow
      await mockProvider.requestQuotes(intent_hash);
      const quotes = await mockProvider.getQuotes(intent_hash);
      await mockProvider.acceptQuote(intent_hash, quotes[0].solver_id);
      
      // Wait for the subscription to complete
      await waitForSettled;
      
      // Assert the expected statuses were received
      // Note: 'quoted' may be missed due to timing, but we should get the flow
      expect(statuses).toContain('accepted');
      expect(statuses).toContain('executing');
      expect(statuses).toContain('settled');
      expect(statuses.length).toBeGreaterThanOrEqual(3);
    });

    it('should simulate failures', async () => {
      mockProvider.simulateFailure = true;
      
      await expect(mockProvider.publishIntent(signedIntent))
        .rejects.toThrow('Mock: Intent publication failed');
      
      expect(await mockProvider.isHealthy()).toBe(false);
    });
  });

  describe('Provider Interface Compliance', () => {
    const providers = [
      { name: 'Mock', config: { type: 'mock' as const, endpoint: 'mock://' } },
      // Add other providers when available for testing
    ];

    providers.forEach(({ name, config }) => {
      describe(`${name} Provider`, () => {
        beforeEach(() => {
          provider = DistributionProviderFactory.create(config);
        });

        it('should implement all required methods', () => {
          expect(provider.publishIntent).toBeDefined();
          expect(provider.requestQuotes).toBeDefined();
          expect(provider.getQuotes).toBeDefined();
          expect(provider.acceptQuote).toBeDefined();
          expect(provider.getStatus).toBeDefined();
          expect(provider.isHealthy).toBeDefined();
        });

        it('should handle health checks', async () => {
          const isHealthy = await provider.isHealthy();
          expect(typeof isHealthy).toBe('boolean');
        });
      });
    });
  });

  describe('Environment Configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should load OFA Gateway from environment', () => {
      process.env.DISTRIBUTION_PROVIDER = 'ofa-gateway';
      process.env.OFA_GATEWAY_URL = 'http://gateway.example.com';
      process.env.OFA_GATEWAY_WS_URL = 'ws://gateway.example.com';
      
      const config = DistributionProviderFactory.fromEnv();
      
      expect(config.type).toBe('ofa-gateway');
      expect(config.endpoint).toBe('http://gateway.example.com');
      expect(config.wsEndpoint).toBe('ws://gateway.example.com');
    });

    it('should load NEAR Intents from environment', () => {
      process.env.DISTRIBUTION_PROVIDER = 'near-intents';
      process.env.NEAR_INTENTS_URL = 'https://intents.near.org';
      process.env.VERIFIER_CONTRACT = 'custom-verifier.near';
      
      const config = DistributionProviderFactory.fromEnv();
      
      expect(config.type).toBe('near-intents');
      expect(config.endpoint).toBe('https://intents.near.org');
      expect(config.options?.verifierContract).toBe('custom-verifier.near');
    });

    it('should default to OFA Gateway', () => {
      delete process.env.DISTRIBUTION_PROVIDER;
      
      const config = DistributionProviderFactory.fromEnv();
      
      expect(config.type).toBe('ofa-gateway');
      expect(config.endpoint).toBe('http://localhost:3000');
    });
  });
});