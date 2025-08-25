# DeltaNEAR V2.0.0 Conformance Test Corpus

## Overview

This directory contains the **official conformance test vectors** for DeltaNEAR V2.0.0 specification.

⚠️ **BREAKING CHANGE NOTICE**: V2.0.0 introduces breaking changes from V1.0.0. See [MIGRATION_V1_TO_V2.md](../../docs/MIGRATION_V1_TO_V2.md) for details.

## Specification Version

- **Manifest Version**: 2.0.0
- **Schema Version**: 2.0.0 
- **ABI Hash**: `67e4874cb41e405be0d3e532341adace4137cb30d59b42cb480823624bb4503f`
- **Release Date**: 2025-08-25

## Key Changes from V1.0.0

1. **Replaced** `chain_id` with `derivatives.collateral.{chain, token}`
2. **Added** required `derivatives.constraints` object
3. **Introduced** cross-chain collateral support
4. **Breaking** canonical hashing changes

## Directory Structure

```
conformance/v2.0.0/
├── README.md                    # This file
├── manifest.json               # V2.0.0 specification manifest
├── canonical-hashing/          # Canonical form test vectors
│   ├── intent_v2_perp/        # Basic V2 perp intent
│   ├── intent_v2_option/      # Basic V2 option intent
│   ├── intent_cross_chain/    # Cross-chain collateral tests
│   └── intent_constraints/    # Constraint validation tests
└── solver-api/                # Solver API test vectors (TBD)
```

## Test Vector Format

Each test case contains:
- `raw.json` - Input intent in standard form
- `canonical.json` - Canonical representation 
- `expected.json` - Expected hash and validation results

## Usage

```bash
# Validate V2.0.0 intent
node scripts/validate-v2.js conformance/v2.0.0/canonical-hashing/intent_v2_perp/raw.json

# Generate V2.0.0 test vectors  
node conformance/v2.0.0/generate-vectors.js
```

## Compatibility

- **V1.0.0 Incompatible**: V1.0.0 test vectors will fail in V2.0.0
- **Migration Required**: Use `scripts/migrate-v1-to-v2.js` for conversion
- **Hash Breaking**: V2.0.0 produces different hashes than V1.0.0 for equivalent intents