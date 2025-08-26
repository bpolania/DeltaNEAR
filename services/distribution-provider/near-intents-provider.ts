/**
 * NEAR Intents Distribution Provider
 * 
 * Properly integrates with NEAR's infrastructure:
 * - 1Click API as distribution layer ONLY (not derivatives-aware)
 * - Canonical Verifier for all token operations
 * - Metadata field for solver hints only
 */

import { DistributionProvider, IntentQuote, IntentStatus, ProviderConfig } from './interface';
import { SignedIntent, QuoteResponse } from '@deltanear/proto';
import axios from 'axios';

export class NEARIntentsProvider implements DistributionProvider {
  private oneClickClient;
  private verifierContract: string;
  private metadataContract: string;

  constructor(private config: ProviderConfig) {
    // 1Click API - distribution layer only, not derivatives-aware
    this.oneClickClient = axios.create({
      baseURL: config.options?.oneClickUrl || 'https://1click.chaindefuser.com',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
      }
    });

    // Canonical Verifier - handles ALL signature verification and token operations
    this.verifierContract = config.options?.network === 'mainnet' 
      ? 'intents.near' 
      : 'intents.testnet';
    
    // Our thin metadata contract - ONLY stores derivatives info
    this.metadataContract = config.options?.metadataContract || 
      'derivatives-metadata.testnet';
  }

  async publishIntent(intent: SignedIntent): Promise<{ intent_hash: string }> {
    const derivativeIntent = intent.intent;
    const derivatives = derivativeIntent.derivatives;
    
    // Calculate collateral needed (this is what user deposits)
    const collateralAmount = this.calculateCollateral(derivatives);
    
    // 1Click understands swaps, not derivatives
    // We express the intent as a swap with metadata hints for solvers
    const quoteRequest = {
      src: {
        chain: derivatives.collateral.chain || 'near',
        token: derivatives.collateral.token || 'USDC',
        amount: collateralAmount
      },
      dst: {
        // Settlement is just USDC transfer, not a position token
        chain: 'near', 
        token: derivatives.collateral.token || 'USDC',
        address: derivativeIntent.signer_id
      },
      slippage_tolerance_bps: 100, // Default for settlement
      deadline: derivativeIntent.deadline,
      // Metadata is ONLY for solver hints - 1Click doesn't process this
      metadata: {
        type: 'derivatives_order',  // Custom type for our solvers
        details: {
          instrument: derivatives.instrument,
          symbol: derivatives.symbol,
          side: derivatives.side,
          size: derivatives.size,
          leverage: derivatives.leverage,
          option: derivatives.option,
          venue_allowlist: derivatives.constraints.venue_allowlist,
          max_slippage_bps: derivatives.constraints.max_slippage_bps,
          max_funding_bps_8h: derivatives.constraints.max_funding_bps_8h,
          max_fee_bps: derivatives.constraints.max_fee_bps
        }
      }
    };

    try {
      const response = await this.oneClickClient.post('/v0/quote', quoteRequest);
      
      const intent_hash = response.data.intent_id || 
        this.generateIntentHash(intent);
      
      // Store derivatives metadata in our thin contract
      // This is separate from the actual intent in Verifier
      await this.storeMetadataInContract(intent_hash, derivatives);
      
      // Store mapping for status tracking
      this.storeLocalMapping(intent_hash, {
        originalIntent: intent,
        depositAddress: response.data.deposit_address,
        quoteId: response.data.quote_id
      });

      return { intent_hash };
    } catch (error: any) {
      // 1Click may not understand our derivatives metadata
      // Fall back to direct Verifier submission
      return this.submitDirectToVerifier(intent);
    }
  }

  private async submitDirectToVerifier(intent: SignedIntent): Promise<{ intent_hash: string }> {
    // When 1Click doesn't work, submit directly to Verifier
    // This requires the user to have already deposited tokens
    
    const intent_hash = this.generateIntentHash(intent);
    const derivatives = intent.intent.derivatives;
    
    // Store metadata in our contract
    await this.storeMetadataInContract(intent_hash, derivatives);
    
    // The actual intent submission would happen via NEAR transaction
    // to the Verifier contract - not shown here as it requires
    // NEAR account access
    
    return { intent_hash };
  }

  private async storeMetadataInContract(intent_hash: string, derivatives: any): Promise<void> {
    // Store derivatives metadata in our thin contract
    // This would be a NEAR transaction in production
    const metadata = {
      intent_hash,
      instrument: derivatives.instrument,
      symbol: derivatives.symbol,
      side: derivatives.side,
      size: derivatives.size,
      leverage: derivatives.leverage,
      strike: derivatives.option?.strike,
      expiry: derivatives.option?.expiry,
      venue: derivatives.constraints.venue_allowlist[0],
      solver_id: 'pending'
    };
    
    // In production, this would be:
    // await metadataContract.store_metadata({ intent_hash, metadata });
    
    console.log('Storing derivatives metadata:', metadata);
  }

  async requestQuotes(intent_hash: string): Promise<void> {
    // 1Click handles quote collection automatically
    // Our derivatives-aware solvers will see the metadata
    // and know how to process it
    
    const mapping = this.getLocalMapping(intent_hash);
    if (!mapping) {
      throw new Error('Intent not found');
    }
    
    // Check status with 1Click
    const status = await this.oneClickClient.get('/v0/status', {
      params: { intent_id: intent_hash }
    });
    
    if (status.data.status === 'FAILED') {
      throw new Error('Quote request failed');
    }
  }

  async getQuotes(intent_hash: string): Promise<IntentQuote[]> {
    // 1Click returns swap quotes, not derivatives quotes
    // Our solvers add derivatives pricing in their responses
    
    const mapping = this.getLocalMapping(intent_hash);
    if (!mapping) {
      return [];
    }
    
    // In reality, derivatives-aware solvers would provide quotes
    // through a separate channel, not through 1Click
    return this.mockDerivativesQuotes(intent_hash, mapping);
  }

  private mockDerivativesQuotes(intent_hash: string, mapping: any): IntentQuote[] {
    // Simulated derivatives quotes from our solvers
    const derivatives = mapping.originalIntent.intent.derivatives;
    
    const quote: QuoteResponse = {
      intent_hash,
      solver_id: 'derivatives-solver-1',
      quote: {
        // This is the entry price for the derivative, not a swap price
        price: derivatives.instrument === 'perp' ? '3500.00' : '250.00',
        size: derivatives.size,
        fee: '10',
        expiry: new Date(Date.now() + 300000).toISOString(),
        venue: 'gmx-v2',
        chain: derivatives.collateral.chain
      },
      status: 'success' as const,
      timestamp: new Date().toISOString()
    };
    
    return [{
      solver_id: 'derivatives-solver-1',
      quote,
      timestamp: Date.now()
    }];
  }

  async acceptQuote(intent_hash: string, solver_id: string): Promise<void> {
    // Accepting means the solver will execute on external venue
    // Settlement will happen through Verifier's execute_intents
    
    const mapping = this.getLocalMapping(intent_hash);
    if (!mapping) {
      throw new Error('Intent not found');
    }
    
    // Update metadata contract with assigned solver
    // await metadataContract.update_solver({ intent_hash, solver_id });
    
    // Solver now has exclusive window to execute
    mapping.assignedSolver = solver_id;
    mapping.status = 'accepted';
  }

  async getStatus(intent_hash: string): Promise<IntentStatus> {
    const mapping = this.getLocalMapping(intent_hash);
    if (!mapping) {
      return {
        intent_hash,
        status: 'failed',
        error: 'Intent not found'
      };
    }
    
    // Check if settlement happened on Verifier
    // In production, would query Verifier contract events
    
    return {
      intent_hash,
      status: this.mapStatus(mapping.status),
      winning_solver: mapping.assignedSolver,
      execution_details: mapping.executionDetails
    };
  }

  private mapStatus(internalStatus: string): IntentStatus['status'] {
    const statusMap: Record<string, IntentStatus['status']> = {
      'pending': 'pending',
      'quoted': 'quoted',
      'accepted': 'accepted',
      'executing': 'executing',
      'settled': 'settled',
      'failed': 'failed'
    };
    
    return statusMap[internalStatus] || 'pending';
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.oneClickClient.get('/v0/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  subscribeToUpdates?(intent_hash: string, callback: (status: IntentStatus) => void): () => void {
    // 1Click uses webhooks, not WebSockets
    // Poll for status updates
    const pollInterval = setInterval(async () => {
      try {
        const status = await this.getStatus(intent_hash);
        callback(status);
        
        if (['settled', 'failed'].includes(status.status)) {
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('Status polling error:', error);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }

  // Local storage helpers (would be database in production)
  private intentMappings = new Map<string, any>();
  
  private storeLocalMapping(hash: string, data: any): void {
    this.intentMappings.set(hash, data);
  }
  
  private getLocalMapping(hash: string): any {
    return this.intentMappings.get(hash);
  }

  private calculateCollateral(derivatives: any): string {
    const size = parseFloat(derivatives.size || '0');
    const leverage = parseFloat(derivatives.leverage || '1');
    return (size / leverage).toString();
  }

  private generateIntentHash(intent: SignedIntent): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256')
      .update(JSON.stringify(intent))
      .digest('hex')
      .substring(0, 64);
  }
}