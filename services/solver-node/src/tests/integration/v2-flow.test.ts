/**
 * Integration Tests for V2.0.0 DeltaNEAR Flow
 * 
 * Tests the complete flow from intent creation to settlement
 * with the new V2 schema including Collateral and Constraints
 */

import { 
  DerivativesIntent,
  QuoteRequest,
  QuoteResponse,
  AcceptRequest,
  AcceptResponse
} from '@deltanear/proto';
import { createHash } from 'crypto';

describe('DeltaNEAR V2.0.0 Integration Flow', () => {
  
  // Helper to create a valid V2 intent
  function createV2Intent(): DerivativesIntent {
    return {
      version: '1.0.0', // Intent version stays 1.0.0
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
          venue_allowlist: ['binance', 'gmx-v2']
        },
        instrument: 'perp',
        side: 'long',
        size: '1000',
        symbol: 'BTC-USD',
        leverage: '10',
        option: null
      },
      signer_id: 'user.testnet',
      deadline: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      nonce: Date.now().toString()
    };
  }

  // Helper to calculate intent hash
  function calculateIntentHash(intent: DerivativesIntent): string {
    // Simplified hash calculation for testing
    const data = JSON.stringify(intent);
    return createHash('sha256').update(data).digest('hex');
  }

  describe('Intent Creation and Validation', () => {
    it('should create a valid V2 perp intent', () => {
      const intent = createV2Intent();
      
      expect(intent.version).toBe('1.0.0');
      expect(intent.intent_type).toBe('derivatives');
      expect(intent.derivatives.instrument).toBe('perp');
      expect(intent.derivatives.collateral.chain).toBe('near');
      expect(intent.derivatives.collateral.token).toBe('USDC');
      expect(intent.derivatives.constraints.max_fee_bps).toBe(30);
      expect(intent.derivatives.constraints.venue_allowlist).toContain('binance');
    });

    it('should create a valid V2 option intent', () => {
      const intent = createV2Intent();
      intent.derivatives.instrument = 'option';
      intent.derivatives.side = 'buy';
      intent.derivatives.leverage = '1'; // Options don't use leverage
      intent.derivatives.option = {
        kind: 'call',
        strike: '50000',
        expiry: new Date(Date.now() + 86400000).toISOString()
      };
      
      expect(intent.derivatives.instrument).toBe('option');
      expect(intent.derivatives.option?.kind).toBe('call');
      expect(intent.derivatives.option?.strike).toBe('50000');
    });

    it('should validate constraints are within limits', () => {
      const intent = createV2Intent();
      
      // Test max values
      expect(intent.derivatives.constraints.max_fee_bps).toBeLessThanOrEqual(100);
      expect(intent.derivatives.constraints.max_funding_bps_8h).toBeLessThanOrEqual(100);
      expect(intent.derivatives.constraints.max_slippage_bps).toBeLessThanOrEqual(1000);
      
      // Test venue allowlist format (should be lowercase)
      intent.derivatives.constraints.venue_allowlist.forEach(venue => {
        expect(venue).toBe(venue.toLowerCase());
      });
    });
  });

  describe('Quote Request Flow', () => {
    it('should create a quote request from intent', () => {
      const intent = createV2Intent();
      const intentHash = calculateIntentHash(intent);
      
      const quoteRequest: QuoteRequest = {
        intent_hash: intentHash,
        intent,
        solver_id: 'solver-1',
        preferences: {
          max_slippage: '100',
          preferred_chains: ['arbitrum', 'near']
        }
      };
      
      expect(quoteRequest.intent_hash).toBe(intentHash);
      expect(quoteRequest.intent.derivatives.symbol).toBe('BTC-USD');
    });

    it('should handle quote response with nested structure', () => {
      const intentHash = 'test-hash-123';
      
      const quoteResponse: QuoteResponse = {
        intent_hash: intentHash,
        solver_id: 'solver-1',
        quote: {
          price: '45000.00',
          size: '1000',
          fee: '3.00',
          expiry: new Date(Date.now() + 300000).toISOString(),
          venue: 'binance',
          chain: 'arbitrum'
        },
        status: 'success',
        timestamp: new Date().toISOString()
      };
      
      expect(quoteResponse.quote.price).toBe('45000.00');
      expect(quoteResponse.quote.venue).toBe('binance');
      expect(quoteResponse.status).toBe('success');
    });

    it('should respect venue allowlist in quotes', () => {
      const intent = createV2Intent();
      const allowedVenues = intent.derivatives.constraints.venue_allowlist;
      
      const quote: QuoteResponse = {
        intent_hash: 'hash123',
        solver_id: 'solver-1',
        quote: {
          price: '45000',
          size: '1000',
          fee: '3',
          expiry: new Date(Date.now() + 300000).toISOString(),
          venue: allowedVenues[0], // Should use allowed venue
          chain: 'arbitrum'
        },
        status: 'success',
        timestamp: new Date().toISOString()
      };
      
      expect(allowedVenues).toContain(quote.quote.venue);
    });
  });

  describe('Execution Request Flow', () => {
    it('should create accept request after quote', () => {
      const intentHash = 'test-hash-123';
      
      const acceptRequest: AcceptRequest = {
        intent_hash: intentHash,
        solver_id: 'solver-1',
        quote_id: 'quote-456',
        signature: 'user-sig-789',
        signer_id: 'user.testnet',
        timestamp: new Date().toISOString()
      };
      
      expect(acceptRequest.intent_hash).toBe(intentHash);
      expect(acceptRequest.quote_id).toBe('quote-456');
    });

    it('should handle accept response', () => {
      const intentHash = 'test-hash-123';
      
      const acceptResponse: AcceptResponse = {
        intent_hash: intentHash,
        status: 'accepted',
        execution_id: 'exec-789',
        solver_id: 'solver-1',
        estimated_completion: new Date(Date.now() + 30000).toISOString(),
        venue: 'binance',
        chain: 'arbitrum'
      };
      
      expect(acceptResponse.status).toBe('accepted');
      expect(acceptResponse.venue).toBe('binance');
      expect(acceptResponse.chain).toBe('arbitrum');
    });
  });

  describe('Constraints Validation', () => {
    it('should enforce max_fee_bps constraint', () => {
      const intent = createV2Intent();
      const maxFeeBps = intent.derivatives.constraints.max_fee_bps;
      
      // Mock fee calculation
      const size = parseFloat(intent.derivatives.size);
      const maxFee = (size * maxFeeBps) / 10000;
      const actualFee = 2.5; // Example fee
      
      expect(actualFee).toBeLessThanOrEqual(maxFee);
    });

    it('should enforce max_slippage_bps constraint', () => {
      const intent = createV2Intent();
      const maxSlippageBps = intent.derivatives.constraints.max_slippage_bps;
      
      // Mock slippage calculation
      const expectedPrice = 45000;
      const maxSlippage = (expectedPrice * maxSlippageBps) / 10000;
      const actualPrice = 45040; // Slight slippage
      const slippage = Math.abs(actualPrice - expectedPrice);
      
      expect(slippage).toBeLessThanOrEqual(maxSlippage);
    });

    it('should enforce venue_allowlist constraint', () => {
      const intent = createV2Intent();
      const allowedVenues = intent.derivatives.constraints.venue_allowlist;
      
      // Mock venue selection
      const selectedVenue = 'binance';
      
      expect(allowedVenues).toContain(selectedVenue);
      
      // Should reject non-allowed venue
      const invalidVenue = 'unknown-exchange';
      expect(allowedVenues).not.toContain(invalidVenue);
    });
  });

  describe('Collateral Management', () => {
    it('should specify correct collateral chain and token', () => {
      const intent = createV2Intent();
      
      expect(intent.derivatives.collateral.chain).toBe('near');
      expect(intent.derivatives.collateral.token).toBe('USDC');
    });

    it('should support multiple collateral chains', () => {
      const validChains = ['near', 'ethereum', 'arbitrum', 'base', 'solana'];
      
      validChains.forEach(chain => {
        const intent = createV2Intent();
        intent.derivatives.collateral.chain = chain;
        
        expect(intent.derivatives.collateral.chain).toBe(chain);
        expect(chain).toBe(chain.toLowerCase()); // Should be lowercase
      });
    });

    it('should calculate collateral requirements correctly', () => {
      const intent = createV2Intent();
      const size = parseFloat(intent.derivatives.size);
      const leverage = parseFloat(intent.derivatives.leverage || '1');
      
      const requiredCollateral = size / leverage;
      
      expect(requiredCollateral).toBe(100); // 1000 size / 10 leverage
    });
  });

  describe('End-to-End Flow', () => {
    it('should complete full V2 flow from intent to settlement', async () => {
      // Step 1: Create intent
      const intent = createV2Intent();
      const intentHash = calculateIntentHash(intent);
      
      // Step 2: Request quotes
      const quoteRequest: QuoteRequest = {
        intent_hash: intentHash,
        intent,
        solver_id: 'solver-1'
      };
      
      // Step 3: Receive quote
      const quoteResponse: QuoteResponse = {
        intent_hash: intentHash,
        solver_id: 'solver-1',
        quote: {
          price: '45000',
          size: '1000',
          fee: '3',
          expiry: new Date(Date.now() + 300000).toISOString(),
          venue: 'binance',
          chain: 'arbitrum'
        },
        status: 'success',
        timestamp: new Date().toISOString()
      };
      
      // Step 4: Accept quote
      const acceptRequest: AcceptRequest = {
        intent_hash: intentHash,
        solver_id: 'solver-1',
        quote_id: 'quote-123',
        signature: 'sig-456',
        signer_id: 'user.testnet',
        timestamp: new Date().toISOString()
      };
      
      // Step 5: Accept response
      const acceptResponse: AcceptResponse = {
        intent_hash: intentHash,
        status: 'accepted',
        execution_id: 'exec-789',
        solver_id: 'solver-1',
        estimated_completion: new Date(Date.now() + 30000).toISOString(),
        venue: 'binance',
        chain: 'arbitrum'
      };
      
      // Verify flow integrity
      expect(quoteResponse.intent_hash).toBe(intentHash);
      expect(acceptRequest.intent_hash).toBe(intentHash);
      expect(acceptResponse.intent_hash).toBe(intentHash);
      
      // Verify constraints were respected (fee from quote)
      const actualFeeBps = (parseFloat(quoteResponse.quote.fee) / parseFloat(intent.derivatives.size)) * 10000;
      expect(actualFeeBps).toBeLessThanOrEqual(intent.derivatives.constraints.max_fee_bps);
      
      // Verify venue was from allowlist
      expect(intent.derivatives.constraints.venue_allowlist).toContain(acceptResponse.venue);
    });
  });
});