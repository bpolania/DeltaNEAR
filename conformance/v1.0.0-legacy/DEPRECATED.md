# DeltaNEAR V1.0.0 Legacy Artifacts

## ⚠️ DEPRECATED - PRESERVED FOR REFERENCE

This directory contains the **legacy V1.0.0** specification artifacts that are **no longer supported** in the current V2.0.0 implementation.

**Status**: DEPRECATED as of 2025-08-25  
**Replacement**: V2.0.0 specification in `/conformance/v2.0.0/`

## Breaking Changes in V2.0.0

The V2.0.0 release introduced **breaking changes** that violate the V1.0.0 frozen specification:

1. **Schema Structure**: `chain_id` → `derivatives.collateral.{chain, token}`
2. **Required Fields**: Added mandatory `derivatives.constraints`
3. **Canonical Hashing**: V1.0.0 intents produce different hashes in V2.0.0
4. **Validation**: V1.0.0 intents fail V2.0.0 validation

## What's Preserved Here

- Original V1.0.0 conformance test vectors
- V1.0.0 canonical hashing examples
- V1.0.0 validation rules
- V1.0.0 manifest specification

## Migration

To migrate from V1.0.0 to V2.0.0:

```bash
# Use the migration utility
node scripts/migrate-v1-to-v2.js --input v1-intent.json --output v2-intent.json --token USDC
```

See [MIGRATION_V1_TO_V2.md](../../docs/MIGRATION_V1_TO_V2.md) for full migration guide.

## Support Status

- **V1.0.0**: No longer supported
- **V2.0.0**: Current active version
- **Migration Tools**: Available in `/scripts/`

## Historical Reference

This preserves the V1.0.0 "unknown fields are rejected" promise and canonical form specification that was active until 2025-08-25.