import { JsonRpcProvider } from '@near-js/providers';
import {
  DerivativesIntent,
  Collateral,
  createMinimalPerpIntent,
  createMinimalOptionIntent,
  computeIntentHash,
  validateIntent
} from '@deltanear/proto';

describe('DeltaNEAR V2 Contract - Testnet Integration', () => {
  const CONTRACT_NAME = 'deltanear-v2-1756106334.testnet';
  const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });

  beforeAll(async () => {
    // Verify contract is deployed and accessible
    const account = await provider.query({
      request_type: 'view_account',
      account_id: CONTRACT_NAME,
      finality: 'final'
    }) as any;
    expect(account).toBeDefined();
    expect(parseInt(account.amount)).toBeGreaterThan(0);
  });

  describe('Contract Information', () => {
    it('should return V2 schema version', async () => {
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'get_schema_version',
        args_base64: btoa('{}'),
        finality: 'final'
      }) as any;
      
      const schemaVersion = JSON.parse(Buffer.from(result.result).toString());
      expect(schemaVersion).toBe('2.0.0');
    });

    it('should return contract version', async () => {
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'get_contract_version',
        args_base64: btoa('{}'),
        finality: 'final'
      }) as any;
      
      const contractVersion = JSON.parse(Buffer.from(result.result).toString());
      expect(contractVersion).toBe('1.0.0');
    });

    it('should have authorized solvers configured', async () => {
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'get_authorized_solvers',
        args_base64: btoa('{}'),
        finality: 'final'
      }) as any;
      
      const solvers = JSON.parse(Buffer.from(result.result).toString());
      expect(Array.isArray(solvers)).toBe(true);
      expect(solvers.length).toBeGreaterThanOrEqual(1);
      expect(solvers).toContain('deltanear-v2-1756106334.testnet');
    });
  });

  describe('V2 Intent Validation', () => {
    it('should validate valid V2 perp intent', async () => {
      const validIntent: DerivativesIntent = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: {
            token: 'USDC',
            chain: 'arbitrum'
          },
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: ['gmx-v2']
          },
          instrument: 'perp',
          leverage: '5',
          option: null,
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'alice.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-perp-001'
      };

      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent: validIntent })),
        finality: 'final'
      }) as any;
      
      const validation = JSON.parse(Buffer.from(result.result).toString());
      expect(validation).toContain('V2 Intent validated');
      expect(validation).toContain('perp long ETH-USD on arbitrum');
    });

    it('should validate valid V2 option intent', async () => {
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
            venue_allowlist: ['lyra-v2']
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
        signer_id: 'bob.testnet',
        deadline: '2024-12-30T23:59:59Z',
        nonce: 'test-option-001'
      };

      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent: validIntent })),
        finality: 'final'
      }) as any;
      
      const validation = JSON.parse(Buffer.from(result.result).toString());
      expect(validation).toContain('V2 Intent validated');
      expect(validation).toContain('option buy BTC-USD on near');
    });

    it('should reject intent with invalid version', async () => {
      const invalidIntent = {
        version: '2.0.0', // Invalid version
        intent_type: 'derivatives',
        derivatives: {
          collateral: { token: 'USDC', chain: 'arbitrum' },
          constraints: { max_fee_bps: 30, max_funding_bps_8h: 50, max_slippage_bps: 100, venue_allowlist: [] },
          instrument: 'perp',
          leverage: '5',
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'alice.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-invalid-001'
      };

      await expect(
        provider.query({
          request_type: 'call_function',
          account_id: CONTRACT_NAME,
          method_name: 'validate_v2_intent',
          args_base64: btoa(JSON.stringify({ intent: invalidIntent })),
          finality: 'final'
        })
      ).rejects.toThrow(); // Should throw due to invalid version
    });

    it('should reject intent with empty collateral fields', async () => {
      const invalidIntent = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral: { token: '', chain: '' }, // Empty required fields
          constraints: { max_fee_bps: 30, max_funding_bps_8h: 50, max_slippage_bps: 100, venue_allowlist: [] },
          instrument: 'perp',
          leverage: '5',
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'alice.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-empty-001'
      };

      await expect(
        provider.query({
          request_type: 'call_function',
          account_id: CONTRACT_NAME,
          method_name: 'validate_v2_intent',
          args_base64: btoa(JSON.stringify({ intent: invalidIntent })),
          finality: 'final'
        })
      ).rejects.toThrow(); // Should throw due to empty collateral
    });
  });

  describe('Proto Package Compatibility', () => {
    it('should validate intent created by createMinimalPerpIntent', async () => {
      const collateral: Collateral = { token: 'USDC', chain: 'arbitrum' };
      const intent = createMinimalPerpIntent(
        'SOL-USD',
        'short',
        '10',
        collateral,
        'trader.testnet',
        '2024-12-31T23:59:59Z',
        'proto-perp-test'
      );

      // Local validation should pass
      const errors = validateIntent(intent);
      expect(errors).toHaveLength(0);

      // Contract validation should pass
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent })),
        finality: 'final'
      }) as any;
      
      const validation = JSON.parse(Buffer.from(result.result).toString());
      expect(validation).toContain('V2 Intent validated');
      expect(validation).toContain('perp short SOL-USD on arbitrum');
    });

    it('should validate intent created by createMinimalOptionIntent', async () => {
      const collateral: Collateral = { token: 'USDC', chain: 'near' };
      const option = {
        kind: 'put' as const,
        strike: '30000',
        expiry: '2024-12-31T00:00:00Z'
      };
      
      const intent = createMinimalOptionIntent(
        'ETH-USD',
        'sell',
        '2.5',
        option,
        collateral,
        'options.testnet',
        '2024-12-30T23:59:59Z',
        'proto-option-test'
      );

      // Local validation should pass
      const errors = validateIntent(intent);
      expect(errors).toHaveLength(0);

      // Contract validation should pass
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent })),
        finality: 'final'
      }) as any;
      
      const validation = JSON.parse(Buffer.from(result.result).toString());
      expect(validation).toContain('V2 Intent validated');
      expect(validation).toContain('option sell ETH-USD on near');
    });

    it('should compute intent hash consistently', async () => {
      const collateral: Collateral = { token: 'USDC', chain: 'arbitrum' };
      const intent = createMinimalPerpIntent(
        'BTC-USD',
        'long',
        '1.0',
        collateral,
        'hash.testnet',
        '2024-12-31T23:59:59Z',
        'hash-test-001'
      );

      const hash1 = computeIntentHash(intent);
      const hash2 = computeIntentHash(intent);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string length
      expect(typeof hash1).toBe('string');
    });
  });

  describe('Metadata and Execution Logging', () => {
    const testIntentHash = 'integration-test-' + Date.now();

    it('should store and retrieve intent metadata', async () => {
      const metadata = {
        intent_hash: testIntentHash,
        solver_id: 'solver1.testnet',
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '2.0',
        timestamp: Date.now()
      };

      // Note: This would normally be called by an authorized account
      // For testing, we're just checking the view method works
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'get_intent_metadata',
        args_base64: btoa(JSON.stringify({ intent_hash: testIntentHash })),
        finality: 'final'
      }) as any;
      
      const retrieved = JSON.parse(Buffer.from(result.result).toString());
      // Should return null for non-existent metadata
      expect(retrieved).toBeNull();
    });

    it('should retrieve execution logs', async () => {
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'get_execution_log',
        args_base64: btoa(JSON.stringify({ intent_hash: testIntentHash })),
        finality: 'final'
      }) as any;
      
      const retrieved = JSON.parse(Buffer.from(result.result).toString());
      // Should return null for non-existent log
      expect(retrieved).toBeNull();
    });
  });

  describe('Cross-Chain Collateral Support', () => {
    const testCases = [
      { token: 'USDC', chain: 'arbitrum', expected: 'arbitrum' },
      { token: 'USDC', chain: 'near', expected: 'near' }
    ]; // Reduced to avoid rate limits

    testCases.forEach(({ token, chain, expected }) => {
      it(`should validate ${token} collateral on ${chain}`, async () => {
        const intent: DerivativesIntent = {
          version: '1.0.0',
          intent_type: 'derivatives',
          derivatives: {
            collateral: { token, chain },
            constraints: {
              max_fee_bps: 30,
              max_funding_bps_8h: 50,
              max_slippage_bps: 100,
              venue_allowlist: ['gmx-v2']
            },
            instrument: 'perp',
            leverage: '3',
            option: null,
            side: 'long',
            size: '1.0',
            symbol: 'ETH-USD'
          },
          signer_id: 'multi-chain.testnet',
          deadline: '2024-12-31T23:59:59Z',
          nonce: `cross-chain-${chain}-${Date.now()}`
        };

        const result = await provider.query({
          request_type: 'call_function',
          account_id: CONTRACT_NAME,
          method_name: 'validate_v2_intent',
          args_base64: btoa(JSON.stringify({ intent })),
          finality: 'final'
        }) as any;
        
        const validation = JSON.parse(Buffer.from(result.result).toString());
        expect(validation).toContain('V2 Intent validated');
        expect(validation).toContain(`on ${expected}`);
      });
    });
  });

  describe('Venue Allowlist Support', () => {
    const venueTestCases = [
      { venues: ['gmx-v2'], expected: 'gmx-v2' },
      { venues: [], expected: 'any venue' }
    ]; // Reduced to avoid rate limits

    venueTestCases.forEach(({ venues, expected }, index) => {
      it(`should validate intent with venue allowlist: ${expected}`, async () => {
        const intent: DerivativesIntent = {
          version: '1.0.0',
          intent_type: 'derivatives',
          derivatives: {
            collateral: { token: 'USDC', chain: 'arbitrum' },
            constraints: {
              max_fee_bps: 30,
              max_funding_bps_8h: 50,
              max_slippage_bps: 100,
              venue_allowlist: venues
            },
            instrument: 'perp',
            leverage: '2',
            option: null,
            side: 'short',
            size: '5.0',
            symbol: 'BTC-USD'
          },
          signer_id: 'venue-test.testnet',
          deadline: '2024-12-31T23:59:59Z',
          nonce: `venue-test-${index}-${Date.now()}`
        };

        const result = await provider.query({
          request_type: 'call_function',
          account_id: CONTRACT_NAME,
          method_name: 'validate_v2_intent',
          args_base64: btoa(JSON.stringify({ intent })),
          finality: 'final'
        }) as any;
        
        const validation = JSON.parse(Buffer.from(result.result).toString());
        expect(validation).toContain('V2 Intent validated');
        expect(validation).toContain('perp short BTC-USD');
      });
    });
  });
});