# DeltaNEAR V2.0.0 - Cross-Chain Derivatives Execution via NEAR Intents

A production-ready implementation combining NEAR Intents with cross-chain execution for perpetuals and options trading through a competitive solver network. 

## 🚀 V2.0.0 Release - Breaking Changes

This version introduces significant schema improvements for better cross-chain support and risk management:

### Key Changes
- **New Collateral Structure**: Explicit chain and token specification
- **Constraints Object**: Centralized risk parameters with defaults
- **Schema Version**: Contract returns "2.0.0" while intents use "1.0.0"
- **Improved Type Safety**: Full TypeScript and Rust type definitions

## Documentation

For comprehensive documentation, see the [docs folder](./docs/):
- [Documentation Index](./docs/INDEX.md) - Complete documentation overview
- [V2 Specification](./docs/V2_SPECIFICATION_FREEZE.md) - V2.0.0 schema specification
- [Migration Guide](./docs/MIGRATION_V1_TO_V2.md) - Upgrading from V1 to V2

## V2 Schema Overview

### DerivativesIntent Structure
```typescript
interface DerivativesIntentV2 {
  version: "1.0.0"           // Intent version (always "1.0.0")
  intent_type: "derivatives"
  derivatives: {
    collateral: {
      chain: string          // near, ethereum, arbitrum, base, solana
      token: string          // USDC, USDT, etc.
    }
    constraints: {
      max_fee_bps: number         // Default: 30, Max: 100
      max_funding_bps_8h: number  // Default: 50, Max: 100  
      max_slippage_bps: number    // Default: 100, Max: 1000
      venue_allowlist: string[]   // Lowercase, sorted
    }
    instrument: "perp" | "option"
    side: "long" | "short" | "buy" | "sell"
    size: string
    symbol: string           // UPPERCASE (e.g., "BTC-USD")
    leverage?: string        // For perps
    option?: {              // For options
      kind: "call" | "put"
      strike: string
      expiry: string        // ISO 8601
    }
  }
  signer_id: string
  deadline: string          // ISO 8601 with Z
  nonce: string
}
```

## Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│    User     │────▶│ Distribution     │◀────│   Solvers   │
└─────────────┘     │ Provider         │     └─────────────┘
                    └──────────────────┘
                             │
                    ┌────────┼────────┐
                    ▼        ▼        ▼
            ┌──────────┐ ┌────────┐ ┌──────────┐
            │   OFA    │ │1Click  │ │  Custom  │
            │ Gateway  │ │  API   │ │   ...    │
            └──────────┘ └────────┘ └──────────┘
                    │        │
                    ▼        ▼
            ┌───────────────────────────┐
            │    NEAR Blockchain        │
            │  ┌──────────────────┐    │
            │  │ Verifier Contract│    │
            │  │ (intents.near)   │    │
            │  └──────────────────┘    │
            └───────────────────────────┘
```

## Key Architecture Principles

- **Canonical Verifier** (`intents.near`) handles ALL token operations and signature verification
- **Thin Metadata Contract** stores ONLY derivatives metadata and logs (no tokens)
- **1Click API** is used as distribution layer ONLY (doesn't understand derivatives)
- **NO position tokens** - derivatives positions live on external venues (GMX, Lyra)
- **Settlement via TokenDiff** - only P&L transfers, not position transfers

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 8+
- Rust 1.75+
- NEAR CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/DeltaNEAR.git
cd DeltaNEAR

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Testing

```bash
# Run all tests
pnpm test

# Run contract tests
cd contracts/near-intents-derivatives
cargo test

# Run integration tests
pnpm test:integration
```

### Development

```bash
# Start solver node
cd services/solver-node
pnpm dev

# Start OFA gateway
cd services/ofa-gateway
pnpm dev

# Deploy contract to testnet
cd contracts/near-intents-derivatives
./deploy.sh testnet
```

## Project Structure

```
DeltaNEAR/
├── proto/                      # V2 Protocol definitions
│   └── src/
│       ├── index.ts           # Main V2 interfaces
│       ├── index-v2.ts        # V2 type definitions
│       └── migration.ts       # V1→V2 migration utilities
├── contracts/
│   └── near-intents-derivatives/
│       └── src/
│           ├── lib.rs         # V2 contract implementation
│           └── tests.rs       # V2 contract tests
├── services/
│   ├── solver-node/           # Solver implementation with V2 support
│   │   └── src/
│   │       ├── index.ts       # Main solver logic
│   │       ├── intent-store.ts # Intent storage mechanism
│   │       └── settlement.ts  # NEAR settlement
│   ├── ofa-gateway/           # REST API gateway
│   └── distribution-provider/  # Intent distribution
└── tests/
    └── integration/
        └── v2-flow.test.ts    # V2 integration tests
```

## V2 Migration Guide

### For Solver Developers

1. **Update Intent Handling**:
   ```typescript
   // Old (V1)
   const action = intent.actions[0];
   const token = action.collateral_token;
   
   // New (V2)
   const derivatives = intent.derivatives;
   const token = derivatives.collateral.token;
   const chain = derivatives.collateral.chain;
   ```

2. **Use Constraints Object**:
   ```typescript
   // Access constraints
   const maxFee = derivatives.constraints.max_fee_bps;
   const venues = derivatives.constraints.venue_allowlist;
   ```

3. **Store Intents for Execution**:
   ```typescript
   // Use IntentStore for quote→execution flow
   intentStore.store(intentHash, intent);
   // Later, retrieve for execution
   const storedIntent = intentStore.get(intentHash);
   ```

### For Contract Integration

The V2 contract is deployed at: `deltanear-v2-1756106334.testnet`

```rust
// Get schema version (returns "2.0.0")
let version = contract.get_schema_version();

// Validate V2 intent
let result = contract.validate_v2_intent(intent);
```

## Testing Status

- ✅ **Contract Tests**: 20/20 passing
- ✅ **TypeScript Compilation**: All services compile
- ✅ **Proto Tests**: 33/33 passing
- ✅ **Integration Tests**: Full V2 flow tested

## Contract Addresses

- **Testnet V2**: `deltanear-v2-1756106334.testnet`
- **Schema Version**: Returns "2.0.0" from `get_schema_version()`
- **ABI Hash**: `67e4874cb41e405be0d3e532341adace4137cb30d59b42cb480823624bb4503f`

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Security

For security concerns, please email security@deltanear.xyz

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Support

- Documentation: [docs/INDEX.md](./docs/INDEX.md)
- Issues: [GitHub Issues](https://github.com/yourusername/DeltaNEAR/issues)
- Discord: [Join our community](https://discord.gg/deltanear)