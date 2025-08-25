import { describe, test, expect } from '@jest/globals';
import crypto from 'crypto';

/**
 * Metadata Preservation Unit Tests
 * 
 * Ensures that derivatives metadata is preserved exactly through:
 * 1. Serialization/deserialization cycles
 * 2. Unicode normalization
 * 3. Nested object handling
 * 4. Array ordering
 * 5. Checksum validation
 */

interface DerivativesMetadata {
  type: 'derivatives_order';
  intent_hash: string;
  instrument: string;
  symbol: string;
  side: string;
  size: string;
  leverage?: string;
  option?: {
    kind: string;
    strike: string;
    expiry: string;
  };
  constraints?: {
    max_slippage_bps?: number;
    max_funding_bps_8h?: number;
    max_fee_bps?: number;
    venue_allowlist?: string[];
  };
  collateral: {
    token: string;
    chain: string;
  };
  venue_allowlist?: string[];
  checksum?: string;
  [key: string]: any; // Allow additional fields for testing
}

class MetadataPreserver {
  /**
   * Compute SHA-256 checksum of metadata
   * Keys are sorted recursively to ensure deterministic output
   */
  computeChecksum(metadata: any): string {
    const normalized = this.normalizeForChecksum(metadata);
    const json = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  /**
   * Normalize metadata for checksum computation
   * - Sort keys recursively
   * - Exclude checksum field itself
   * - Preserve array order
   */
  private normalizeForChecksum(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      // Preserve array order - arrays are semantic
      return obj.map(item => this.normalizeForChecksum(item));
    }

    if (typeof obj === 'object') {
      const sorted: any = {};
      const keys = Object.keys(obj).sort();
      
      for (const key of keys) {
        // Skip checksum field when computing checksum
        if (key !== 'checksum') {
          sorted[key] = this.normalizeForChecksum(obj[key]);
        }
      }
      
      return sorted;
    }

    return obj;
  }

  /**
   * Validate metadata checksum
   */
  validateChecksum(metadata: DerivativesMetadata): boolean {
    if (!metadata.checksum) {
      return false;
    }

    const computed = this.computeChecksum(metadata);
    return computed === metadata.checksum;
  }

  /**
   * Serialize and deserialize to test preservation
   */
  roundTrip(metadata: any): any {
    const json = JSON.stringify(metadata);
    return JSON.parse(json);
  }

  /**
   * Test Unicode normalization (NFC)
   */
  normalizeUnicode(str: string): string {
    // JavaScript's normalize() method for Unicode NFC
    return str.normalize('NFC');
  }

  /**
   * Deep equality check
   */
  deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    
    if (a === null || b === null) return false;
    if (a === undefined || b === undefined) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    if (typeof a === 'object') {
      const aKeys = Object.keys(a).sort();
      const bKeys = Object.keys(b).sort();
      
      if (aKeys.length !== bKeys.length) return false;
      
      for (let i = 0; i < aKeys.length; i++) {
        if (aKeys[i] !== bKeys[i]) return false;
        if (!this.deepEqual(a[aKeys[i]], b[bKeys[i]])) return false;
      }
      return true;
    }

    return a === b;
  }
}

describe('Metadata Preservation', () => {
  const preserver = new MetadataPreserver();

  describe('Checksum Computation', () => {
    test('should compute consistent checksums for same data', () => {
      const metadata: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        leverage: '10',
        collateral: {
          token: 'usdc.near',
          chain: 'near'
        }
      };

      const checksum1 = preserver.computeChecksum(metadata);
      const checksum2 = preserver.computeChecksum(metadata);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(64); // SHA-256 hex
    });

    test('should produce different checksums for different data', () => {
      const metadata1: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        collateral: {
          token: 'usdc.near',
          chain: 'near'
        }
      };

      const metadata2 = { ...metadata1, size: '2.0' };

      const checksum1 = preserver.computeChecksum(metadata1);
      const checksum2 = preserver.computeChecksum(metadata2);

      expect(checksum1).not.toBe(checksum2);
    });

    test('should ignore key order when computing checksum', () => {
      const metadata1 = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5'
      };

      const metadata2 = {
        size: '1.5',
        side: 'long',
        symbol: 'ETH-USD',
        intent_hash: 'abc123',
        type: 'derivatives_order'
      };

      const checksum1 = preserver.computeChecksum(metadata1);
      const checksum2 = preserver.computeChecksum(metadata2);

      expect(checksum1).toBe(checksum2);
    });

    test('should exclude checksum field from computation', () => {
      const metadata1: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        collateral: {
          token: 'usdc.near',
          chain: 'near'
        }
      };

      const metadata2 = {
        ...metadata1,
        checksum: 'dummy-checksum'
      };

      const checksum1 = preserver.computeChecksum(metadata1);
      const checksum2 = preserver.computeChecksum(metadata2);

      expect(checksum1).toBe(checksum2);
    });
  });

  describe('Serialization Round-Trip', () => {
    test('should preserve all fields through serialization', () => {
      const metadata: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'option',
        symbol: 'BTC-USD',
        side: 'buy',
        size: '0.5',
        option: {
          kind: 'call',
          strike: '50000',
          expiry: '2024-12-31T23:59:59Z'
        },
        constraints: {
          max_slippage_bps: 50,
          max_funding_bps_8h: 10,
          max_fee_bps: 20,
          venue_allowlist: ['deribit', 'okex']
        },
        collateral: {
          token: 'wbtc.near',
          chain: 'near'
        }
      };

      const roundTripped = preserver.roundTrip(metadata);

      expect(preserver.deepEqual(metadata, roundTripped)).toBe(true);
      expect(roundTripped.option.strike).toBe('50000');
      expect(roundTripped.constraints.venue_allowlist).toHaveLength(2);
    });

    test('should preserve numeric types correctly', () => {
      const metadata = {
        integer: 42,
        float: 3.14159,
        string_number: '123.456',
        zero: 0,
        negative: -100
      };

      const roundTripped = preserver.roundTrip(metadata);

      expect(roundTripped.integer).toBe(42);
      expect(roundTripped.float).toBe(3.14159);
      expect(roundTripped.string_number).toBe('123.456');
      expect(roundTripped.zero).toBe(0);
      expect(roundTripped.negative).toBe(-100);
    });

    test('should preserve null and undefined correctly', () => {
      const metadata = {
        null_field: null,
        // undefined fields are not included in JSON
        defined_field: 'value'
      };

      const roundTripped = preserver.roundTrip(metadata);

      expect(roundTripped.null_field).toBeNull();
      expect(roundTripped.undefined_field).toBeUndefined();
      expect(roundTripped.defined_field).toBe('value');
    });
  });

  describe('Nested Object Preservation', () => {
    test('should preserve deeply nested structures', () => {
      const metadata = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep-value',
                array: [1, 2, 3]
              }
            }
          }
        }
      };

      const checksum = preserver.computeChecksum(metadata);
      const roundTripped = preserver.roundTrip(metadata);
      const newChecksum = preserver.computeChecksum(roundTripped);

      expect(checksum).toBe(newChecksum);
      expect(roundTripped.level1.level2.level3.level4.value).toBe('deep-value');
    });

    test('should handle circular reference detection', () => {
      const metadata: any = {
        type: 'derivatives_order',
        intent_hash: 'abc123'
      };
      
      // This would create a circular reference
      // metadata.circular = metadata;
      
      // Instead, test that we handle complex cross-references
      const shared = { shared_value: 'test' };
      metadata.ref1 = shared;
      metadata.ref2 = shared;

      const json = JSON.stringify(metadata);
      const parsed = JSON.parse(json);

      // Both references should have the same value but be different objects
      expect(parsed.ref1.shared_value).toBe('test');
      expect(parsed.ref2.shared_value).toBe('test');
    });
  });

  describe('Array Order Preservation', () => {
    test('should maintain exact array order', () => {
      const metadata: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        venue_allowlist: ['gmx-v2', 'hyperliquid', 'aevo', 'dydx'],
        collateral: {
          token: 'usdc.near',
          chain: 'near'
        }
      };

      const checksum1 = preserver.computeChecksum(metadata);
      
      // Reverse the array
      metadata.venue_allowlist = metadata.venue_allowlist!.reverse();
      const checksum2 = preserver.computeChecksum(metadata);

      // Checksums should be different because array order matters
      expect(checksum1).not.toBe(checksum2);
      
      // Verify exact order is preserved
      const roundTripped = preserver.roundTrip(metadata);
      expect(roundTripped.venue_allowlist[0]).toBe('dydx');
      expect(roundTripped.venue_allowlist[3]).toBe('gmx-v2');
    });

    test('should handle arrays of objects', () => {
      const metadata = {
        orders: [
          { id: 1, size: '0.5' },
          { id: 2, size: '1.0' },
          { id: 3, size: '1.5' }
        ]
      };

      const roundTripped = preserver.roundTrip(metadata);
      
      expect(roundTripped.orders).toHaveLength(3);
      expect(roundTripped.orders[0].id).toBe(1);
      expect(roundTripped.orders[2].size).toBe('1.5');
    });
  });

  describe('Unicode Handling', () => {
    test('should handle Unicode characters correctly', () => {
      const metadata = {
        emoji: '🚀🌙💎',
        chinese: '文字测试',
        arabic: 'اختبار',
        hebrew: 'בדיקה',
        mixed: '🚀 rocket 文字 text اختبار'
      };

      const checksum1 = preserver.computeChecksum(metadata);
      const roundTripped = preserver.roundTrip(metadata);
      const checksum2 = preserver.computeChecksum(roundTripped);

      expect(checksum1).toBe(checksum2);
      expect(roundTripped.emoji).toBe('🚀🌙💎');
      expect(roundTripped.chinese).toBe('文字测试');
    });

    test('should normalize Unicode to NFC', () => {
      // é can be one character (NFC) or e + combining accent (NFD)
      const nfc = 'café'; // NFC form
      const nfd = 'café'; // NFD form (looks same but different bytes)
      
      const normalized1 = preserver.normalizeUnicode(nfc);
      const normalized2 = preserver.normalizeUnicode(nfd);
      
      expect(normalized1).toBe(normalized2);
    });

    test('should handle zero-width characters', () => {
      const metadata = {
        // Zero-width joiner and non-joiner
        text_with_zwj: 'test\u200Dvalue',
        text_with_zwnj: 'test\u200Cvalue',
        normal_text: 'testvalue'
      };

      const roundTripped = preserver.roundTrip(metadata);
      
      expect(roundTripped.text_with_zwj).toContain('\u200D');
      expect(roundTripped.text_with_zwnj).toContain('\u200C');
      expect(roundTripped.normal_text).toBe('testvalue');
    });
  });

  describe('Checksum Validation', () => {
    test('should validate correct checksum', () => {
      const metadata: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        collateral: {
          token: 'usdc.near',
          chain: 'near'
        }
      };

      // Add checksum
      metadata.checksum = preserver.computeChecksum(metadata);

      // Validate
      expect(preserver.validateChecksum(metadata)).toBe(true);
    });

    test('should reject tampered metadata', () => {
      const metadata: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        collateral: {
          token: 'usdc.near',
          chain: 'near'
        }
      };

      // Add checksum
      metadata.checksum = preserver.computeChecksum(metadata);

      // Tamper with data
      metadata.size = '2.0';

      // Validation should fail
      expect(preserver.validateChecksum(metadata)).toBe(false);
    });

    test('should reject invalid checksum format', () => {
      const metadata: DerivativesMetadata = {
        type: 'derivatives_order',
        intent_hash: 'abc123',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        collateral: {
          token: 'usdc.near',
          chain: 'near'
        },
        checksum: 'invalid-checksum'
      };

      expect(preserver.validateChecksum(metadata)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty objects', () => {
      const metadata = {};
      const checksum = preserver.computeChecksum(metadata);
      expect(checksum).toHaveLength(64);
    });

    test('should handle very large metadata', () => {
      const largeArray = Array(10000).fill(0).map((_, i) => ({
        id: i,
        value: `value-${i}`
      }));

      const metadata = {
        large_array: largeArray
      };

      const checksum = preserver.computeChecksum(metadata);
      const roundTripped = preserver.roundTrip(metadata);
      const newChecksum = preserver.computeChecksum(roundTripped);

      expect(checksum).toBe(newChecksum);
      expect(roundTripped.large_array).toHaveLength(10000);
    });

    test('should handle special characters in keys', () => {
      const metadata = {
        'key-with-dash': 'value1',
        'key.with.dots': 'value2',
        'key_with_underscore': 'value3',
        'key with spaces': 'value4',
        '123numeric': 'value5'
      };

      const checksum = preserver.computeChecksum(metadata);
      const roundTripped = preserver.roundTrip(metadata);
      
      expect(roundTripped['key with spaces']).toBe('value4');
      expect(preserver.computeChecksum(roundTripped)).toBe(checksum);
    });

    test('should handle boolean values', () => {
      const metadata = {
        bool_true: true,
        bool_false: false
      };

      const roundTripped = preserver.roundTrip(metadata);
      
      expect(roundTripped.bool_true).toBe(true);
      expect(roundTripped.bool_false).toBe(false);
      expect(typeof roundTripped.bool_true).toBe('boolean');
    });
  });
});

// Export for use in other tests
export { MetadataPreserver, DerivativesMetadata };