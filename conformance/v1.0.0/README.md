# DeltaNEAR Conformance Test Corpus v1.0.0

This conformance test corpus provides standardized test vectors for validating DeltaNEAR implementations. Any integrator can use these test vectors to ensure their implementation produces byte-for-byte identical results with the reference implementation.

## Version Information

- **Version**: v1.0.0
- **Manifest Hash**: `4d1b6241b61316237252e7a03d4c406daf856397a898ce2638084a18c37a06cc`
- **Canonicalization**: RFC-8785 compliant
- **Hash Algorithm**: SHA-256

## Directory Structure

```
conformance/v1.0.0/
├── README.md (this file)
├── manifest.json (frozen ABI manifest)
├── canonical-hashing/
│   ├── intent_minimal_perp/
│   ├── intent_minimal_option/
│   ├── intent_full_perp/
│   ├── intent_full_option/
│   ├── intent_with_metadata/
│   ├── intent_unicode_normalization/
│   └── intent_number_normalization/
└── solver-api/
    ├── quote_request_minimal/
    ├── quote_request_full/
    ├── quote_response_success/
    ├── accept_request/
    ├── accept_response_success/
    └── settlement_tokendiff/
```

## Test Vector Format

Each test case directory contains three files:

### 1. `raw.json`
The user-facing payload as it might be produced by a wallet or frontend, including:
- Extra whitespace
- Unordered keys
- Trailing zeros in numbers
- Milliseconds in timestamps
- Unicode in decomposed form

### 2. `canonical.json`
The exact result after applying all canonicalization rules:
- Lexicographically sorted keys
- Normalized numbers (no trailing zeros)
- ISO 8601 timestamps without milliseconds
- NFC normalized Unicode
- No whitespace except in string values

### 3. `expected.json`
Contains expected results and metadata:
- `sha256`: Hash of UTF-8 encoded canonical.json
- `intent_hash`: The derived intent hash
- `manifest_hash`: The manifest hash used
- `byte_length`: Length of canonical JSON in bytes
- `normalization_notes`: Array of transformations applied

## Canonicalization Rules

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

## Test Cases

### Canonical Hashing Vectors

1. **intent_minimal_perp**: Simplest valid perpetual intent
2. **intent_minimal_option**: Simplest valid option intent
3. **intent_full_perp**: Perpetual with all optional fields
4. **intent_full_option**: Option with strike, expiry, all fields
5. **intent_with_metadata**: Intent with complex metadata object
6. **intent_unicode_normalization**: Demonstrates NFC normalization
7. **intent_number_normalization**: Various number format normalizations

### Solver API Vectors

1. **quote_request_minimal**: Basic quote request
2. **quote_request_full**: Quote with all preferences
3. **quote_response_success**: Successful quote response
4. **accept_request**: Intent acceptance with signature
5. **accept_response_success**: Successful acceptance
6. **settlement_tokendiff**: TokenDiff settlement structure

## Validation Process

To validate your implementation:

1. Read each `raw.json` file
2. Apply your canonicalization implementation
3. Compare byte-for-byte with `canonical.json`
4. Compute SHA-256 of your canonical output
5. Verify it matches values in `expected.json`

## Running the Validation Script

A validation script is provided to test all vectors:

```bash
node conformance/v1.0.0/validate.js
```

This will:
- Load all test vectors
- Apply canonicalization
- Compare results
- Report any discrepancies

## Implementation Notes

- **Determinism**: Every byte must be identical across implementations
- **UTF-8 Encoding**: All strings use UTF-8 encoding before hashing
- **No Random Values**: Test values are stable and predictable
- **Human-Readable**: Meaningful names and values for easy debugging

## Version Management

- This corpus is versioned at `v1.0.0`
- Future versions will be placed in `conformance/v2.0.0/` etc.
- Never modify existing test vectors
- Add new test cases only in new versions

## Success Criteria

An implementation is considered conformant when:
- All test vectors produce identical canonical forms
- All SHA-256 hashes match expected values
- Intent hashes are correctly derived
- No test cases fail

## Reference Implementation

The reference implementation can be found in:
- Rust: `contracts/near-intents-derivatives/src/canonicalization.rs`
- TypeScript: `services/solver-node/src/tests/integration/1click-metadata-audit.test.ts`

## Support

For questions or issues with the conformance test corpus, please refer to the DeltaNEAR documentation or contact the development team.