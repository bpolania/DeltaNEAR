import { JsonRpcProvider } from '@near-js/providers';
import {
  DerivativesIntent,
  Collateral,
  createMinimalPerpIntent,
  validateIntent,
} from '@deltanear/proto';

describe('Gateway-Solver Integration (V2 Schema)', () => {
  const CONTRACT_NAME = 'deltanear-v2-1756106334.testnet';
  const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });

  describe('V2 Schema Validation', () => {
    it('should validate V2 perp intent structure', async () => {
      const collateral: Collateral = {
        token: 'USDC',
        chain: 'arbitrum'
      };
      
      const intent = createMinimalPerpIntent(
        'ETH-USD',
        'long',
        '1',
        collateral,
        'user.testnet',
        '2024-12-31T23:59:59Z',
        Date.now().toString()
      );
      
      // Add constraints with venue preference
      intent.derivatives.constraints.venue_allowlist = ['gmx-v2'];
      intent.derivatives.leverage = '5';

      // Validate locally
      const errors = validateIntent(intent);
      expect(errors).toHaveLength(0);

      // Validate structure
      expect(intent.derivatives.collateral).toBeDefined();
      expect(intent.derivatives.constraints).toBeDefined();
      expect(intent.derivatives.option).toBeNull(); // For perp
      expect(intent.derivatives.instrument).toBe('perp');
      expect(intent.derivatives.collateral.chain).toBe('arbitrum');
      expect(intent.derivatives.constraints.venue_allowlist).toContain('gmx-v2');
    });

    it('should validate V2 option intent structure', async () => {
      const collateral: Collateral = {
        token: 'USDC',
        chain: 'near'
      };
      
      const intent: DerivativesIntent = {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          collateral,
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
        signer_id: 'user.testnet',
        deadline: '2024-12-30T23:59:59Z',
        nonce: Date.now().toString()
      };

      // Validate locally
      const errors = validateIntent(intent);
      expect(errors).toHaveLength(0);

      // Verify option structure
      expect(intent.derivatives.instrument).toBe('option');
      expect(intent.derivatives.option).toBeDefined();
      expect(intent.derivatives.option?.kind).toBe('call');
      expect(intent.derivatives.option?.strike).toBe('50000');
      expect(intent.derivatives.collateral.chain).toBe('near');
    });

    it('should validate intent with deployed contract', async () => {
      const collateral: Collateral = {
        token: 'USDC',
        chain: 'arbitrum'
      };
      
      const intent = createMinimalPerpIntent(
        'SOL-USD',
        'short',
        '10',
        collateral,
        'trader.testnet',
        '2024-12-31T23:59:59Z',
        Date.now().toString()
      );

      // Contract validation
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
  });
});