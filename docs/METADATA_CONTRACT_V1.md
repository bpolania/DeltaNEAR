# DeltaNEAR Metadata Contract v1.0.0

## Overview

The DeltaNEAR Metadata Contract serves as the **stable public interface** for derivatives trading on NEAR Protocol. This thin contract provides configuration, metadata storage, and audit functionality while delegating ALL token operations to the Canonical Verifier (`intents.near`).

**Contract Address**: `deltanear-derivatives.testnet` (testnet) / `deltanear-derivatives.near` (mainnet)  
**Schema Version**: 1.0.0  
**Status**: STABLE  

## Key Design Principles

1. **No Token Handling**: The contract NEVER touches tokens - all settlements go through the Canonical Verifier
2. **Metadata Only**: Stores derivatives-specific information that the generic Verifier doesn't understand
3. **Configuration Hub**: Provides fee configs, guardrails, and venue allowlists
4. **Audit Trail**: Logs execution details for monitoring and analytics
5. **NEP-297 Events**: Emits standard events for indexers and monitoring

## Contract Architecture

```rust
Contract State
├── FeeConfig (protocol fees, rebates, treasury)
├── Guardrails (position limits, leverage, cooldowns)
├── Symbol Configs (trading pairs, sizes, instruments)
├── Venue Configs (supported venues, chains, fees)
├── Intent Metadata (stored derivatives details)
└── Execution Logs (fill prices, P&L, timestamps)
```

## Stable View Methods (v1.0.0)

### Schema Version
```rust
pub fn get_schema_version(&self) -> String
```
Returns the current schema version (currently "1.0.0").

### Fee Configuration
```rust
pub fn get_fee_config(&self) -> FeeConfig {
    protocol_fee_bps: u16,      // Protocol fee in basis points
    solver_rebate_bps: u16,     // Solver rebate in basis points
    min_fee_usdc: String,       // Minimum fee in USDC
    max_fee_bps: u16,           // Maximum fee cap
    treasury: AccountId,        // Treasury account for fees
}
```

### Guardrails
```rust
pub fn get_guardrails(&self, symbol: Option<String>, account: Option<AccountId>) -> Guardrails {
    max_position_size: String,      // Maximum position size
    max_leverage: String,           // Maximum leverage allowed
    max_daily_volume: String,       // Daily volume limit
    allowed_instruments: Vec<String>, // ["perp", "option"]
    cooldown_seconds: u32,          // Minimum time between trades
}
```
Returns guardrails with priority: user-specific > symbol-specific > default.

### Supported Symbols
```rust
pub fn get_supported_symbols(&self) -> Vec<SymbolConfig> {
    symbol: String,              // "ETH-USD"
    instruments: Vec<String>,    // ["perp", "option"]
    min_size: String,           // "0.01"
    max_size: String,           // "1000"
    tick_size: String,          // "0.01"
}
```

### Allowed Venues
```rust
pub fn get_allowed_venues(&self, symbol: String) -> Vec<VenueConfig> {
    venue_id: String,                      // "gmx-v2"
    chain: String,                         // "arbitrum"
    supported_instruments: Vec<String>,    // ["perp"]
    fee_bps: u16,                         // 5
}
```

### Intent Hash Verification
```rust
pub fn verify_intent_hash(&self, intent_json: String) -> String
```
Computes the canonical hash for an intent using the exact algorithm specified in the schema.

### Metadata Retrieval
```rust
pub fn get_intent_metadata(&self, intent_hash: String) -> Option<IntentMetadata>
pub fn get_execution_log(&self, intent_hash: String) -> Option<ExecutionLog>
```

## Change Methods

### Store Intent Metadata
```rust
pub fn store_intent_metadata(&mut self, intent_hash: String, metadata: IntentMetadata)
```
Stores derivatives-specific metadata and emits `intent_submitted` event.

### Log Execution
```rust
pub fn log_execution(&mut self, intent_hash: String, log: ExecutionLog)
```
Records execution details after venue trade and emits `execution_logged` event.

### Configuration Management
```rust
pub fn add_symbol_config(&mut self, config: SymbolConfig)
pub fn add_venue_config(&mut self, config: VenueConfig, symbols: Vec<String>)
pub fn set_user_guardrails(&mut self, account: AccountId, guardrails: Guardrails)
pub fn set_symbol_guardrails(&mut self, symbol: String, guardrails: Guardrails)
pub fn update_fee_config(&mut self, config: FeeConfig)
```
Admin methods for managing configuration (treasury-only).

## NEP-297 Events

All events follow the NEP-297 standard with namespace `deltanear_derivatives`:

### Event Format
```json
{
  "standard": "deltanear_derivatives",
  "version": "1.0.0",
  "event": "event_type",
  "data": { ... }
}
```

### Event Types

#### intent_submitted
Emitted when new derivatives intent metadata is stored:
```json
{
  "intent_hash": "abc123...",
  "signer_id": "user.near",
  "instrument": "perp",
  "symbol": "ETH-USD",
  "side": "long",
  "size": "1.5",
  "timestamp": 1706025600
}
```

#### execution_logged
Emitted when execution is recorded:
```json
{
  "intent_hash": "abc123...",
  "solver_id": "solver1.near",
  "venue": "gmx-v2",
  "fill_price": "3650.00",
  "notional": "5475000000",
  "status": "filled",
  "timestamp": 1706025700
}
```

## Canonical Hashing Algorithm

The contract implements the exact hashing algorithm from the schema specification:

1. **Normalize** intent to canonical form:
   - Uppercase symbols
   - Lowercase sides
   - Apply default values for optional fields

2. **Serialize** deterministically with sorted keys

3. **Hash** using SHA-256

4. **Return** first 64 characters as hex

Example:
```rust
let intent_hash = contract.verify_intent_hash(r#"{
  "version": "1.0.0",
  "intent_type": "derivatives",
  "derivatives": {
    "instrument": "perp",
    "symbol": "eth-usd",
    "side": "LONG",
    "size": "1.5",
    "collateral": {
      "token": "usdc.near",
      "chain": "near"
    }
  },
  "signer_id": "user.near",
  "deadline": "2024-01-23T11:00:00Z",
  "nonce": "12345"
}"#);
// Returns: "3f2a8b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a"
```

## Integration with Verifier

The contract works in tandem with the Canonical Verifier:

1. **Frontend** creates derivatives intent
2. **Metadata Contract** stores derivatives-specific data
3. **Solver** executes on external venue (GMX, Lyra, etc.)
4. **Verifier** handles P&L settlement via TokenDiff
5. **Metadata Contract** logs execution for audit

### Settlement Flow
```
User Intent → Metadata Storage → Solver Execution → Verifier Settlement → Execution Log
```

## Deployment

### Building
```bash
cd contracts/near-intents-derivatives
cargo build --release --target wasm32-unknown-unknown
wasm-opt --signext-lowering target/wasm32-unknown-unknown/release/deltanear_derivatives.wasm \
  -o deltanear_derivatives_optimized.wasm
```

### Deploying
```bash
# Deploy to testnet
near deploy deltanear-derivatives.testnet \
  deltanear_derivatives_optimized.wasm \
  --initFunction new \
  --initArgs '{
    "treasury_account_id": "treasury.testnet",
    "protocol_fee_bps": 20,
    "solver_rebate_bps": 10
  }'
```

### Initial Configuration
```bash
# Add ETH-USD symbol
near call deltanear-derivatives.testnet add_symbol_config '{
  "config": {
    "symbol": "ETH-USD",
    "instruments": ["perp", "option"],
    "min_size": "0.01",
    "max_size": "1000",
    "tick_size": "0.01"
  }
}' --accountId treasury.testnet

# Add GMX venue
near call deltanear-derivatives.testnet add_venue_config '{
  "config": {
    "venue_id": "gmx-v2",
    "chain": "arbitrum",
    "supported_instruments": ["perp"],
    "fee_bps": 5
  },
  "symbols": ["ETH-USD", "BTC-USD"]
}' --accountId treasury.testnet
```

## Security Considerations

1. **No Token Handling**: Contract cannot lose user funds as it never touches tokens
2. **Admin Functions**: Only treasury can modify configuration
3. **Guardrails**: Enforced by solvers before quoting
4. **Immutable Schema**: Version 1.0.0 view methods are stable and won't change
5. **Event Integrity**: NEP-297 events provide auditable trail

## Migration Strategy

For updates that require breaking changes:
- Deploy new contract with version 2.0.0
- Maintain v1 contract for backward compatibility
- Solvers specify supported versions
- Gradual migration with dual support period

## Monitoring

Key metrics to track:
- Intent submission rate
- Execution success rate
- Average fill prices vs quotes
- Fee collection
- Guardrail violations
- Venue distribution

## Support

- **GitHub**: https://github.com/deltanear/contracts
- **Discord**: https://discord.gg/deltanear
- **Docs**: https://docs.deltanear.io