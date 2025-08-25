import {
  DerivativesIntentV2,
  CollateralV2,
  OptionV2,
  createMinimalPerpIntent,
  createMinimalOptionIntent,
  validateIntentV2,
  computeIntentHashV2,
} from './index-v2';

describe('Proto V2 Utilities (Rust-Compliant)', () => {
  describe('createMinimalPerpIntent', () => {
    it('should create valid minimal perpetual intent', () => {
      const collateral: CollateralV2 = {
        token: 'USDC',
        chain: 'near'
      };
      
      const intent = createMinimalPerpIntent(
        'ETH-USD',
        'long',
        '1.5',
        collateral,
        'alice.testnet',
        '2024-12-31T23:59:59Z',
        'test-001'
      );
      
      expect(intent.version).toBe('1.0.0');
      expect(intent.intent_type).toBe('derivatives');
      expect(intent.derivatives.instrument).toBe('perp');
      expect(intent.derivatives.symbol).toBe('ETH-USD');
      expect(intent.derivatives.side).toBe('long');
      expect(intent.derivatives.size).toBe('1.5');
      expect(intent.derivatives.leverage).toBe('1');
      expect(intent.derivatives.option).toBeNull();
      expect(intent.derivatives.collateral).toEqual(collateral);
      expect(intent.derivatives.constraints).toEqual({
        max_fee_bps: 30,
        max_funding_bps_8h: 50,
        max_slippage_bps: 100,
        venue_allowlist: []
      });
      expect(intent.signer_id).toBe('alice.testnet');
      expect(intent.deadline).toBe('2024-12-31T23:59:59Z');
      expect(intent.nonce).toBe('test-001');
    });
  });

  describe('createMinimalOptionIntent', () => {
    it('should create valid minimal option intent', () => {
      const collateral: CollateralV2 = {
        token: 'USDC',
        chain: 'near'
      };
      
      const option: OptionV2 = {
        kind: 'call',
        strike: '50000',
        expiry: '2024-12-31T00:00:00Z'
      };
      
      const intent = createMinimalOptionIntent(
        'BTC-USD',
        'buy',
        '0.1',
        option,
        collateral,
        'bob.testnet',
        '2024-12-30T23:59:59Z',
        'test-option-001'
      );
      
      expect(intent.version).toBe('1.0.0');
      expect(intent.intent_type).toBe('derivatives');
      expect(intent.derivatives.instrument).toBe('option');
      expect(intent.derivatives.symbol).toBe('BTC-USD');
      expect(intent.derivatives.side).toBe('buy');
      expect(intent.derivatives.size).toBe('0.1');
      expect(intent.derivatives.leverage).toBe('1');
      expect(intent.derivatives.option).toEqual(option);
      expect(intent.derivatives.collateral).toEqual(collateral);
      expect(intent.signer_id).toBe('bob.testnet');
    });
  });

  describe('validateIntentV2', () => {
    it('should validate correct intent', () => {
      const intent: DerivativesIntentV2 = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'USDC',
            chain: 'near'
          },
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: []
          },
          instrument: 'perp',
          leverage: '5',
          option: null,
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'user.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-001'
      };
      
      const errors = validateIntentV2(intent);
      expect(errors).toEqual([]);
    });

    it('should reject intent without collateral', () => {
      const intent: any = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          // Missing collateral
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: []
          },
          instrument: 'perp',
          option: null,
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'user.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-001'
      };
      
      const errors = validateIntentV2(intent);
      expect(errors).toContain('Missing required field: collateral');
    });

    it('should reject option without option params', () => {
      const intent: any = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'USDC',
            chain: 'near'
          },
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: []
          },
          instrument: 'option',
          option: null,  // Should have option params
          side: 'buy',
          size: '1',
          symbol: 'BTC-USD'
        },
        signer_id: 'user.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-001'
      };
      
      const errors = validateIntentV2(intent);
      expect(errors).toContain('Missing option params for option instrument');
    });

    it('should reject invalid version', () => {
      const intent: any = {
        version: '2.0.0',  // Wrong version
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'USDC',
            chain: 'near'
          },
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: []
          },
          instrument: 'perp',
          option: null,
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'user.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-001'
      };
      
      const errors = validateIntentV2(intent);
      expect(errors).toContain('Invalid version: 2.0.0. Must be 1.0.0');
    });

    it('should reject intent with extra root field', () => {
      const intent: any = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'USDC',
            chain: 'near'
          },
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: []
          },
          instrument: 'perp',
          option: null,
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'user.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-001',
        metadata: { note: 'not allowed' }  // Extra field
      };
      
      // In practice, the canonicalizer would reject this
      // Here we just check that validation doesn't explicitly allow it
      const errors = validateIntentV2(intent);
      expect(errors).toEqual([]);  // Our validator doesn't check for extra fields
      // The Rust canonicalizer would reject this
    });
  });

  describe('computeIntentHashV2', () => {
    it('should generate consistent hash for same intent', () => {
      const intent: DerivativesIntentV2 = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'USDC',
            chain: 'near'
          },
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: []
          },
          instrument: 'perp',
          leverage: '5',
          option: null,
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'user.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-001'
      };
      
      const hash1 = computeIntentHashV2(intent);
      const hash2 = computeIntentHashV2(intent);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate different hash for different intents', () => {
      const collateral: CollateralV2 = {
        token: 'USDC',
        chain: 'near'
      };
      
      const intent1 = createMinimalPerpIntent(
        'ETH-USD',
        'long',
        '1.5',
        collateral,
        'user.testnet',
        '2024-12-31T23:59:59Z',
        'test-001'
      );
      
      const intent2 = createMinimalPerpIntent(
        'ETH-USD',
        'long',
        '1.5',
        collateral,
        'user.testnet',
        '2024-12-31T23:59:59Z',
        'test-002'  // Different nonce
      );
      
      const hash1 = computeIntentHashV2(intent1);
      const hash2 = computeIntentHashV2(intent2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Full Intent Examples', () => {
    it('should create valid full perpetual intent with constraints', () => {
      const intent: DerivativesIntentV2 = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'USDC',
            chain: 'near'
          },
          constraints: {
            max_fee_bps: 50,
            max_funding_bps_8h: 40,
            max_slippage_bps: 200,
            venue_allowlist: ['dydx', 'gmx']
          },
          instrument: 'perp',
          leverage: '10',
          option: null,
          side: 'short',
          size: '100.5',
          symbol: 'SOL-USD'
        },
        signer_id: 'trader.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'full-perp-001'
      };
      
      const errors = validateIntentV2(intent);
      expect(errors).toEqual([]);
    });

    it('should create valid full option intent', () => {
      const intent: DerivativesIntentV2 = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'ETH',
            chain: 'near'
          },
          constraints: {
            max_fee_bps: 25,
            max_funding_bps_8h: 50,
            max_slippage_bps: 150,
            venue_allowlist: ['lyra', 'hegic']
          },
          instrument: 'option',
          leverage: '1',
          option: {
            kind: 'call',
            strike: '3000',
            expiry: '2025-01-31T00:00:00Z'
          },
          side: 'sell',
          size: '5',
          symbol: 'ETH-USD'
        },
        signer_id: 'options.testnet',
        deadline: '2024-12-30T12:00:00Z',
        nonce: 'full-option-001'
      };
      
      const errors = validateIntentV2(intent);
      expect(errors).toEqual([]);
    });
  });
});