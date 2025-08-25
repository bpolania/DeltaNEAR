# DeltaNEAR - Cross-Chain Derivatives Execution via NEAR Intents

A production-ready implementation combining NEAR Intents with cross-chain execution for perpetuals and options trading through a competitive solver network. 

## Documentation

For comprehensive documentation, see the [docs folder](./docs/):
- [Documentation Index](./docs/INDEX.md) - Complete documentation overview
- [Derivatives Intent Schema v1.0.0](./docs/DERIVATIVES_INTENT_SCHEMA_V1.md) - Canonical schema specification
- [Metadata Contract v1.0.0](./docs/METADATA_CONTRACT_V1.md) - Contract interface documentation
- [Canonicalization Spec v1.0.0](./docs/CANONICALIZATION_SPEC_V1.md) - Deterministic canonicalization
- [ABI Stability v1.0.0](./docs/ABI_STABILITY_V1.md) - Frozen ABI specification

## Key Architecture Principles

- **Canonical Verifier** (`intents.near`) handles ALL token operations and signature verification
- **Thin Metadata Contract** stores ONLY derivatives metadata and logs (no tokens)
- **1Click API** is used as distribution layer ONLY (doesn't understand derivatives)
- **NO position tokens** - derivatives positions live on external venues (GMX, Lyra)
- **Settlement via TokenDiff** - only P&L transfers, not position transfers

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

### Components

1. **Distribution Provider Abstraction** (`services/distribution-provider/`)
   - Flexible interface for intent distribution
   - Multiple provider implementations:
     - **OFA Gateway**: Custom order flow auction
     - **NEAR Intents (1Click API)**: Native NEAR infrastructure
     - **Mock Provider**: Deterministic testing
   - Environment-based provider selection

2. **NEAR Contracts**
   - **Thin Metadata Contract** (`contracts/near-intents-derivatives/`): Derivatives metadata ONLY
     - Stores derivatives-specific metadata (instrument, symbol, leverage, etc.)
     - Logs execution events for analytics
     - Calculates fee routing parameters
     - ❌ NO signature verification (Verifier handles)
     - ❌ NO token transfers (Verifier handles)
     - ❌ NO settlement logic (Verifier handles)
   - **Canonical Verifier** (`intents.near` on mainnet, `intents.testnet` on testnet)
     - ALL signature verification (NEP-413)
     - ALL token transfers and custody
     - Atomic intent execution via `execute_intents`
     - Settlement through TokenDiff intents
     - Battle-tested and audited

3. **OFA Gateway** (`services/ofa-gateway/`)
   - HTTP/WebSocket API for intent submission
   - Auction mechanism for solver selection
   - Quote aggregation and winner selection
   - Real-time solver registry management

4. **Solver Node** (`services/solver-node/`)
   - Venue adapter interface for multiple DEXs
   - Risk management and constraint checking
   - Chain Signatures for cross-chain execution
   - PnL calculation and settlement

5. **Venue Adapters**
   - GMX-v2: Perpetual futures with funding rates
   - Lyra-v2: Options with Black-Scholes pricing and Greeks

## Distribution Providers

DeltaNEAR uses a flexible Distribution Provider abstraction that allows switching between different intent distribution mechanisms:

### 1. OFA Gateway (Custom Implementation)
```typescript
const provider = createProvider({
  type: 'ofa-gateway',
  endpoint: 'http://localhost:3000',
  wsEndpoint: 'ws://localhost:3001'
});
```

### 2. NEAR Intents via 1Click API
```typescript
const provider = createProvider({
  type: 'near-intents',
  endpoint: 'https://api.intents.near.org',
  options: {
    oneClickUrl: 'https://1click.chaindefuser.com',
    verifierContract: 'intents.near',
    network: 'mainnet'
  }
});
```

### 3. Mock Provider (Testing)
```typescript
const provider = createProvider({
  type: 'mock',
  endpoint: 'mock://localhost'
});
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- Rust 1.70+
- Docker & Docker Compose

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/deltanear.git
cd deltanear

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Copy environment variables
cp .env.example .env
```

### Running Locally

#### Option 1: Docker Compose (Recommended)

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Run demos
pnpm run demo:perp
pnpm run demo:option
```

#### Option 2: Manual Setup

```bash
# Terminal 1: Start OFA Gateway
cd services/ofa-gateway
pnpm dev

# Terminal 2: Start Solver 1
cd services/solver-node
SOLVER_ID=solver-1 SUPPORTED_VENUES=gmx-v2,lyra-v2 pnpm dev

# Terminal 3: Start Solver 2
cd services/solver-node
SOLVER_ID=solver-2 SUPPORTED_VENUES=gmx-v2 pnpm dev

# Terminal 4: Run demos
pnpm run demo:perp
pnpm run demo:option
```

## Settlement Implementation

### Critical Schema Compliance

Our settlement MUST match the Verifier's strict requirements:

```typescript
// CORRECT TokenDiff for P&L settlement
const settlementIntent = {
  intent: 'token_diff',  // Exact string required
  diff: {
    "nep141:usdc.near": "-150.50",  // Solver pays out profit
  }
};

// ❌ WRONG - These will fail
const wrongIntent1 = {
  intent_type: 'TokenDiff',  // Wrong field name
  token_diff: { ... }        // Wrong field name
};

const wrongIntent2 = {
  intent: 'token_diff',
  diff: {
    "usdc.near": "-150"  // Missing nep141: prefix
  }
};
```

### Settlement Best Practices

1. **Always Pre-deposit**: Ensure tokens are in Verifier before settlement
2. **Always Simulate**: Use `simulate_intents()` before `execute_intents`
3. **Use Exact Schema**: Field names and formats must match exactly
4. **Handle Failures**: Simulation failures indicate schema or balance issues
5. **Log Metadata Only**: Our contract logs events, Verifier handles tokens

## Intent Schema

```json
{
  "chain_id": "near-mainnet",
  "intent_type": "derivatives",
  "nonce": "uint64",
  "expiry": "unix_seconds",
  "account_id": "user.near",
  "actions": [{
    "instrument": "perp|option",
    "symbol": "ETH-USD",
    "side": "long|short|buy|sell",
    "size": "decimal_string",
    "leverage": "decimal_string_optional",
    "option": {
      "kind": "call|put",
      "strike": "decimal_string",
      "expiry": "yyyy-mm-ddThh:mm:ssZ"
    },
    "max_slippage_bps": 10,
    "max_funding_bps_8h": 20,
    "max_fee_bps": 5,
    "venue_allowlist": ["gmx-v2", "hyperliquid", "lyra-v2"],
    "collateral_token": "USDC",
    "collateral_chain": "base|arbitrum|solana"
  }],
  "settlement": {
    "payout_token": "USDC",
    "payout_account": "user.near",
    "protocol_fee_bps": 2,
    "rebate_bps": 1
  }
}
```

## API Documentation

### OFA Gateway API

#### POST /intents
Submit a new derivatives intent.

```bash
curl -X POST http://localhost:3000/intents \
  -H "Content-Type: application/json" \
  -d @intent.json
```

#### POST /quotes
Request quotes from solvers for an intent.

```bash
curl -X POST http://localhost:3000/quotes \
  -H "Content-Type: application/json" \
  -d '{"intent_hash": "0x..."}'
```

#### POST /accept
Accept a quote with NEP-413 signature.

```bash
curl -X POST http://localhost:3000/accept \
  -H "Content-Type: application/json" \
  -d '{
    "intent": {...},
    "signature": "0x...",
    "public_key": "0x..."
  }'
```

#### GET /status/:intent_hash
Get execution status of an intent.

```bash
curl http://localhost:3000/status/0x...
```

### CLI Usage

```bash
# Generate keypair
node scripts/cli.js keygen

# Submit perpetual order
node scripts/cli.js submit-perp \
  --symbol ETH-USD \
  --side long \
  --size 2.5 \
  --leverage 5 \
  --venue gmx-v2

# Submit option order
node scripts/cli.js submit-option \
  --symbol ETH-USD \
  --side buy \
  --size 10 \
  --kind call \
  --strike 4000 \
  --expiry 2024-12-31 \
  --venue lyra-v2

# Check status
node scripts/cli.js status <intent_hash>
```

## Deployment

### Testnet Deployment

```bash
# Deploy NEAR contract to testnet
./scripts/deploy-testnet.sh

# Test deployed contract
node scripts/test-testnet.js

# Run distribution provider integration test
node scripts/test-distribution-integration.js
```

### Current Testnet Contract
- **Contract ID**: `deltanear-intents-1755930723.testnet`
- **Status**: Deployed and initialized
- **Authorized Solvers**: 2 (solver-1, solver-2)

## Testing

```bash
# Run all tests
pnpm test

# Run NEAR contract tests
cd contracts/near-intents-derivatives
cargo test

# Run service tests
cd services/ofa-gateway
pnpm test

# Run distribution provider tests
cd services/distribution-provider
pnpm test

# Run end-to-end tests
pnpm run test:e2e

# Run testnet integration tests
pnpm run test:testnet
```

## Fee Model

- **Protocol Fee**: Charged on notional volume (configurable, default 2 bps)
- **Solver Rebate**: Incentive for solvers (configurable, default 1 bps)
- **Treasury**: Protocol fees sent to configurable treasury account

## Risk Management

### Solver Constraints
- Maximum exposure limits per solver
- Position-level margin requirements
- Liquidation price monitoring
- Delta exposure limits for options

### Intent Constraints
- max_slippage_bps: Maximum allowed price slippage
- max_funding_bps_8h: Maximum 8-hour funding rate
- max_fee_bps: Maximum total fees
- venue_allowlist: Approved execution venues

## Event Schema

The thin metadata contract emits events for monitoring (no token operations):

- `DerivativesMetadata stored: intent_hash, instrument, symbol, solver`
- `DerivativesExecuted: intent_hash, solver, venue, price, notional, fees_bps`

The Canonical Verifier handles all token-related events:
- Intent validation and signature verification
- Token transfers and settlements
- Atomic execution guarantees

## Data Flow

1. **Intent Submission**: User creates intent, distribution provider handles routing
2. **Quote Collection**: 
   - Via OFA Gateway: Direct solver connections
   - Via 1Click: Automatic distribution (derivatives in metadata)
3. **Execution**: Solver executes on external venue (GMX, Lyra, etc.)
4. **Settlement** (with EXACT Verifier schema): 
   - Solver calculates P&L off-chain
   - Creates TokenDiff with exact format: `{"intent": "token_diff", "diff": {"nep141:usdc.near": "-150"}}`
   - Signs with NEP-413 (nonce + recipient required)
   - **ALWAYS** runs `simulate_intents()` dry-run first
   - Only executes if simulation passes
   - NO position tokens - just USDC/token transfers
5. **Metadata Logging**: Thin contract logs execution details (no tokens)
6. **Fee Routing**: Calculated by metadata contract, executed via TokenDiff

## Troubleshooting

### Common Issues

1. **Solver not connecting**: Check WebSocket port (3001) is accessible
2. **No quotes received**: Verify venue allowlist matches solver capabilities
3. **Signature verification fails**: Ensure proper NEP-413 message format
4. **Docker build fails**: Clear Docker cache with `docker system prune`

### Debug Mode

```bash
# Enable verbose logging
DEBUG=* pnpm dev

# Check solver heartbeats
curl http://localhost:3000/health
```

## NEAR Native Integration

### How We Integrate with 1Click API

Our `NEARIntentsProvider` treats 1Click as a distribution layer ONLY (it doesn't understand derivatives):

```typescript
// 1Click sees this as a swap, NOT a derivatives order
const quoteResponse = await oneClickClient.post('/v0/quote', {
  src: {
    chain: action.collateral_chain,
    token: action.collateral_token,
    amount: calculateCollateral(action)
  },
  dst: {
    chain: 'near',
    token: settlement.payout_token,  // Just USDC, not position tokens
    address: account_id
  },
  // Metadata is ONLY for our solvers - 1Click ignores this
  metadata: {
    type: 'derivatives_order',      // Custom type for our solvers
    details: {
      instrument: action.instrument,  // Our solvers read this
      symbol: action.symbol,          // 1Click doesn't process
      side: action.side,              // Just hints for solvers
      leverage: action.leverage       // Not understood by 1Click
    }
  }
});

// 2. User deposits to provided address
const depositAddress = quoteResponse.data.deposit_address;

// 3. Submit deposit confirmation
await oneClickClient.post('/v0/deposit/submit', {
  intent_id: intent_hash,
  tx_hash: depositTxHash
});

// 4. Monitor execution status
const status = await oneClickClient.get('/v0/status', {
  params: { intent_id: intent_hash }
});
```

### 1Click API Integration Details
- **Base URL**: `https://1click.chaindefuser.com`
- **Authentication**: JWT token for 0% fees (0.1% without)
- **Main Endpoints**: 
  - `/v0/quote` - Generate swap quote with derivatives metadata
  - `/v0/deposit/submit` - Confirm deposit transaction
  - `/v0/status` - Track execution progress
- **Status Flow**: PENDING_DEPOSIT → PROCESSING → SUCCESS/FAILED

### How We Use the Canonical Verifier

The Verifier handles ALL token operations with STRICT schema requirements:

```typescript
// 1. Pre-deposit tokens to Verifier (REQUIRED)
await verifier.deposit({
  token_id: 'nep141:usdc.near',  // MUST use nep141: prefix
  amount: '1000000' // Minimal units (6 decimals for USDC)
});

// 2. EXACT TokenDiff Schema for Settlement
const intent = {
  signer_id: 'solver.testnet',
  deadline: '2025-01-01T00:00:00.000Z',  // ISO 8601 format
  intents: [{
    intent: 'token_diff',  // MUST be exactly this string
    diff: {
      "nep141:usdc.near": "-150",  // Solver loses 150 USDC
      // Negative = lose tokens, Positive = gain tokens
      // MUST use "nep141:" prefix for all tokens
    }
  }]
};

// 3. NEP-413 Signature (EXACT format required)
const signedIntent = {
  standard: 'nep413',
  payload: {
    message: JSON.stringify(intent),
    nonce: 'base64-encoded-32-bytes',  // Cryptographically secure
    recipient: 'intents.near'  // MUST be Verifier address
  },
  public_key: 'ed25519:...',
  signature: 'ed25519:...'
};

// 4. CRITICAL: Dry-run first with simulate_intents
try {
  await verifier.simulate_intents({ intents: [signedIntent] });
} catch (error) {
  // Abort - schema mismatch or insufficient balance
  throw new Error(`Simulation failed: ${error}`);
}

// 5. Execute atomically ONLY if simulation passes
await verifier.execute_intents({ intents: [signedIntent] });
```

### Canonical Verifier Contract Details
- **Mainnet**: `intents.near`
- **Testnet**: `intents.testnet`
- **Responsibilities**:
  - ALL signature verification (NEP-413)
  - ALL token transfers and custody
  - ALL settlement accounting
  - Atomic execution guarantees
- **Key Methods**:
  - `deposit()` - Pre-deposit tokens (REQUIRED before execution)
  - `simulate_intents()` - Dry-run to validate schema (ALWAYS use first)
  - `execute_intents()` - Atomic execution (only after simulation)
  - `withdraw()` - Retrieve unused deposits

### TokenDiff Schema Requirements

**EXACT format required by Verifier:**

```json
{
  "intent": "token_diff",  // MUST be exactly this string
  "diff": {
    "nep141:usdc.near": "-100",   // Token loses
    "nep141:wbtc.near": "0.001"    // Token gains
  }
}
```

**Critical Requirements:**
- Token IDs MUST use `"nep141:{contract}"` format
- Values MUST be strings, not numbers
- Negative values = lose tokens, Positive = gain tokens
- Field name is `"intent"` not `"intent_type"`
- Field name is `"diff"` not `"token_diff"`

### Our Thin Metadata Contract
- **Purpose**: ONLY derivatives metadata and logging
- **Methods**:
  - `store_metadata()` - Store derivatives info (no tokens)
  - `log_execution()` - Log events for analytics (no tokens)
  - `get_fee_routing_params()` - Calculate fees (no transfers)
- **Does NOT**:
  - ❌ Verify signatures
  - ❌ Transfer tokens
  - ❌ Execute settlements

### Integration Strategy

Our architecture supports three distribution modes:

1. **Custom OFA Mode** (Current Default)
   - Uses our OFA Gateway for distribution
   - Direct solver management
   - Custom auction logic
   - Settlement via Verifier's execute_intents

2. **1Click Mode** (Available)
   - 1Click API as distribution layer ONLY
   - 1Click doesn't understand derivatives
   - Metadata field contains solver hints
   - Settlement still via Verifier

3. **Hybrid Mode** (Recommended for Production)
   - Use 1Click for distribution when possible
   - Use OFA Gateway when 1Click doesn't understand
   - ALWAYS use Verifier for token operations
   - Thin contract ONLY for metadata

### Configuration Examples

```bash
# Use OFA Gateway (default)
DISTRIBUTION_PROVIDER=ofa-gateway
OFA_GATEWAY_URL=http://localhost:3000

# Use 1Click API
DISTRIBUTION_PROVIDER=near-intents
ONE_CLICK_URL=https://1click.chaindefuser.com
NEAR_JWT_TOKEN=your-jwt-token
VERIFIER_CONTRACT=intents.testnet

# Use Mock for testing
DISTRIBUTION_PROVIDER=mock
```

## Production Considerations

1. **Schema Compliance**
   - ALWAYS use `simulate_intents()` before execution
   - Match Verifier's EXACT TokenDiff schema
   - Use proper `nep141:` token prefixes
   - Ensure all values are strings, not numbers
   - Test with Verifier's testnet first

2. **Security**
   - Implement proper key management for NEP-413 signing
   - Use cryptographically secure nonces (32 bytes)
   - Set proper deadlines (ISO 8601 format)
   - Validate all schemas before submission
   - Use JWT authentication for 1Click API

3. **Performance**
   - Pre-deposit tokens to avoid execution failures
   - Batch intents when possible
   - Cache simulation results
   - Use message queue for solver communication
   - Leverage 1Click API for reduced infrastructure overhead

4. **Monitoring**
   - Track simulation failures (schema issues)
   - Monitor Verifier deposit balances
   - Alert on failed `execute_intents` calls
   - Log all TokenDiff submissions
   - Monitor Verifier contract events

## Resources

### Internal Documentation
- [Complete Documentation Index](./docs/INDEX.md)
- [Derivatives Intent Schema v1.0.0](./docs/DERIVATIVES_INTENT_SCHEMA_V1.md)
- [Metadata Contract Interface](./docs/METADATA_CONTRACT_V1.md)
- [Implementation Corrections](./docs/IMPLEMENTATION_CORRECTIONS.md)

### External Resources
- [1Click API Documentation](https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api)
- [Verifier Contract Documentation](https://docs.near-intents.org/near-intents/market-makers/verifier/introduction)
- [NEAR Intents GitHub](https://github.com/near/intents)
- [NEP-413 Specification](https://github.com/near/NEPs/pull/413)
- [Integration Examples](https://learnnear.club/how-to-read-any-near-intents-transaction-step-by-step/)

## License

MIT

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

## Support

For questions and support, please open an issue on GitHub.