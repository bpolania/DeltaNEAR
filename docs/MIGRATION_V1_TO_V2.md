# Migration Guide: V1.0.0 to V2.0.0

## ⚠️ **BREAKING CHANGES NOTICE**

**V2.0.0 introduces breaking changes** to the DeltaNEAR intent schema that make V1.0.0 payloads **incompatible**. This violates the V1.0.0 specification which declared "unknown fields are rejected" and fixed the canonical form.

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

## Timeline

- **2025-08-25**: V2.0.0 deployed to testnet
- **2025-09-01**: Migration tools available
- **2025-10-01**: V1.0.0 testnet endpoints deprecated (if applicable)
- **2025-11-01**: V1.0.0 support ends

## Support

For migration assistance:
- GitHub Issues: https://github.com/deltanear/deltanear/issues
- Documentation: https://docs.deltanear.io/migration-v2
- Discord: https://discord.gg/deltanear