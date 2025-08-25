import {
  DerivativesIntent,
  QuoteResponse,
  computeIntentHash,
  validateIntent,
  calculateTotalCost,
} from './index';

describe('Proto Utilities', () => {
  describe('computeIntentHash', () => {
    it('should generate consistent hash for same intent', () => {
      const intent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5',
          leverage: '5',
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
          collateral_token: 'USDC',
          collateral_chain: 'arbitrum',
        }],
        settlement: {
          payout_token: 'USDC',
          payout_account: 'user.testnet',
          protocol_fee_bps: 2,
          rebate_bps: 1,
        },
      };

      const hash1 = computeIntentHash(intent);
      const hash2 = computeIntentHash(intent);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate different hash for different intents', () => {
      const intent1: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5',
          leverage: '5',
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
          collateral_token: 'USDC',
          collateral_chain: 'arbitrum',
        }],
        settlement: {
          payout_token: 'USDC',
          payout_account: 'user.testnet',
          protocol_fee_bps: 2,
          rebate_bps: 1,
        },
      };

      const intent2 = { ...intent1, nonce: '2' };
      
      const hash1 = computeIntentHash(intent1);
      const hash2 = computeIntentHash(intent2);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('validateIntent', () => {
    const validIntent: DerivativesIntent = {
      chain_id: 'near-testnet',
      intent_type: 'derivatives',
      nonce: '1',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'user.testnet',
      actions: [{
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        leverage: '5',
        max_slippage_bps: 10,
        max_funding_bps_8h: 20,
        max_fee_bps: 5,
        venue_allowlist: ['gmx-v2'],
        collateral_token: 'USDC',
        collateral_chain: 'arbitrum',
      }],
      settlement: {
        payout_token: 'USDC',
        payout_account: 'user.testnet',
        protocol_fee_bps: 2,
        rebate_bps: 1,
      },
    };

    it('should validate correct intent', () => {
      const errors = validateIntent(validIntent);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing chain_id', () => {
      const intent = { ...validIntent, chain_id: '' };
      const errors = validateIntent(intent);
      expect(errors).toContain('chain_id is required');
    });

    it('should reject wrong intent_type', () => {
      const intent = { ...validIntent, intent_type: 'invalid' as any };
      const errors = validateIntent(intent);
      expect(errors).toContain('intent_type must be derivatives');
    });

    it('should reject expired intent', () => {
      const intent = { ...validIntent, expiry: Math.floor(Date.now() / 1000) - 3600 };
      const errors = validateIntent(intent);
      expect(errors).toContain('intent expired');
    });

    it('should reject invalid nonce', () => {
      const intent = { ...validIntent, nonce: '0' };
      const errors = validateIntent(intent);
      expect(errors).toContain('invalid nonce');
    });

    it('should reject empty actions', () => {
      const intent = { ...validIntent, actions: [] };
      const errors = validateIntent(intent);
      expect(errors).toContain('at least one action required');
    });

    it('should reject invalid instrument', () => {
      const intent = {
        ...validIntent,
        actions: [{
          ...validIntent.actions[0],
          instrument: 'invalid' as any,
        }],
      };
      const errors = validateIntent(intent);
      expect(errors.some(e => e.includes('invalid instrument'))).toBe(true);
    });

    it('should reject high slippage', () => {
      const intent = {
        ...validIntent,
        actions: [{
          ...validIntent.actions[0],
          max_slippage_bps: 1001,
        }],
      };
      const errors = validateIntent(intent);
      expect(errors.some(e => e.includes('max_slippage_bps too high'))).toBe(true);
    });

    it('should reject high fees', () => {
      const intent = {
        ...validIntent,
        actions: [{
          ...validIntent.actions[0],
          max_fee_bps: 101,
        }],
      };
      const errors = validateIntent(intent);
      expect(errors.some(e => e.includes('max_fee_bps too high'))).toBe(true);
    });

    it('should reject perp without leverage', () => {
      const intent = {
        ...validIntent,
        actions: [{
          ...validIntent.actions[0],
          leverage: undefined,
        }],
      };
      const errors = validateIntent(intent);
      expect(errors.some(e => e.includes('leverage required for perps'))).toBe(true);
    });

    it('should reject option without details', () => {
      const intent = {
        ...validIntent,
        actions: [{
          ...validIntent.actions[0],
          instrument: 'option' as const,
          option: undefined,
        }],
      };
      const errors = validateIntent(intent);
      expect(errors.some(e => e.includes('option details required'))).toBe(true);
    });

    it('should reject high protocol fee', () => {
      const intent = {
        ...validIntent,
        settlement: {
          ...validIntent.settlement,
          protocol_fee_bps: 51,
        },
      };
      const errors = validateIntent(intent);
      expect(errors).toContain('protocol_fee_bps too high');
    });

    it('should reject rebate exceeding protocol fee', () => {
      const intent = {
        ...validIntent,
        settlement: {
          ...validIntent.settlement,
          protocol_fee_bps: 2,
          rebate_bps: 3,
        },
      };
      const errors = validateIntent(intent);
      expect(errors).toContain('rebate_bps exceeds protocol_fee_bps');
    });
  });

  describe('calculateTotalCost', () => {
    it('should calculate total cost correctly', () => {
      const quote: QuoteResponse = {
        solver_id: 'solver-1',
        intent_hash: 'hash123',
        price: '1000',
        estimated_funding_bps: 10,
        fees_bps: 5,
        estimated_slippage_bps: 3,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      const totalCost = calculateTotalCost(quote);
      
      const expectedCost = 1000 + (1000 * 0.001) + (1000 * 0.0005) + (1000 * 0.0003);
      expect(totalCost).toBeCloseTo(expectedCost, 2);
    });

    it('should handle zero costs', () => {
      const quote: QuoteResponse = {
        solver_id: 'solver-1',
        intent_hash: 'hash123',
        price: '1000',
        estimated_funding_bps: 0,
        fees_bps: 0,
        estimated_slippage_bps: 0,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      const totalCost = calculateTotalCost(quote);
      expect(totalCost).toBe(1000);
    });

    it('should handle high bps values', () => {
      const quote: QuoteResponse = {
        solver_id: 'solver-1',
        intent_hash: 'hash123',
        price: '1000',
        estimated_funding_bps: 100,
        fees_bps: 50,
        estimated_slippage_bps: 25,
        venue: 'gmx-v2',
        valid_until: Date.now() + 30000,
      };

      const totalCost = calculateTotalCost(quote);
      const expectedCost = 1000 + (1000 * 0.01) + (1000 * 0.005) + (1000 * 0.0025);
      expect(totalCost).toBeCloseTo(expectedCost, 2);
    });
  });

  describe('Option Intent Validation', () => {
    it('should validate option intent correctly', () => {
      const optionIntent: DerivativesIntent = {
        chain_id: 'near-testnet',
        intent_type: 'derivatives',
        nonce: '1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        account_id: 'user.testnet',
        actions: [{
          instrument: 'option',
          symbol: 'ETH-USD',
          side: 'buy',
          size: '10',
          option: {
            kind: 'call',
            strike: '4000',
            expiry: '2024-12-31T00:00:00Z',
          },
          max_slippage_bps: 50,
          max_funding_bps_8h: 0,
          max_fee_bps: 10,
          venue_allowlist: ['lyra-v2'],
          collateral_token: 'USDC',
          collateral_chain: 'base',
        }],
        settlement: {
          payout_token: 'USDC',
          payout_account: 'user.testnet',
          protocol_fee_bps: 3,
          rebate_bps: 1,
        },
      };

      const errors = validateIntent(optionIntent);
      expect(errors).toHaveLength(0);
    });
  });
});