# Migration Guide: V1.0.0 to V2.0.0

## ⚠️ **BREAKING CHANGES NOTICE**

**V2.0.0 introduces breaking changes** to the DeltaNEAR intent schema that make V1.0.0 payloads **incompatible**. This violates the V1.0.0 specification which declared "unknown fields are rejected" and fixed the canonical form.

## 📌 Schema Version vs. Manifest Version

DeltaNEAR distinguishes between two layers of versioning:

1. **Schema Version** (`version` field in JSON intent)
   - This reflects the intent payload format
   - In V2.0.0, the schema version remains `"1.0.0"` because the core Derivatives intent structure is still first-generation (instrument, symbol, side, size, option, collateral, constraints)
   - The `"version": "1.0.0"` inside intents is therefore not bumped unless the canonicalization rules or fundamental field set are redesigned

2. **Manifest / Contract Version** (`get_schema_version()` and `manifest-vX.Y.Z.json`)
   - This reflects the integration contract, ABI, and event schema freeze
   - With the removal of chain_id and introduction of explicit collateral and constraints, we had to publish manifest-v2.0.0.json
   - Contracts deployed under this manifest will return `"2.0.0"` from `get_schema_version()` and expose the corresponding ABI hash

### Why Keep `version: "1.0.0"`?
- **Backward compatibility**: Tools that generate `"version": "1.0.0"` can still work after migration with minor field adjustments
- **Clear separation**: Schema version describes payload structure, while manifest version describes on-chain ABI + events  
- **Future-proofing**: Only when we overhaul canonicalization (e.g., RFC 8785 changes, timestamp encoding, numeric precision rules) will we bump the schema version to `"2.0.0"`

This way, integrators understand that:
- `"version": "1.0.0"` inside payloads is still correct
- `get_schema_version() → "2.0.0"` is what their clients should check to know which manifest they are talking to

## What Changed

### Schema Structure Changes

#### V1.0.0 Structure (DEPRECATED):
```json
{
  "version": "1.0.0",
  "intent_type": "derivatives",
  "derivatives": {
    "instrument": "perp",
    "symbol": "ETH-USD", 
    "side": "long",
    "size": "1.5"
  },
  "chain_id": "near-testnet",    // ← REMOVED
  "signer_id": "user.testnet",
  "deadline": "2024-12-31T23:59:59Z",
  "nonce": "v1-intent-001"
}
```

#### V2.0.0 Structure (NEW):
```json
{
  "version": "1.0.0",
  "intent_type": "derivatives", 
  "derivatives": {
    "collateral": {              // ← NEW: Required object
      "chain": "arbitrum",       // ← Replaces chain_id
      "token": "USDC"            // ← NEW: Required
    },
    "constraints": {             // ← NEW: Required object  
      "max_fee_bps": 30,
      "max_funding_bps_8h": 50,
      "max_slippage_bps": 100,
      "venue_allowlist": []
    },
    "instrument": "perp",
    "symbol": "ETH-USD",
    "side": "long", 
    "size": "1.5"
  },
  "signer_id": "user.testnet",
  "deadline": "2024-12-31T23:59:59Z",
  "nonce": "v2-intent-001"
}
```

### Impact on Existing Systems

1. **Hash Incompatibility**: V1.0.0 intents produce different canonical hashes in V2.0.0
2. **Validation Failures**: V1.0.0 intents fail V2.0.0 validation (missing required fields)
3. **Contract Endpoints**: V2.0.0 contracts reject V1.0.0 payloads
4. **Conformance Vectors**: All V1.0.0 test vectors are invalid in V2.0.0

### Hash Continuity and Canonicalization

**Algorithm Unchanged**: V2.0.0 uses the same canonicalization algorithm as V1.0.0 (JSON.stringify with deterministic field ordering). Solvers do **not** need to swap out the hashing function itself.

**What Changed**: Only the normalized field structure differs:
- **V1.0.0**: `chain_id` at root level
- **V2.0.0**: `derivatives.collateral.{chain, token}` and `derivatives.constraints`

**Hash Impact**: Same intent content produces different hashes due to structural changes. For example:
- V1.0.0 hash: `abc123...` (includes `chain_id: "near-testnet"`)  
- V2.0.0 hash: `def456...` (includes `collateral: {chain: "near", token: "NEAR"}`)

**Migration Note**: The hashing logic in your codebase remains unchanged - only the input data structure requires updates.

## Migration Steps

### For Integration Partners

1. **Update Intent Creation**:
   ```typescript
   // OLD V1.0.0
   const oldIntent = {
     version: "1.0.0",
     intent_type: "derivatives",
     derivatives: { /* ... */ },
     chain_id: "near-testnet",  // Remove this
     // ...
   };

   // NEW V2.0.0  
   const newIntent = {
     version: "1.0.0",
     intent_type: "derivatives",
     derivatives: {
       collateral: {            // Add this
         chain: "near",
         token: "NEAR"
       },
       constraints: {           // Add this
         max_fee_bps: 30,
         max_funding_bps_8h: 50,
         max_slippage_bps: 100,
         venue_allowlist: []
       },
       // ... existing fields
     },
     // ... remove chain_id
   };
   ```

2. **Use Migration Utility**:
   ```bash
   # Install migration tool
   npm install @deltanear/migration-v2

   # Convert V1 to V2
   npx deltanear-migrate v1-to-v2 --input old-intent.json --output new-intent.json
   ```

### For Solver Implementations

1. **Update Validation Logic**: Accept only V2.0.0 format
2. **Update Hash Computation**: Use V2.0.0 canonicalization  
3. **Update Test Vectors**: Regenerate all conformance tests
4. **Update Contract Calls**: Use V2.0.0 endpoints

### Chain ID Mapping

| V1.0.0 chain_id | V2.0.0 collateral.chain |
|-----------------|-------------------------|
| `near-testnet` | `near` |
| `near-mainnet` | `near` |
| `arbitrum-testnet` | `arbitrum` |
| `arbitrum-mainnet` | `arbitrum` |
| `ethereum-testnet` | `ethereum` |
| `ethereum-mainnet` | `ethereum` |

### Default Constraints

All V2.0.0 intents must include explicit constraints. Use these defaults:

```json
{
  "max_fee_bps": 30,
  "max_funding_bps_8h": 50, 
  "max_slippage_bps": 100,
  "venue_allowlist": []
}
```

## Compatibility Support

### V1.0.0 Artifacts Preserved
- Original manifest-v1.0.0.json maintained
- V1.0.0 conformance vectors available in `/conformance/v1.0.0/`
- V1.0.0 documentation preserved in `/docs/v1.0.0/`

### Testnet Endpoints
- **V1.0.0**: `deltanear-v1-legacy.testnet` (if available)
- **V2.0.0**: `deltanear-v2-1756106334.testnet` (current)

### Migration Shim Available
```typescript
import { migrateV1ToV2 } from '@deltanear/migration';

const v1Intent = { /* your V1.0.0 intent */ };
const v2Intent = migrateV1ToV2(v1Intent, {
  defaultToken: 'USDC',
  defaultConstraints: { /* ... */ }
});
```

## Timeline and Deprecation Enforcement

### Migration Timeline
- **2025-08-25**: V2.0.0 deployed to testnet (`deltanear-v2-1756106334.testnet`)
- **2025-09-01**: Migration tools available in proto package
- **2025-10-01**: V1.0.0 testnet endpoints deprecated (no new deployments)
- **2025-11-01**: V1.0.0 support ends (contracts reject V1.0.0 payloads)

### Enforcement Strategy
**Contract-Level Rejection**: Starting 2025-11-01, V2.0.0 contracts will:
- Return validation errors for V1.0.0 payloads (missing `collateral`, `constraints` fields)
- Reject intents with `chain_id` field present
- Log deprecation warnings in contract events

**Tooling Support**: 
- V1.0.0 migration utilities remain available indefinitely  
- V1.0.0 conformance vectors preserved for reference
- Legacy documentation maintained at `/docs/v1.0.0/`

**Grace Period**: Between 2025-09-01 and 2025-11-01, both formats may be accepted in testing environments with deprecation warnings.

## Support

For migration assistance:
- GitHub Issues: https://github.com/deltanear/deltanear/issues
- Documentation: https://docs.deltanear.io/migration-v2
- Discord: https://discord.gg/deltanear