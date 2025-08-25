/**
 * Distribution Provider Factory
 * 
 * Creates the appropriate distribution provider based on configuration
 * Allows easy switching between implementations
 */

import { DistributionProvider, ProviderConfig } from './interface';
import { OFAGatewayProvider } from './ofa-gateway-provider';
import { NEARIntentsProvider } from './near-intents-provider';
import { MockProvider } from './mock-provider';

export class DistributionProviderFactory {
  private static instance?: DistributionProvider;
  private static config?: ProviderConfig;

  /**
   * Create a distribution provider based on configuration
   */
  static create(config: ProviderConfig): DistributionProvider {
    switch (config.type) {
      case 'ofa-gateway':
        return new OFAGatewayProvider(config);
      
      case 'near-intents':
        return new NEARIntentsProvider(config);
      
      case 'mock':
        return new MockProvider(config);
      
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  /**
   * Get or create a singleton instance
   */
  static getInstance(config?: ProviderConfig): DistributionProvider {
    if (!this.instance) {
      if (!config && !this.config) {
        throw new Error('Provider configuration required for first initialization');
      }
      
      this.config = config || this.config;
      this.instance = this.create(this.config!);
    }
    
    return this.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset() {
    this.instance = undefined;
    this.config = undefined;
  }

  /**
   * Load configuration from environment variables
   */
  static fromEnv(): ProviderConfig {
    const type = process.env.DISTRIBUTION_PROVIDER || 'ofa-gateway';
    
    switch (type) {
      case 'ofa-gateway':
        return {
          type: 'ofa-gateway',
          endpoint: process.env.OFA_GATEWAY_URL || 'http://localhost:3000',
          wsEndpoint: process.env.OFA_GATEWAY_WS_URL || 'ws://localhost:3001',
          apiKey: process.env.OFA_API_KEY
        };
      
      case 'near-intents':
        return {
          type: 'near-intents',
          endpoint: process.env.NEAR_INTENTS_URL || 'https://api.intents.near.org',
          apiKey: process.env.NEAR_JWT_TOKEN,
          options: {
            oneClickUrl: process.env.ONE_CLICK_URL || 'https://1click.chaindefuser.com',
            verifierContract: process.env.VERIFIER_CONTRACT || 
              (process.env.NEAR_NETWORK === 'mainnet' ? 'intents.near' : 'intents.testnet'),
            network: process.env.NEAR_NETWORK || 'testnet'
          }
        };
      
      case 'mock':
        return {
          type: 'mock',
          endpoint: 'mock://localhost'
        };
      
      default:
        throw new Error(`Unknown provider type from env: ${type}`);
    }
  }
}

// Export convenience functions
export function createProvider(config: ProviderConfig): DistributionProvider {
  return DistributionProviderFactory.create(config);
}

export function getProvider(config?: ProviderConfig): DistributionProvider {
  return DistributionProviderFactory.getInstance(config);
}

export function getProviderFromEnv(): DistributionProvider {
  const config = DistributionProviderFactory.fromEnv();
  return DistributionProviderFactory.getInstance(config);
}