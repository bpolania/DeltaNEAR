import {
  DerivativesIntent,
  Collateral,
  Option,
  QuoteResponse,
  createMinimalPerpIntent,
  createMinimalOptionIntent,
  computeIntentHash,
  validateIntent,
  calculateTotalCost,
} from './index';

describe('Proto Utilities (V2 Schema)', () => {
  describe('computeIntentHash', () => {
    it('should generate consistent hash for same intent', () => {
      const collateral: Collateral = {
        token: 'USDC',
        chain: 'near'
      };
      
      const intent = createMinimalPerpIntent(
        'ETH-USD',
        'long',
        '1.5',
        collateral,
        'user.testnet',
        '2024-12-31T23:59:59Z',
        'test-001'
      );

      const hash1 = computeIntentHash(intent);
      const hash2 = computeIntentHash(intent);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate different hash for different intents', () => {
      const collateral: Collateral = {
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

      const intent2 = { ...intent1, nonce: '2' };
      
      const hash1 = computeIntentHash(intent1);
      const hash2 = computeIntentHash(intent2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('validateIntent', () => {
    const validIntent: DerivativesIntent = {
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

    it('should validate a correct intent', () => {
      const errors = validateIntent(validIntent);
      expect(errors).toEqual([]);
    });

    it('should return errors for missing version', () => {
      const invalidIntent = { ...validIntent, version: '' };
      const errors = validateIntent(invalidIntent);
      expect(errors).toContain('Invalid version: . Must be 1.0.0');
    });

    it('should return errors for missing collateral', () => {
      const invalidIntent = {
        ...validIntent,
        derivatives: {
          ...validIntent.derivatives,
          collateral: undefined as any
        }
      };
      const errors = validateIntent(invalidIntent);
      expect(errors).toContain('Missing required field: collateral');
    });

    it('should return errors for missing required fields', () => {
      const invalidIntent = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {} as any,
        signer_id: '',
        deadline: '',
        nonce: ''
      };
      const errors = validateIntent(invalidIntent);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Missing required field: collateral');
    });

    it('should validate option intent with proper structure', () => {
      const optionIntent: DerivativesIntent = {
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
          leverage: '1',
          option: {
            kind: 'call',
            strike: '50000',
            expiry: '2024-12-31T00:00:00Z'
          },
          side: 'buy',
          size: '0.1',
          symbol: 'BTC-USD'
        },
        signer_id: 'user.testnet',
        deadline: '2024-12-30T23:59:59Z',
        nonce: 'test-option-001'
      };
      
      const errors = validateIntent(optionIntent);
      expect(errors).toEqual([]);
    });

    it('should reject option without option params', () => {
      const invalidOption: DerivativesIntent = {
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
      
      const errors = validateIntent(invalidOption);
      expect(errors).toContain('Missing option params for option instrument');
    });
  });

  describe('calculateTotalCost', () => {
    it('should calculate total cost in basis points', () => {
      const quote: QuoteResponse = {
        intent_hash: 'test-hash',
        solver_id: 'solver1',
        quote: {
          price: '3500',
          size: '1',
          fee: '3.5',  // 0.1% = 10 bps
          expiry: '2024-12-31T23:59:59Z',
          venue: 'gmx',
          chain: 'arbitrum'
        },
        status: 'success',
        timestamp: '2024-12-31T23:00:00Z'
      };

      const totalBps = calculateTotalCost(quote);
      expect(totalBps).toBe(10);
    });

    it('should handle zero fees', () => {
      const quote: QuoteResponse = {
        intent_hash: 'test-hash',
        solver_id: 'solver1',
        quote: {
          price: '3500',
          size: '1',
          fee: '0',
          expiry: '2024-12-31T23:59:59Z',
          venue: 'gmx',
          chain: 'arbitrum'
        },
        status: 'success',
        timestamp: '2024-12-31T23:00:00Z'
      };

      const totalBps = calculateTotalCost(quote);
      expect(totalBps).toBe(0);
    });
  });

  describe('Helper Functions', () => {
    it('should create minimal perp intent', () => {
      const collateral: Collateral = {
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
      expect(intent.signer_id).toBe('alice.testnet');
    });

    it('should create minimal option intent', () => {
      const collateral: Collateral = {
        token: 'USDC',
        chain: 'near'
      };
      
      const option: Option = {
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
      expect(intent.derivatives.option).toEqual(option);
      expect(intent.derivatives.collateral).toEqual(collateral);
      expect(intent.signer_id).toBe('bob.testnet');
    });
  });
});