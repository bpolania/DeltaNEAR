/**
 * Mock Drift Protocol Adapter for Testing
 * 
 * Provides a testable interface without real Solana dependencies
 */

import { ChainSignatures } from '../chain-signatures';
import { EventEmitter } from 'events';

interface DriftConfig {
  rpcUrl: string;
  programId: string;
  chainSignatureAccount: string;
  environment: 'mainnet' | 'devnet';
}

interface DriftPosition {
  symbol: string;
  side: 'long' | 'short';
  size: string;
  leverage: string;
  collateral: string;
  entryPrice?: string;
  markPrice?: string;
  unrealizedPnl?: string;
}

interface DriftQuote {
  symbol: string;
  side: 'long' | 'short';
  size: string;
  price: string;
  slippage: string;
  fees: {
    taker: string;
    maker: string;
    funding: string;
  };
  collateralRequired: string;
  executionPath: string[];
}

export class DriftAdapter extends EventEmitter {
  private config: DriftConfig;
  private chainSig: ChainSignatures;
  private mockConnected: boolean = false;
  
  // Drift market indices
  private readonly MARKET_INDICES = {
    'BTC-PERP': 0,
    'ETH-PERP': 1,
    'SOL-PERP': 2,
    'MATIC-PERP': 3,
    'APT-PERP': 4,
    'ARB-PERP': 5
  };

  constructor(config: DriftConfig) {
    super();
    this.config = config;
    
    // Initialize Chain Signatures with mock key
    this.chainSig = new ChainSignatures(
      process.env.CHAIN_SIG_PRIVATE_KEY || 'mock_key_for_' + config.chainSignatureAccount
    );
    
    // Simulate connection
    this.mockConnected = true;
  }

  /**
   * Get quote for opening a position
   */
  async getQuote(params: {
    symbol: string;
    side: 'long' | 'short';
    size: string;
    leverage?: string;
  }): Promise<DriftQuote> {
    const marketIndex = this.getMarketIndex(params.symbol);
    const leverage = params.leverage || '1';
    
    // Mock market data
    const basePrice = 50000000000; // $50,000 with 6 decimals
    const sizeBN = parseInt(params.size);
    const slippageBps = Math.min(sizeBN * 10 / 1000000, 100); // Simple slippage model
    
    const executionPrice = params.side === 'long'
      ? basePrice * (10000 + slippageBps) / 10000
      : basePrice * (10000 - slippageBps) / 10000;
    
    // Calculate fees
    const takerFeeBps = 10; // 0.1%
    const notionalValue = sizeBN * executionPrice;
    const takerFee = notionalValue * takerFeeBps / 10000;
    
    // Calculate collateral required
    const leverageNum = parseInt(leverage);
    const collateralRequired = notionalValue / leverageNum;
    
    return {
      symbol: params.symbol,
      side: params.side,
      size: params.size,
      price: executionPrice.toString(),
      slippage: slippageBps.toString(),
      fees: {
        taker: takerFee.toString(),
        maker: '0',
        funding: '10' // 0.01% funding rate
      },
      collateralRequired: collateralRequired.toString(),
      executionPath: ['drift-amm', 'drift-jit']
    };
  }

  /**
   * Open a position on Drift (mocked)
   */
  async openPosition(params: {
    symbol: string;
    side: 'long' | 'short';
    size: string;
    leverage: string;
    collateral: string;
    maxSlippageBps: number;
    intentHash: string;
  }): Promise<{
    success: boolean;
    txHash?: string;
    position?: DriftPosition;
    error?: string;
  }> {
    try {
      // Simulate transaction signing with Chain Signatures
      const mockTxData = {
        chain: 'solana',
        to: this.config.programId,
        data: {
          action: 'openPosition',
          params
        }
      };
      
      const broadcastId = await this.chainSig.signAndBroadcast(mockTxData);
      const txHash = '5wHu6qW8H5rVvaBKxmJBqK2xvZrPcS5V3vfEB4bBvQTz';
      
      // Create mock position
      const position: DriftPosition = {
        symbol: params.symbol,
        side: params.side,
        size: params.size,
        leverage: params.leverage,
        collateral: params.collateral,
        entryPrice: '50000000000',
        markPrice: '50000000000',
        unrealizedPnl: '0'
      };
      
      // Emit execution event
      this.emit('execution_complete', {
        venue: 'drift',
        intentHash: params.intentHash,
        txHash,
        position,
        timestamp: Date.now()
      });
      
      return {
        success: true,
        txHash,
        position
      };
    } catch (error: any) {
      console.error('[Drift Mock] Position opening failed:', error);
      
      this.emit('execution_failed', {
        venue: 'drift',
        intentHash: params.intentHash,
        error: error.message,
        timestamp: Date.now()
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Close an existing position (mocked)
   */
  async closePosition(params: {
    symbol: string;
    intentHash: string;
  }): Promise<{
    success: boolean;
    txHash?: string;
    pnl?: string;
    error?: string;
  }> {
    try {
      const txHash = 'mock_close_tx_' + Date.now();
      
      return {
        success: true,
        txHash,
        pnl: '1000000000' // Mock $1000 profit
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get market index for symbol
   */
  private getMarketIndex(symbol: string): number {
    const marketSymbol = symbol.replace('-USD', '-PERP');
    const index = this.MARKET_INDICES[marketSymbol as keyof typeof this.MARKET_INDICES];
    
    if (index === undefined) {
      throw new Error(`Unsupported market: ${symbol}`);
    }
    
    return index;
  }

  /**
   * Health check for Drift connection
   */
  async healthCheck(): Promise<boolean> {
    // Mock health check - always returns true in test
    return this.mockConnected;
  }
}