/**
 * Unit Tests for IntentStore
 */

import { IntentStore } from './intent-store';
import { DerivativesIntent } from '@deltanear/proto';

describe('IntentStore', () => {
  let store: IntentStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = new IntentStore(5 * 60 * 1000); // 5 minute TTL
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createMockIntent = (symbol: string = 'BTC-USD'): DerivativesIntent => ({
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      collateral: {
        chain: 'near',
        token: 'USDC'
      },
      constraints: {
        max_fee_bps: 30,
        max_funding_bps_8h: 50,
        max_slippage_bps: 100,
        venue_allowlist: ['gmx-v2', 'binance']
      },
      instrument: 'perp',
      side: 'long',
      size: '1000',
      symbol,
      leverage: '10',
      option: null
    },
    signer_id: 'user.testnet',
    deadline: '2025-12-31T23:59:59Z',
    nonce: '12345'
  });

  describe('store()', () => {
    it('should store an intent with its hash', () => {
      const intent = createMockIntent();
      const hash = 'hash123';

      store.store(hash, intent);

      const retrieved = store.get(hash);
      expect(retrieved).toEqual(intent);
    });

    it('should overwrite existing intent with same hash', () => {
      const intent1 = createMockIntent('BTC-USD');
      const intent2 = createMockIntent('ETH-USD');
      const hash = 'hash123';

      store.store(hash, intent1);
      store.store(hash, intent2);

      const retrieved = store.get(hash);
      expect(retrieved?.derivatives.symbol).toBe('ETH-USD');
    });
  });

  describe('get()', () => {
    it('should return undefined for non-existent intent', () => {
      const result = store.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return intent within TTL', () => {
      const intent = createMockIntent();
      const hash = 'hash123';

      store.store(hash, intent);
      
      // Advance time but stay within TTL
      jest.advanceTimersByTime(4 * 60 * 1000); // 4 minutes
      
      const retrieved = store.get(hash);
      expect(retrieved).toEqual(intent);
    });

    it('should return undefined for expired intent', () => {
      const intent = createMockIntent();
      const hash = 'hash123';

      store.store(hash, intent);
      
      // Advance time beyond TTL
      jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
      
      const retrieved = store.get(hash);
      expect(retrieved).toBeUndefined();
    });

    it('should clean up expired intent on get', () => {
      const intent = createMockIntent();
      const hash = 'hash123';

      store.store(hash, intent);
      
      // Advance time beyond TTL
      jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
      
      // First get should trigger cleanup
      store.get(hash);
      
      // Check stats to confirm cleanup
      const stats = store.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('remove()', () => {
    it('should remove an existing intent', () => {
      const intent = createMockIntent();
      const hash = 'hash123';

      store.store(hash, intent);
      store.remove(hash);

      const retrieved = store.get(hash);
      expect(retrieved).toBeUndefined();
    });

    it('should handle removing non-existent intent gracefully', () => {
      expect(() => {
        store.remove('nonexistent');
      }).not.toThrow();
    });
  });

  describe('cleanup()', () => {
    it('should automatically clean up expired intents', () => {
      const intent1 = createMockIntent('BTC-USD');
      const intent2 = createMockIntent('ETH-USD');
      const intent3 = createMockIntent('SOL-USD');

      // Store intents at different times
      store.store('hash1', intent1);
      
      jest.advanceTimersByTime(2 * 60 * 1000); // 2 minutes
      store.store('hash2', intent2);
      
      jest.advanceTimersByTime(1 * 60 * 1000); // 3 minutes total for hash1, 1 minute for hash2
      store.store('hash3', intent3);

      // hash1 is 3 minutes old, hash2 is 1 minute old, hash3 is fresh
      let stats = store.getStats();
      expect(stats.total).toBe(3);

      // Advance time to make only hash1 expire (past 5 minute TTL)
      jest.advanceTimersByTime(2.5 * 60 * 1000); // 5.5 minutes total for hash1, 3.5 for hash2, 2.5 for hash3

      // Trigger cleanup by advancing timer to next interval
      jest.advanceTimersByTime(60 * 1000); // Trigger interval

      // Only hash1 should be cleaned up (>5 min old), hash2 and hash3 should remain
      expect(store.get('hash1')).toBeUndefined();
      expect(store.get('hash2')).toBeDefined();
      expect(store.get('hash3')).toBeDefined();

      stats = store.getStats();
      expect(stats.total).toBe(2);
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', () => {
      const stats1 = store.getStats();
      expect(stats1.total).toBe(0);
      expect(stats1.oldest).toBeNull();

      const intent1 = createMockIntent('BTC-USD');
      const intent2 = createMockIntent('ETH-USD');
      
      const now = Date.now();
      jest.setSystemTime(now);
      
      store.store('hash1', intent1);
      
      jest.advanceTimersByTime(1000);
      store.store('hash2', intent2);

      const stats2 = store.getStats();
      expect(stats2.total).toBe(2);
      expect(stats2.oldest).toBe(now);
    });
  });

  describe('TTL configuration', () => {
    it('should respect custom TTL', () => {
      const customStore = new IntentStore(1 * 60 * 1000); // 1 minute TTL
      const intent = createMockIntent();
      const hash = 'hash123';

      customStore.store(hash, intent);
      
      // Should be available within TTL
      jest.advanceTimersByTime(30 * 1000); // 30 seconds
      expect(customStore.get(hash)).toBeDefined();
      
      // Should expire after TTL
      jest.advanceTimersByTime(40 * 1000); // 70 seconds total
      expect(customStore.get(hash)).toBeUndefined();
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple intents simultaneously', () => {
      const intents = Array.from({ length: 100 }, (_, i) => ({
        hash: `hash_${i}`,
        intent: createMockIntent(`PAIR-${i}`)
      }));

      // Store all intents
      intents.forEach(({ hash, intent }) => {
        store.store(hash, intent);
      });

      // Verify all are stored
      const stats = store.getStats();
      expect(stats.total).toBe(100);

      // Verify random access
      expect(store.get('hash_50')?.derivatives.symbol).toBe('PAIR-50');
      expect(store.get('hash_99')?.derivatives.symbol).toBe('PAIR-99');
      expect(store.get('hash_0')?.derivatives.symbol).toBe('PAIR-0');
    });
  });
});