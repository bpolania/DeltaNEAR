# Conformance Test Corpus Requirements for DeltaNEAR v1.0.0

## Project Context

DeltaNEAR is a production-ready NEAR blockchain implementation for cross-chain derivatives execution via intents. The system has achieved its v1.0.0 "testnet-locked" milestone with:

- **Frozen ABI** with manifest hash: `4d1b6241b61316237252e7a03d4c406daf856397a898ce2638084a18c37a06cc`
- **RFC-8785 canonicalization** for deterministic intent hashing
- **Off-chain simulation gating** in the broker/solver path
- **1Click API integration** for intent distribution
- **Cross-chain venue adapters** (Drift Protocol for Solana)
- **131 tests passing** (130 passed, 1 skipped)

## Current State Summary

### Key Files and Locations

1. **Contract Implementation**:
   - Main contract: `contracts/near-intents-derivatives/src/lib.rs`
   - Canonicalization: `contracts/near-intents-derivatives/src/canonicalization.rs`
   - Events: `contracts/near-intents-derivatives/src/events.rs`
   - Manifest: `contracts/manifest-v1.0.0.json`

2. **Solver Infrastructure**:
   - Simulation gate: `services/solver-node/src/broker/simulation-gate.ts`
   - 1Click client: `services/solver-node/src/clients/oneclick-client.ts`
   - Venue adapters: `services/solver-node/src/venues/`

3. **Test Infrastructure**:
   - Integration tests: `services/solver-node/src/tests/integration/`
   - Security tests: `services/solver-node/src/tests/security/`
   - Unit tests: `services/solver-node/src/tests/unit/`

### Canonicalization Rules Implemented

The system implements RFC-8785-style JSON canonicalization with these specific rules:

1. **Key Ordering**: All object keys sorted lexicographically
2. **Number Format**: 
   - No trailing zeros after decimal point
   - No unnecessary decimal points
   - Scientific notation normalized
3. **String Normalization**: Unicode NFC normalization applied
4. **Timestamp Format**: ISO 8601 without milliseconds (`YYYY-MM-DDTHH:MM:SSZ`)
5. **Array Preservation**: Arrays maintain their original order
6. **No Whitespace**: No spaces, tabs, or newlines in canonical form

## New Requirement: Conformance Test Corpus

### Objective

Create a small, versioned test corpus that ANY integrator can clone and use to prove their implementation produces exactly the same bytes as the reference implementation. This ensures perfect interoperability across all integrators.

### Structure Requirements

```
conformance/
└── v1.0.0/
    ├── README.md
    ├── manifest.json (copy of contracts/manifest-v1.0.0.json)
    ├── canonical-hashing/
    │   ├── intent_minimal_perp/
    │   │   ├── raw.json
    │   │   ├── canonical.json
    │   │   └── expected.json
    │   ├── intent_minimal_option/
    │   │   ├── raw.json
    │   │   ├── canonical.json
    │   │   └── expected.json
    │   ├── intent_full_perp/
    │   │   ├── raw.json
    │   │   ├── canonical.json
    │   │   └── expected.json
    │   ├── intent_full_option/
    │   │   ├── raw.json
    │   │   ├── canonical.json
    │   │   └── expected.json
    │   ├── intent_with_metadata/
    │   │   ├── raw.json
    │   │   ├── canonical.json
    │   │   └── expected.json
    │   ├── intent_unicode_normalization/
    │   │   ├── raw.json
    │   │   ├── canonical.json
    │   │   └── expected.json
    │   └── intent_number_normalization/
    │       ├── raw.json
    │       ├── canonical.json
    │       └── expected.json
    └── solver-api/
        ├── quote_request_minimal/
        │   ├── raw.json
        │   ├── canonical.json
        │   └── expected.json
        ├── quote_request_full/
        │   ├── raw.json
        │   ├── canonical.json
        │   └── expected.json
        ├── quote_response_success/
        │   ├── raw.json
        │   ├── canonical.json
        │   └── expected.json
        ├── accept_request/
        │   ├── raw.json
        │   ├── canonical.json
        │   └── expected.json
        ├── accept_response_success/
        │   ├── raw.json
        │   ├── canonical.json
        │   └── expected.json
        └── settlement_tokendiff/
            ├── raw.json
            ├── canonical.json
            └── expected.json
```

### File Specifications

#### 1. `raw.json`
- The user-facing payload as produced by a wallet or frontend
- May contain:
  - Extra whitespace
  - Unordered keys
  - Trailing zeros in numbers
  - Milliseconds in timestamps
  - Unicode in decomposed form
  - Optional fields that should be omitted when empty

Example:
```json
{
  "derivatives": {
    "symbol": "ETH-USD",
    "instrument": "perp",
    "side": "long",
    "size": "1.50000",
    "leverage": "10.0"
  },
  "version": "1.0.0",
  "intent_type": "derivatives",
  "signer_id": "alice.testnet",
  "deadline": "2024-12-31T23:59:59.000Z",
  "nonce": "test-123",
  "metadata": {
    "notes": "café"
  }
}
```

#### 2. `canonical.json`
- The EXACT result after applying ALL canonicalization rules
- Must show:
  - Lexicographically sorted keys
  - Normalized numbers (no trailing zeros)
  - ISO 8601 timestamps without milliseconds
  - NFC normalized Unicode
  - No whitespace except in string values
  - Consistent field ordering

Example:
```json
{"deadline":"2024-12-31T23:59:59Z","derivatives":{"instrument":"perp","leverage":"10","side":"long","size":"1.5","symbol":"ETH-USD"},"intent_type":"derivatives","metadata":{"notes":"café"},"nonce":"test-123","signer_id":"alice.testnet","version":"1.0.0"}
```

#### 3. `expected.json`
- Records the expected results and metadata
- Pretty-printed for readability
- Contains:
  - `sha256`: Hash of UTF-8 encoded canonical.json
  - `intent_hash`: The derived intent hash
  - `manifest_hash`: The manifest hash used (always `4d1b6241b61316237252e7a03d4c406daf856397a898ce2638084a18c37a06cc` for v1.0.0)
  - `byte_length`: Length of canonical JSON in bytes
  - `normalization_notes`: Array of transformations applied

Example:
```json
{
  "sha256": "a7f3e9c2b4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
  "intent_hash": "7b3a9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
  "manifest_hash": "4d1b6241b61316237252e7a03d4c406daf856397a898ce2638084a18c37a06cc",
  "byte_length": 245,
  "normalization_notes": [
    "Removed trailing zeros from size: 1.50000 -> 1.5",
    "Removed trailing zero from leverage: 10.0 -> 10",
    "Removed milliseconds from deadline",
    "Applied NFC normalization to metadata.notes",
    "Sorted object keys lexicographically"
  ]
}
```

### Test Cases to Include

#### Canonical Hashing Vectors

1. **intent_minimal_perp**: Simplest valid perpetual intent
2. **intent_minimal_option**: Simplest valid option intent
3. **intent_full_perp**: Perpetual with all optional fields
4. **intent_full_option**: Option with strike, expiry, all fields
5. **intent_with_metadata**: Intent with complex metadata object
6. **intent_unicode_normalization**: Demonstrates NFC normalization
7. **intent_number_normalization**: Various number format normalizations

#### Solver API Vectors

1. **quote_request_minimal**: Basic quote request
2. **quote_request_full**: Quote with all preferences
3. **quote_response_success**: Successful quote response
4. **accept_request**: Intent acceptance with signature
5. **accept_response_success**: Successful acceptance
6. **settlement_tokendiff**: TokenDiff settlement structure

### Implementation Notes

1. **Determinism**: Every byte must be identical across implementations
2. **UTF-8 Encoding**: All strings use UTF-8 encoding before hashing
3. **Hash Algorithm**: SHA-256 for all hashes
4. **No Random Values**: Use stable, predictable test values
5. **Human-Readable**: Use meaningful names and values for easy debugging

### Validation Process

Integrators should:
1. Read each `raw.json`
2. Apply their canonicalization implementation
3. Compare byte-for-byte with `canonical.json`
4. Compute SHA-256 of their canonical output
5. Verify it matches `expected.json` values

### Version Management

- This corpus is versioned at `v1.0.0`
- Future versions go in `conformance/v2.0.0/` etc.
- Never modify existing test vectors
- Add new test cases only in new versions

## Implementation Tasks

When implementing this conformance test corpus:

1. **Create directory structure** under `conformance/v1.0.0/`
2. **Generate test vectors** using existing canonicalization code
3. **Validate vectors** against current implementation
4. **Document each test case** with clear descriptions
5. **Create validation script** that runs all tests
6. **Add to CI/CD** to ensure vectors remain valid

## Success Criteria

- Any integrator can clone the corpus
- Running their implementation against it produces identical bytes
- Test cases cover all edge cases and normalization rules
- Documentation is clear enough to implement from scratch
- Vectors serve as both tests and documentation

## Files to Reference

When implementing, reference these existing files:
- `contracts/near-intents-derivatives/src/canonicalization.rs` - Rust canonicalization
- `services/solver-node/src/tests/integration/1click-metadata-audit.test.ts` - JS canonicalization
- `contracts/manifest-v1.0.0.json` - The frozen manifest
- `docs/CANONICALIZATION_SPEC_V1.md` - Canonicalization specification

This conformance test corpus will ensure perfect interoperability across all DeltaNEAR integrators and serve as the authoritative reference for v1.0.0 compatibility.