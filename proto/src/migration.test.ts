import { migrateV1ToV2, CHAIN_MAPPING, DEFAULT_CONSTRAINTS } from './migration';

describe('V1 to V2 Migration', () => {
  describe('Chain ID Mapping', () => {
    it('should map testnet chain IDs correctly', () => {
      expect(CHAIN_MAPPING['near-testnet']).toBe('near');
      expect(CHAIN_MAPPING['arbitrum-testnet']).toBe('arbitrum');
      expect(CHAIN_MAPPING['ethereum-testnet']).toBe('ethereum');
      expect(CHAIN_MAPPING['base-testnet']).toBe('base');
      expect(CHAIN_MAPPING['solana-testnet']).toBe('solana');
    });

    it('should map mainnet chain IDs correctly', () => {
      expect(CHAIN_MAPPING['near-mainnet']).toBe('near');
      expect(CHAIN_MAPPING['arbitrum-mainnet']).toBe('arbitrum');
      expect(CHAIN_MAPPING['ethereum-mainnet']).toBe('ethereum');
      expect(CHAIN_MAPPING['base-mainnet']).toBe('base');
      expect(CHAIN_MAPPING['solana-mainnet']).toBe('solana');
    });
  });

  describe('Default Constraints', () => {
    it('should provide correct default constraints', () => {
      expect(DEFAULT_CONSTRAINTS).toEqual({
        max_fee_bps: 30,
        max_funding_bps_8h: 50,
        max_slippage_bps: 100,
        venue_allowlist: []
      });
    });
  });

  describe('Migration Function', () => {
    const v1Intent = {
      version: '1.0.0',
      intent_type: 'derivatives',
      derivatives: {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '2.5',
        leverage: '5'
      },
      chain_id: 'arbitrum-mainnet',
      signer_id: 'trader.near',
      deadline: '2024-12-31T23:59:59Z',
      nonce: 'legacy-test-001'
    };

    it('should successfully migrate V1 intent to V2', () => {
      const v2Intent = migrateV1ToV2(v1Intent, { token: 'USDC' });

      expect(v2Intent.version).toBe('1.0.0');
      expect(v2Intent.intent_type).toBe('derivatives');
      expect(v2Intent.derivatives.collateral).toEqual({
        chain: 'arbitrum',
        token: 'USDC'
      });
      expect(v2Intent.derivatives.constraints).toEqual(DEFAULT_CONSTRAINTS);
      expect(v2Intent.signer_id).toBe('trader.near');
      expect(v2Intent.deadline).toBe('2024-12-31T23:59:59Z');
      expect(v2Intent.nonce).toBe('legacy-test-001');
      
      // Should not have chain_id in V2
      expect('chain_id' in v2Intent).toBe(false);
    });

    it('should preserve original derivatives fields', () => {
      const v2Intent = migrateV1ToV2(v1Intent, { token: 'USDT' });

      expect(v2Intent.derivatives.instrument).toBe('perp');
      expect(v2Intent.derivatives.symbol).toBe('ETH-USD');
      expect(v2Intent.derivatives.side).toBe('long');
      expect(v2Intent.derivatives.size).toBe('2.5');
      expect(v2Intent.derivatives.leverage).toBe('5');
    });

    it('should allow custom constraints', () => {
      const customConstraints = {
        max_fee_bps: 20,
        max_funding_bps_8h: 40,
        max_slippage_bps: 75,
        venue_allowlist: ['gmx-v2']
      };

      const v2Intent = migrateV1ToV2(v1Intent, { 
        token: 'DAI',
        constraints: customConstraints
      });

      expect(v2Intent.derivatives.constraints).toEqual(customConstraints);
      expect(v2Intent.derivatives.collateral.token).toBe('DAI');
    });

    it('should throw error for missing chain_id', () => {
      const invalidIntent = { ...v1Intent, chain_id: '' };

      expect(() => migrateV1ToV2(invalidIntent, { token: 'USDC' })).toThrow('Missing chain_id in V1.0.0 intent');
    });

    it('should throw error for missing derivatives', () => {
      const invalidIntent = { ...v1Intent, derivatives: undefined };

      expect(() => migrateV1ToV2(invalidIntent as any, { token: 'USDC' })).toThrow('Missing derivatives in V1.0.0 intent');
    });

    it('should throw error for unsupported chain_id', () => {
      const invalidIntent = { ...v1Intent, chain_id: 'unsupported-chain' };

      expect(() => migrateV1ToV2(invalidIntent, { token: 'USDC' })).toThrow('Unsupported chain_id: unsupported-chain');
    });

    it('should throw error for missing token', () => {
      expect(() => migrateV1ToV2(v1Intent, {} as any)).toThrow('Token must be specified explicitly for V2.0.0');
    });
  });
});