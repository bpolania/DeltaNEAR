import { JsonRpcProvider } from '@near-js/providers';
import {
  DerivativesIntent,
  Collateral,
  createMinimalPerpIntent,
  computeIntentHash,
  validateIntent
} from '@deltanear/proto';

describe('DeltaNEAR V2 End-to-End - Testnet Integration', () => {
  const CONTRACT_NAME = 'deltanear-v2-1756106334.testnet';
  const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });

  beforeAll(async () => {
    // Verify contract is accessible
    const account = await provider.query({
      request_type: 'view_account',
      account_id: CONTRACT_NAME,
      finality: 'final'
    }) as any;
    expect(account).toBeDefined();
  });

  describe('V2 Schema Compliance', () => {
    it('should validate intent structure matches conformance test corpus', async () => {
      // This intent structure matches the V2 schema from conformance tests
      const intent: DerivativesIntent = {
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
          option: null, // Explicitly null for perp
          side: 'long',
          size: '1.5',
          symbol: 'ETH-USD'
        },
        signer_id: 'alice.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'conformance-test-001'
      };

      // Validate locally first
      const localErrors = validateIntent(intent);
      expect(localErrors).toHaveLength(0);

      // Validate on contract
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent })),
        finality: 'final'
      }) as any;
      
      const validation = JSON.parse(Buffer.from(result.result).toString());
      expect(validation).toContain('V2 Intent validated: perp long ETH-USD on arbitrum');
    });

    it('should handle option intents correctly', async () => {
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
        signer_id: 'options-trader.testnet',
        deadline: '2024-12-30T23:59:59Z',
        nonce: 'option-conformance-001'
      };

      // Validate locally
      const localErrors = validateIntent(optionIntent);
      expect(localErrors).toHaveLength(0);

      // Validate on contract
      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent: optionIntent })),
        finality: 'final'
      }) as any;
      
      const validation = JSON.parse(Buffer.from(result.result).toString());
      expect(validation).toContain('V2 Intent validated: option buy BTC-USD on near');
    });
  });

  describe('Intent Lifecycle Simulation', () => {
    const testNonce = `e2e-test-${Date.now()}`;
    
    it('should simulate complete intent lifecycle', async () => {
      // Step 1: Create V2 intent
      const collateral: Collateral = { token: 'USDC', chain: 'arbitrum' };
      const intent = createMinimalPerpIntent(
        'ETH-USD',
        'long',
        '2.0',
        collateral,
        'lifecycle.testnet',
        '2024-12-31T23:59:59Z',
        testNonce
      );

      // Add specific constraints for this test
      intent.derivatives.constraints.venue_allowlist = ['gmx-v2'];
      intent.derivatives.leverage = '10';

      // Step 2: Validate intent structure
      const localErrors = validateIntent(intent);
      expect(localErrors).toHaveLength(0);

      // Step 3: Compute intent hash (what solvers would do)
      const intentHash = computeIntentHash(intent);
      expect(intentHash).toHaveLength(64);

      // Step 4: Validate with deployed contract (what gateway would do)
      const contractValidation = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent })),
        finality: 'final'
      }) as any;
      
      const validation = JSON.parse(Buffer.from(contractValidation.result).toString());
      expect(validation).toContain('V2 Intent validated');
      expect(validation).toContain('perp long ETH-USD on arbitrum');

      // Step 5: Check if metadata can be queried (even if not stored)
      const metadataResult = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'get_intent_metadata',
        args_base64: btoa(JSON.stringify({ intent_hash: intentHash })),
        finality: 'final'
      }) as any;
      
      const metadata = JSON.parse(Buffer.from(metadataResult.result).toString());
      expect(metadata).toBeNull(); // Should be null since we haven't stored it

      // Step 6: Check execution log (even if not stored)
      const logResult = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'get_execution_log',
        args_base64: btoa(JSON.stringify({ intent_hash: intentHash })),
        finality: 'final'
      }) as any;
      
      const executionLog = JSON.parse(Buffer.from(logResult.result).toString());
      expect(executionLog).toBeNull(); // Should be null since we haven't stored it
    });
  });

  describe('Multi-Chain Collateral Validation', () => {
    const chains = ['arbitrum', 'near']; // Reduced to avoid rate limits
    const tokens = ['USDC', 'USDT']; // Reduced to avoid rate limits

    chains.forEach(chain => {
      tokens.forEach(token => {
        it(`should validate ${token} on ${chain}`, async () => {
          const intent: DerivativesIntent = {
            version: '1.0.0',
            intent_type: 'derivatives',
            derivatives: {
              collateral: { token, chain },
              constraints: {
                max_fee_bps: 25,
                max_funding_bps_8h: 40,
                max_slippage_bps: 75,
                venue_allowlist: ['gmx-v2', 'lyra-v2']
              },
              instrument: 'perp',
              leverage: '3',
              option: null,
              side: 'short',
              size: '0.5',
              symbol: 'BTC-USD'
            },
            signer_id: 'multi-chain.testnet',
            deadline: '2024-12-31T23:59:59Z',
            nonce: `multi-${chain}-${token}-${Date.now()}`
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
          expect(validation).toContain(`on ${chain}`);
        });
      });
    });
  });

  describe('Constraints Validation', () => {
    it('should validate different constraint values', async () => {
      const constraintTests = [
        { max_fee_bps: 10, max_funding_bps_8h: 20, max_slippage_bps: 50 },
        { max_fee_bps: 30, max_funding_bps_8h: 50, max_slippage_bps: 100 },
        { max_fee_bps: 50, max_funding_bps_8h: 80, max_slippage_bps: 200 }
      ];

      for (const [index, constraints] of constraintTests.entries()) {
        const intent: DerivativesIntent = {
          version: '1.0.0',
          intent_type: 'derivatives',
          derivatives: {
            collateral: { token: 'USDC', chain: 'arbitrum' },
            constraints: {
              ...constraints,
              venue_allowlist: ['gmx-v2']
            },
            instrument: 'perp',
            leverage: '2',
            option: null,
            side: 'long',
            size: '1.0',
            symbol: 'ETH-USD'
          },
          signer_id: 'constraints.testnet',
          deadline: '2024-12-31T23:59:59Z',
          nonce: `constraints-${index}-${Date.now()}`
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
      }
    });
  });

  describe('Error Cases', () => {
    it('should handle malformed intent gracefully', async () => {
      const malformedIntent = {
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
          leverage: '5',
          side: 'long',
          size: '1.0',
          symbol: 'ETH-USD'
        },
        signer_id: 'error-test.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'malformed-test'
      };

      await expect(
        provider.query({
          request_type: 'call_function',
          account_id: CONTRACT_NAME,
          method_name: 'validate_v2_intent',
          args_base64: btoa(JSON.stringify({ intent: malformedIntent })),
          finality: 'final'
        })
      ).rejects.toThrow();
    });

    it('should reject invalid intent_type', async () => {
      const invalidIntent = {
        version: '1.0.0',
        intent_type: 'invalid_type',
        derivatives: {
          collateral: { token: 'USDC', chain: 'arbitrum' },
          constraints: {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: []
          },
          instrument: 'perp',
          leverage: '5',
          side: 'long',
          size: '1.0',
          symbol: 'ETH-USD'
        },
        signer_id: 'error-test.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'invalid-type-test'
      };

      await expect(
        provider.query({
          request_type: 'call_function',
          account_id: CONTRACT_NAME,
          method_name: 'validate_v2_intent',
          args_base64: btoa(JSON.stringify({ intent: invalidIntent })),
          finality: 'final'
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle single validation call efficiently', async () => {
      const startTime = Date.now();
      
      const collateral: Collateral = { token: 'USDC', chain: 'arbitrum' };
      const intent = createMinimalPerpIntent(
        'ETH-USD',
        'long',
        '1.0',
        collateral,
        'perf.testnet',
        '2024-12-31T23:59:59Z',
        `perf-test-${Date.now()}`
      );

      const result = await provider.query({
        request_type: 'call_function',
        account_id: CONTRACT_NAME,
        method_name: 'validate_v2_intent',
        args_base64: btoa(JSON.stringify({ intent })),
        finality: 'final'
      }) as any;

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should succeed
      const validation = JSON.parse(Buffer.from(result.result).toString());
      expect(validation).toContain('V2 Intent validated');

      // Should complete within reasonable time (5 seconds for 1 call)
      expect(duration).toBeLessThan(5000);
      
      console.log(`Performance test: 1 validation completed in ${duration}ms`);
    });
  });
});