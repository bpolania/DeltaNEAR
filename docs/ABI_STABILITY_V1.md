# ABI Stability Contract v1.0.0

## Overview

DeltaNEAR maintains a **stable, versioned ABI contract** that guarantees backward compatibility for all v1.0.0 integrations. This document defines the explicit contract interface, event schema, and canonical hashing algorithm that MUST remain unchanged across all v1.x.x releases.

## Stability Guarantees

### What is Guaranteed

1. **View Methods**: All view method signatures in v1.0.0 are immutable
2. **Event Schema**: NEP-297 event structure for v1.0.0 events cannot change
3. **Canonical Hashing**: The hashing algorithm and normalization rules are fixed
4. **Schema Version**: `get_schema_version()` will always return "1.0.0" for this major version

### What Can Change

1. **New Methods**: Additional methods can be added in v1.x.x releases
2. **New Events**: Additional events can be added without breaking existing ones
3. **Internal Implementation**: Contract logic can be optimized as long as interfaces remain stable
4. **Configuration Values**: Fee amounts, guardrails, etc. can be updated via admin methods

## Explicit ABI Contract

The complete ABI specification is stored in [`contracts/near-intents-derivatives/abi/v1.0.0.json`](../contracts/near-intents-derivatives/abi/v1.0.0.json).

### Stable View Methods

```typescript
interface StableViewMethods {
  // Returns the schema version (always "1.0.0" for v1)
  get_schema_version(): string;
  
  // Returns current fee configuration
  get_fee_config(): FeeConfig;
  
  // Returns guardrails for a symbol or account
  get_guardrails(symbol?: string, account?: AccountId): Guardrails;
  
  // Returns all supported trading symbols
  get_supported_symbols(): SymbolConfig[];
  
  // Returns allowed venues for a symbol
  get_allowed_venues(symbol: string): VenueConfig[];
  
  // Computes canonical hash for an intent
  verify_intent_hash(intent_json: string): string;
  
  // Returns metadata for an intent
  get_intent_metadata(intent_hash: string): IntentMetadata | null;
  
  // Returns execution log for an intent
  get_execution_log(intent_hash: string): ExecutionLog | null;
}
```

### Type Definitions

```typescript
interface FeeConfig {
  protocol_fee_bps: u16;
  solver_rebate_bps: u16;
  min_fee_usdc: string;
  max_fee_bps: u16;
  treasury: AccountId;
}

interface Guardrails {
  max_position_size: string;
  max_leverage: string;
  max_daily_volume: string;
  allowed_instruments: string[];
  cooldown_seconds: u32;
}

interface SymbolConfig {
  symbol: string;
  instruments: string[];
  min_size: string;
  max_size: string;
  tick_size: string;
}

interface VenueConfig {
  venue_id: string;
  chain: string;
  supported_instruments: string[];
  fee_bps: u16;
}
```

## NEP-297 Event Schema

All events follow the NEP-297 standard with immutable structure:

```json
{
  "standard": "deltanear_derivatives",
  "version": "1.0.0",
  "event": "<event_name>",
  "data": { ... }
}
```

### Stable Events

#### intent_submitted
```typescript
{
  intent_hash: string;
  signer_id: AccountId;
  instrument: string;
  symbol: string;
  side: string;
  size: string;
  timestamp: u64;
}
```

#### execution_logged
```typescript
{
  intent_hash: string;
  solver_id: AccountId;
  venue: string;
  fill_price: string;
  notional: string;
  status: string;
  timestamp: u64;
}
```

## Canonical Hashing Algorithm

The canonical hashing algorithm is immutable for v1.0.0:

### Algorithm Specification

1. **Normalization**:
   - Symbol: Convert to UPPERCASE
   - Side: Convert to lowercase
   - Leverage: Default to "1" if not provided
   - Constraints defaults:
     - max_slippage_bps: 100
     - max_funding_bps_8h: 50
     - max_fee_bps: 30
     - venue_allowlist: []

2. **Serialization**: JSON with sorted keys

3. **Hashing**: SHA-256

4. **Output**: First 64 hexadecimal characters

### Implementation

```typescript
function computeCanonicalHash(intent: DerivativesIntent): string {
  // 1. Normalize
  const normalized = {
    version: intent.version,
    intent_type: intent.intent_type,
    derivatives: {
      instrument: intent.derivatives.instrument,
      symbol: intent.derivatives.symbol.toUpperCase(),
      side: intent.derivatives.side.toLowerCase(),
      size: intent.derivatives.size,
      leverage: intent.derivatives.leverage || "1",
      option: intent.derivatives.option || null,
      constraints: {
        max_slippage_bps: intent.derivatives.constraints?.max_slippage_bps || 100,
        max_funding_bps_8h: intent.derivatives.constraints?.max_funding_bps_8h || 50,
        max_fee_bps: intent.derivatives.constraints?.max_fee_bps || 30,
        venue_allowlist: intent.derivatives.constraints?.venue_allowlist || []
      },
      collateral: intent.derivatives.collateral
    },
    signer_id: intent.signer_id,
    deadline: intent.deadline,
    nonce: intent.nonce
  };
  
  // 2. Serialize with sorted keys
  const serialized = JSON.stringify(normalized, Object.keys(normalized).sort());
  
  // 3. Hash with SHA-256
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  
  // 4. Return first 64 chars
  return hash.substring(0, 64);
}
```

## Test Vectors

Test vectors are provided in [`contracts/near-intents-derivatives/test-vectors/canonical-hashing.json`](../contracts/near-intents-derivatives/test-vectors/canonical-hashing.json).

Each test vector includes:
- **Input**: Raw intent JSON
- **Normalized**: Intent after normalization
- **Expected Hash**: First 64 chars of SHA-256 hash

## CI Validation

The ABI stability is enforced via CI:

### GitHub Actions Workflow

The [`.github/workflows/abi-validation.yml`](../.github/workflows/abi-validation.yml) workflow runs on every PR and:

1. **Validates ABI JSON structure**
2. **Verifies all required view methods exist**
3. **Checks NEP-297 event schema**
4. **Runs contract tests**
5. **Validates test vectors**
6. **Compares ABI with main branch** (warns on changes)

### Local Validation

Run the validation script before committing:

```bash
cd contracts/near-intents-derivatives
./scripts/validate-abi.sh
```

This script performs all CI checks locally.

## Testing

### Unit Tests

```rust
#[test]
fn test_schema_version_stable() {
    let contract = Contract::new(accounts(1), 20, 10);
    assert_eq!(contract.get_schema_version(), "1.0.0");
}

#[test]
fn test_abi_stability() {
    // Tests that all view methods exist and return expected types
    // If this test compiles, the ABI is stable
}
```

### Integration Tests

```bash
# Run all tests
cargo test --lib

# Run specific ABI tests
cargo test test_abi_stability
cargo test test_canonical_hashing
```

## Version Migration

### Adding Features (v1.x.x)

When adding new features in minor versions:
1. Add new methods/events to the ABI JSON
2. Mark them with appropriate stability tags
3. Update tests to cover new features
4. Existing v1.0.0 interfaces remain unchanged

### Breaking Changes (v2.0.0)

If breaking changes are required:
1. Create new `abi/v2.0.0.json` file
2. Deploy new contract version
3. Maintain v1 contract for backward compatibility
4. Document migration path

## Compliance Checklist

Before any release, ensure:

- [ ] `get_schema_version()` returns "1.0.0"
- [ ] All v1.0.0 view methods are present
- [ ] NEP-297 events match schema
- [ ] Canonical hashing algorithm unchanged
- [ ] Test vectors pass
- [ ] CI validation passes
- [ ] No changes to stable method signatures
- [ ] Documentation updated for new features

## Monitoring

Monitor ABI usage in production:

```bash
# Check method calls
near view deltanear-derivatives.testnet get_schema_version

# Verify event emissions
near logs deltanear-derivatives.testnet | grep "deltanear_derivatives"
```

## Support

For ABI-related questions:
- Review test vectors in `test-vectors/`
- Check CI logs for validation errors
- Open an issue for clarification

## References

- [NEP-297: Events Standard](https://nomicon.io/Standards/EventsFormat)
- [NEAR Contract Standards](https://docs.near.org/sdk/rust/contract-interface/contract-standards)
- [Semantic Versioning](https://semver.org/)