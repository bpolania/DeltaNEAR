# DeltaNEAR Documentation

## Core Documentation

### Architecture & Design
- [Architecture Update](./ARCHITECTURE_UPDATE.md) - Current system architecture with NEAR infrastructure
- [Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md) - Key corrections and clarifications about NEAR components

### Specifications
- [Derivatives Intent Schema v1.0.0](./DERIVATIVES_INTENT_SCHEMA_V1.md) - Canonical schema for derivatives intents
- [Metadata Contract v1.0.0](./METADATA_CONTRACT_V1.md) - Stable public contract interface

### Operations
- [Deployment Guide](./DEPLOYMENT.md) - Step-by-step deployment instructions

## Quick Links

### Contracts
- **Metadata Contract**: Thin contract for derivatives metadata and configuration
- **Canonical Verifier**: `intents.near` handles all token operations

### Services
- **Distribution Provider**: Abstraction layer for intent distribution
- **Solver Node**: Cross-chain execution engine
- **Gateway Service**: REST API and WebSocket server

### Key Concepts
- **NEAR Intents**: Intent-based trading protocol
- **1Click API**: Production REST-based distribution channel
- **TokenDiff**: Settlement mechanism for P&L
- **NEP-413**: Message signing standard
- **NEP-297**: Event standard

## Documentation Structure

```
docs/
├── INDEX.md                           # This file
├── ARCHITECTURE_UPDATE.md             # System architecture
├── DERIVATIVES_INTENT_SCHEMA_V1.md    # Intent schema specification
├── METADATA_CONTRACT_V1.md            # Contract interface docs
├── IMPLEMENTATION_CORRECTIONS.md      # Important corrections
└── DEPLOYMENT.md                      # Deployment guide
```

## Version History

### v1.0.0 (Current)
- Stable derivatives intent schema
- Comprehensive metadata contract with view methods
- NEP-297 compliant events
- Canonical hashing algorithm
- Full integration with Canonical Verifier

### v0.9.0
- Initial implementation with thin metadata contract
- Integration with 1Click API
- Distribution provider abstraction
- Solver network implementation

## Getting Started

1. Review the [Architecture Update](./ARCHITECTURE_UPDATE.md) to understand the system
2. Read the [Derivatives Intent Schema](./DERIVATIVES_INTENT_SCHEMA_V1.md) for the canonical specification
3. Check [Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md) for important clarifications
4. Follow the [Deployment Guide](./DEPLOYMENT.md) to deploy the system

## API References

### Metadata Contract Views
```typescript
// Get current schema version
get_schema_version(): string

// Get fee configuration
get_fee_config(): FeeConfig

// Get guardrails for symbol or account
get_guardrails(symbol?: string, account?: AccountId): Guardrails

// Get supported trading symbols
get_supported_symbols(): SymbolConfig[]

// Get allowed venues for a symbol
get_allowed_venues(symbol: string): VenueConfig[]

// Verify intent hash
verify_intent_hash(intent_json: string): string
```

### Gateway REST API
```typescript
// Submit derivatives intent
POST /api/v1/intents/derivatives

// Get quote for intent
GET /api/v1/quotes/{intent_hash}

// Check execution status
GET /api/v1/executions/{intent_hash}
```

## Support

- **GitHub Issues**: Report bugs and request features
- **Discord**: Join our community for discussions
- **Email**: support@deltanear.io