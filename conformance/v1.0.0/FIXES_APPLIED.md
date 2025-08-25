# Conformance Test Corpus Fixes Applied

## Critical Issues Fixed

### 1. ✅ **Added Required `collateral` Field**
- **Before**: Test vectors missing mandatory `collateral` field
- **After**: All intents now include `collateral` object with `token` and `chain`
- **Impact**: Vectors now pass Rust validation requirement

### 2. ✅ **Fixed Option Structure**
- **Before**: Option parameters (`strike`, `expiry`) directly in derivatives object
- **After**: Proper `option` object containing `kind`, `strike`, `expiry`
- **Impact**: Options now match Rust schema exactly

### 3. ✅ **Added Constraints Object**
- **Before**: Constraint fields (`max_slippage`, `limit_price`) scattered in derivatives
- **After**: Proper `constraints` object with `max_slippage_bps`, `max_fee_bps`, etc.
- **Impact**: Constraints now use correct structure with defaults

### 4. ✅ **Removed Root-Level Metadata**
- **Before**: Test vectors included `metadata` at root level
- **After**: No metadata field (not allowed in Rust implementation)
- **Impact**: Vectors now match strict Rust field validation

### 5. ✅ **Added Negative Test Vectors**
- **Before**: No rejection test cases
- **After**: 4 negative tests for common validation failures
- **Impact**: Integrators can test error handling

## Schema Corrections

### Derivatives Object Structure (Rust-compliant):
```json
{
  "collateral": {          // REQUIRED
    "chain": "near",       // lowercase
    "token": "USDC"        // preserve case
  },
  "constraints": {         // Always present with defaults
    "max_fee_bps": 30,
    "max_funding_bps_8h": 50,
    "max_slippage_bps": 100,
    "venue_allowlist": []
  },
  "instrument": "perp",    // lowercase: perp|option
  "leverage": "1",         // default "1"
  "option": null,          // null for perps, object for options
  "side": "long",          // lowercase
  "size": "1.5",          // canonical decimal
  "symbol": "ETH-USD"     // UPPERCASE
}
```

### Option Object Structure:
```json
{
  "expiry": "2024-12-31T00:00:00Z",  // ISO 8601, no milliseconds
  "kind": "call",                     // lowercase: call|put
  "strike": "50000"                   // canonical decimal
}
```

## Test Vector Statistics

### Current Test Corpus:
- **Canonical Hashing**: 7 positive tests
- **Solver API**: 6 tests
- **Negative Tests**: 4 rejection cases
- **Total**: 17 test vectors

### Validation Results:
- ✅ All 17 tests pass with Rust-compatible canonicalizer
- ✅ Negative tests correctly rejected with appropriate errors
- ✅ Byte-for-byte canonical form matches expected

## Files Updated

### Core Files:
1. `generate-vectors-fixed.js` - New generator matching Rust implementation
2. `validate-fixed.js` - New validator with Rust-compatible canonicalizer
3. All test vectors regenerated with correct schema

### Removed Files:
- `intent_with_metadata` - Had invalid root-level metadata
- Old generator/validator scripts (superseded by fixed versions)

## Conformance Guarantee

The test vectors now:
1. **Match Rust canonicalization exactly** - Same field order, validation, normalization
2. **Include all required fields** - No missing `collateral` or malformed options
3. **Reject invalid inputs** - Negative tests verify proper error handling
4. **Use correct data types** - Numbers as strings, proper decimal formatting

## Next Steps for Integrators

1. Use `validate-fixed.js` as reference implementation
2. Implement the exact validation rules from Rust
3. Test against both positive and negative vectors
4. Ensure byte-for-byte canonical form matches

The conformance test corpus is now fully compatible with the DeltaNEAR v1.0.0 Rust implementation.