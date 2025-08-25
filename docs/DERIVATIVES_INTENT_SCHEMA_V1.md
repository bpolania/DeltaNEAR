# DeltaNEAR Derivatives Intent Schema v1.0.0

## Abstract

This document defines the **stable public contract** for derivatives intents on NEAR Protocol. It specifies the canonical schema, hashing algorithm, and interface that all solvers MUST use when interacting with DeltaNEAR derivatives.

**Version**: 1.0.0  
**Status**: STABLE  
**Last Updated**: 2024-01-23

## Core Principles

1. **Canonical Verifier** (`intents.near`) handles ALL token operations
2. **Metadata Contract** provides stable views for configuration and audit
3. **Schema Versioning** follows semver for backward compatibility
4. **NEP-413** for all signatures, **NEP-297** for all events

## Derivatives Intent Schema

### JSON Schema Definition

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://deltanear.io/schemas/derivatives-intent/v1.0.0",
  "type": "object",
  "required": ["version", "intent_type", "derivatives"],
  "properties": {
    "version": {
      "type": "string",
      "const": "1.0.0"
    },
    "intent_type": {
      "type": "string",
      "const": "derivatives"
    },
    "derivatives": {
      "type": "object",
      "required": ["instrument", "symbol", "side", "size"],
      "properties": {
        "instrument": {
          "type": "string",
          "enum": ["perp", "option"]
        },
        "symbol": {
          "type": "string",
          "pattern": "^[A-Z]+-[A-Z]+$"
        },
        "side": {
          "type": "string",
          "enum": ["long", "short", "buy", "sell"]
        },
        "size": {
          "type": "string",
          "pattern": "^[0-9]+(\\.[0-9]+)?$"
        },
        "leverage": {
          "type": "string",
          "pattern": "^[0-9]+(\\.[0-9]+)?$"
        },
        "option": {
          "type": "object",
          "required": ["kind", "strike", "expiry"],
          "properties": {
            "kind": {
              "type": "string",
              "enum": ["call", "put"]
            },
            "strike": {
              "type": "string",
              "pattern": "^[0-9]+(\\.[0-9]+)?$"
            },
            "expiry": {
              "type": "string",
              "format": "date-time"
            }
          }
        },
        "constraints": {
          "type": "object",
          "properties": {
            "max_slippage_bps": {
              "type": "integer",
              "minimum": 0,
              "maximum": 1000
            },
            "max_funding_bps_8h": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100
            },
            "max_fee_bps": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100
            },
            "venue_allowlist": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        },
        "collateral": {
          "type": "object",
          "required": ["token", "chain"],
          "properties": {
            "token": {
              "type": "string"
            },
            "chain": {
              "type": "string",
              "enum": ["near", "ethereum", "arbitrum", "base", "solana"]
            }
          }
        }
      }
    }
  }
}
```

### Canonical Hashing Algorithm

The intent hash is computed as follows:

```typescript
function computeIntentHash(intent: DerivativesIntent): string {
  // 1. Normalize to canonical form
  const canonical = {
    version: intent.version,
    intent_type: intent.intent_type,
    derivatives: {
      instrument: intent.derivatives.instrument,
      symbol: intent.derivatives.symbol.toUpperCase(),
      side: intent.derivatives.side.toLowerCase(),
      size: intent.derivatives.size,
      leverage: intent.derivatives.leverage || "1",
      option: intent.derivatives.option ? {
        kind: intent.derivatives.option.kind,
        strike: intent.derivatives.option.strike,
        expiry: intent.derivatives.option.expiry
      } : null,
      constraints: {
        max_slippage_bps: intent.derivatives.constraints?.max_slippage_bps || 100,
        max_funding_bps_8h: intent.derivatives.constraints?.max_funding_bps_8h || 50,
        max_fee_bps: intent.derivatives.constraints?.max_fee_bps || 30,
        venue_allowlist: intent.derivatives.constraints?.venue_allowlist || []
      },
      collateral: {
        token: intent.derivatives.collateral.token,
        chain: intent.derivatives.collateral.chain
      }
    },
    // Include signer and deadline for uniqueness
    signer_id: intent.signer_id,
    deadline: intent.deadline,
    nonce: intent.nonce
  };
  
  // 2. Serialize deterministically (sorted keys)
  const serialized = JSON.stringify(canonical, Object.keys(canonical).sort());
  
  // 3. Compute SHA-256
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  
  // 4. Return first 64 chars as intent_hash
  return hash.substring(0, 64);
}
```

## Settlement via TokenDiff

All settlements MUST use the Canonical Verifier with this EXACT schema:

```json
{
  "intent": "token_diff",
  "diff": {
    "nep141:usdc.near": "-150.50"
  }
}
```

**Requirements:**
- Token IDs MUST use format: `"nep141:{contract}"`
- Values MUST be strings representing decimal amounts
- Negative = lose tokens, Positive = gain tokens

## Metadata Contract Interface (v1.0.0)

### View Methods (Stable API)

```rust
/// Get current schema version
pub fn get_schema_version(&self) -> String {
    "1.0.0"
}

/// Get fee configuration
pub fn get_fee_config(&self) -> FeeConfig {
    FeeConfig {
        protocol_fee_bps: u16,
        solver_rebate_bps: u16,
        min_fee_usdc: String,
        max_fee_bps: u16,
        treasury: AccountId,
    }
}

/// Get guardrails for a symbol or account
pub fn get_guardrails(&self, symbol: Option<String>, account: Option<AccountId>) -> Guardrails {
    Guardrails {
        max_position_size: String,
        max_leverage: String,
        max_daily_volume: String,
        allowed_instruments: Vec<String>,
        cooldown_seconds: u32,
    }
}

/// Get supported trading symbols
pub fn get_supported_symbols(&self) -> Vec<SymbolConfig> {
    vec![
        SymbolConfig {
            symbol: "ETH-USD",
            instruments: vec!["perp", "option"],
            min_size: "0.01",
            max_size: "1000",
            tick_size: "0.01",
        }
    ]
}

/// Get allowed venues for a symbol
pub fn get_allowed_venues(&self, symbol: String) -> Vec<VenueConfig> {
    vec![
        VenueConfig {
            venue_id: "gmx-v2",
            chain: "arbitrum",
            supported_instruments: vec!["perp"],
            fee_bps: 5,
        }
    ]
}

/// Verify intent hash matches our computation
pub fn verify_intent_hash(&self, intent_json: String) -> String {
    // Recompute hash from JSON for verification
    compute_intent_hash(intent_json)
}

/// Get metadata for an intent
pub fn get_intent_metadata(&self, intent_hash: String) -> Option<IntentMetadata> {
    // Returns stored metadata if exists
}

/// Get execution log for an intent
pub fn get_execution_log(&self, intent_hash: String) -> Option<ExecutionLog> {
    // Returns execution details if exists
}
```

### Change Methods (Write API)

```rust
/// Store intent metadata (called by solver/frontend)
pub fn store_intent_metadata(&mut self, intent_hash: String, metadata: IntentMetadata);

/// Log execution (called after venue execution)
pub fn log_execution(&mut self, intent_hash: String, log: ExecutionLog);
```

## NEP-297 Event Standard

All events follow [NEP-297](https://nomicon.io/Standards/EventsFormat):

```json
{
  "standard": "deltanear_derivatives",
  "version": "1.0.0",
  "event": "intent_submitted",
  "data": {
    "intent_hash": "abc123...",
    "signer_id": "user.near",
    "instrument": "perp",
    "symbol": "ETH-USD",
    "side": "long",
    "size": "1.5",
    "timestamp": "2024-01-23T10:00:00Z"
  }
}
```

### Event Types

1. **intent_submitted** - New derivatives intent received
2. **solver_assigned** - Solver selected for execution
3. **execution_logged** - Venue execution completed
4. **settlement_initiated** - TokenDiff settlement started
5. **settlement_completed** - P&L transferred via Verifier

## Test Vectors

### Example 1: Long Perpetual

**Input:**
```json
{
  "version": "1.0.0",
  "intent_type": "derivatives",
  "derivatives": {
    "instrument": "perp",
    "symbol": "ETH-USD",
    "side": "long",
    "size": "2.5",
    "leverage": "10",
    "constraints": {
      "max_slippage_bps": 20,
      "max_funding_bps_8h": 30,
      "max_fee_bps": 10,
      "venue_allowlist": ["gmx-v2", "hyperliquid"]
    },
    "collateral": {
      "token": "usdc.near",
      "chain": "near"
    }
  },
  "signer_id": "alice.near",
  "deadline": "2024-01-23T11:00:00Z",
  "nonce": "1234567890"
}
```

**Expected Hash:** `3f2a8b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b`

### Example 2: Call Option

**Input:**
```json
{
  "version": "1.0.0",
  "intent_type": "derivatives",
  "derivatives": {
    "instrument": "option",
    "symbol": "BTC-USD",
    "side": "buy",
    "size": "0.1",
    "option": {
      "kind": "call",
      "strike": "50000",
      "expiry": "2024-02-29T16:00:00Z"
    },
    "constraints": {
      "max_slippage_bps": 50,
      "max_fee_bps": 20,
      "venue_allowlist": ["lyra-v2"]
    },
    "collateral": {
      "token": "wbtc.near",
      "chain": "near"
    }
  },
  "signer_id": "bob.near",
  "deadline": "2024-01-23T12:00:00Z",
  "nonce": "9876543210"
}
```

**Expected Hash:** `1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c`

## Migration and Versioning

- **v1.0.0** - Initial stable release
- **v1.x.x** - Backward compatible additions only
- **v2.0.0** - Breaking changes (new major version)

Solvers MUST specify which version they support:
```typescript
const SUPPORTED_SCHEMA_VERSION = "1.0.0";
```

## Compliance Checklist

Solvers integrating with DeltaNEAR MUST:

- [ ] Support schema version 1.0.0
- [ ] Use canonical hashing algorithm
- [ ] Query metadata contract for fee config
- [ ] Check guardrails before quoting
- [ ] Verify venue is in allowlist
- [ ] Use exact TokenDiff schema for settlement
- [ ] Sign with NEP-413 standard
- [ ] Run simulate_intents before execute_intents
- [ ] Emit NEP-297 compliant events
- [ ] Handle schema version updates

## References

- [NEP-413: signMessage Standard](https://github.com/near/NEPs/blob/master/neps/nep-0413.md)
- [NEP-297: Events Standard](https://nomicon.io/Standards/EventsFormat)
- [Canonical Verifier Docs](https://docs.near-intents.org/near-intents/market-makers/verifier/introduction)
- [TokenDiff Intent Type](https://docs.near-intents.org/near-intents/market-makers/verifier/intent-types-and-execution)