# Distribution Provider Abstraction

## Overview

The Distribution Provider interface abstracts the intent distribution and auction mechanism, allowing DeltaNEAR to switch between different implementations without changing core business logic.

## Motivation

Based on architectural review, we identified the need to:
1. **Maintain flexibility** - Switch between custom and standard distribution mechanisms
2. **Support NEAR's native infrastructure** - Integrate with canonical Verifier contracts when available
3. **Simplify testing** - Use mock providers for deterministic tests
4. **Future-proof the architecture** - Easy migration to new distribution networks

## Available Providers

### 1. OFA Gateway Provider (Current)
Our custom Order Flow Auction implementation with:
- WebSocket-based real-time communication
- Direct solver management
- Custom auction logic
- Full control over quote selection

```typescript
const provider = createProvider({
  type: 'ofa-gateway',
  endpoint: 'http://localhost:3000',
  wsEndpoint: 'ws://localhost:3001'
});
```

### 2. NEAR Intents Provider (Available)
Integration with NEAR's native intent infrastructure:
- **1Click API**: REST-based distribution channel for intents
- **Canonical Verifier**: `intents.near` contract for atomic execution
- **Solver Network**: Automated market makers and liquidity providers
- **Cross-chain Support**: Built-in bridge integrations

```typescript
const provider = createProvider({
  type: 'near-intents',
  endpoint: 'https://api.intents.near.org',
  options: {
    oneClickUrl: 'https://1click.chaindefuser.com',
    verifierContract: 'intents.near', // mainnet
    network: 'mainnet'
  }
});
```

### 3. Mock Provider (Testing)
Deterministic provider for testing:
- Controllable delays and failures
- Predictable quote generation
- Subscription simulation
- Full test coverage

```typescript
const provider = createProvider({
  type: 'mock',
  endpoint: 'mock://localhost'
});
```

## Usage

### Basic Integration

```typescript
import { getProviderFromEnv } from '@deltanear/distribution-provider';

// Get provider based on environment configuration
const provider = getProviderFromEnv();

// Publish an intent
const { intent_hash } = await provider.publishIntent(signedIntent);

// Request quotes from solvers
await provider.requestQuotes(intent_hash);

// Get collected quotes
const quotes = await provider.getQuotes(intent_hash);

// Accept the best quote
await provider.acceptQuote(intent_hash, quotes[0].solver_id);

// Monitor status
const status = await provider.getStatus(intent_hash);
```

### With Subscriptions

```typescript
// Subscribe to real-time updates (if supported)
if (provider.subscribeToUpdates) {
  const unsubscribe = provider.subscribeToUpdates(
    intent_hash,
    (status) => {
      console.log('Status update:', status);
      
      if (status.status === 'settled') {
        unsubscribe();
      }
    }
  );
}
```

## Configuration

### Environment Variables

```bash
# Provider type: ofa-gateway | near-intents | mock
DISTRIBUTION_PROVIDER=ofa-gateway

# OFA Gateway configuration
OFA_GATEWAY_URL=http://localhost:3000
OFA_GATEWAY_WS_URL=ws://localhost:3001
OFA_API_KEY=optional-api-key

# NEAR Intents configuration
NEAR_INTENTS_URL=https://api.intents.near.org
ONE_CLICK_URL=https://1click.chaindefuser.com
NEAR_JWT_TOKEN=your-jwt-token  # For 0% fees on 1Click
VERIFIER_CONTRACT=intents.near  # or intents.testnet
NEAR_NETWORK=mainnet  # or testnet
```

### Programmatic Configuration

```typescript
import { DistributionProviderFactory } from '@deltanear/distribution-provider';

// Configure at startup
const config = {
  type: 'ofa-gateway',
  endpoint: process.env.GATEWAY_URL,
  wsEndpoint: process.env.GATEWAY_WS_URL,
  apiKey: process.env.API_KEY
};

const provider = DistributionProviderFactory.create(config);
```

## Migration Path

### Phase 1: Current State (OFA Gateway)
- Custom WebSocket implementation
- Direct solver management
- Full control over auction logic

### Phase 2: Abstraction (This Implementation)
- Interface-based design
- Provider factory pattern
- Environment-based configuration
- Backward compatible

### Phase 3: NEAR Integration (Ready)
- **1Click API**: Available at `https://1click.chaindefuser.com`
- **Verifier Contract**: Deployed at `intents.near` (mainnet) / `intents.testnet` (testnet)
- **Integration Path**: Use 1Click for distribution, Verifier for execution
- **Custom Logic**: Maintain derivatives-specific logic in our contract

## Testing Strategy

### Unit Tests
Use MockProvider for deterministic tests:

```typescript
describe('Intent Processing', () => {
  let provider: MockProvider;
  
  beforeEach(() => {
    provider = new MockProvider({ type: 'mock', endpoint: 'mock://' });
    provider.simulateDelay = 0; // Instant responses
    provider.simulateQuoteCount = 3; // Generate 3 quotes
  });
  
  it('should process intent through full lifecycle', async () => {
    const { intent_hash } = await provider.publishIntent(signedIntent);
    await provider.requestQuotes(intent_hash);
    
    const quotes = await provider.getQuotes(intent_hash);
    expect(quotes).toHaveLength(3);
    
    await provider.acceptQuote(intent_hash, quotes[0].solver_id);
    
    const status = await provider.getStatus(intent_hash);
    expect(status.status).toBe('accepted');
  });
});
```

### Integration Tests
Run tests against both mock and real providers:

```typescript
const providers = [
  { name: 'Mock', config: { type: 'mock', endpoint: 'mock://' } },
  { name: 'OFA Gateway', config: { type: 'ofa-gateway', endpoint: 'http://localhost:3000' } }
];

providers.forEach(({ name, config }) => {
  describe(`${name} Provider Integration`, () => {
    // Test suite runs against each provider
  });
});
```

## Benefits

1. **Flexibility** - Switch providers via configuration
2. **Testability** - Mock provider for deterministic tests
3. **Future-proof** - Ready for NEAR's native infrastructure
4. **Maintainability** - Single interface, multiple implementations
5. **Gradual migration** - No big-bang rewrites needed

## Trade-offs

### Current Approach (OFA Gateway)
✅ Full control over auction logic
✅ Custom optimization possibilities
✅ Real-time WebSocket communication
❌ Maintain infrastructure
❌ Handle solver discovery

### NEAR Intents Approach (Available Now)
✅ **1Click API**: Simplified REST interface for intent distribution
✅ **Canonical Verifier**: Battle-tested atomic execution contract
✅ **Active Solver Network**: Multiple market makers competing
✅ **JWT Authentication**: 0% fees with authentication token
⚠️ **Trade-off**: Less direct control over auction mechanics
⚠️ **Dependency**: Relies on NEAR infrastructure availability

## Conclusion

This abstraction layer provides the flexibility to evolve DeltaNEAR's distribution mechanism while maintaining stable interfaces for the rest of the application. The implementation allows for gradual migration and testing of different approaches without disrupting the core business logic.