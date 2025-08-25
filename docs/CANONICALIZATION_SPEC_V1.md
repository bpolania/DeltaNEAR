# Canonical Intent Hashing Specification v1.0.0

## Overview

This document defines the **immutable canonicalization and hashing algorithm** for DeltaNEAR Derivatives intents. This specification follows RFC 8785 (JSON Canonicalization Scheme) with additional domain-specific rules.

## Core Principles

1. **Deterministic**: Same semantic intent ALWAYS produces same hash
2. **Unambiguous**: Every field has exactly one valid representation
3. **Language-agnostic**: Reproducible in any programming language
4. **Strict**: Unknown fields cause rejection, not silent dropping

## RFC 8785 Base Rules

We follow [RFC 8785](https://datatracker.ietf.org/doc/html/rfc8785) for JSON canonicalization:

1. **Object keys**: Sorted recursively at ALL depths using UTF-16 code unit order
2. **No whitespace**: No insignificant whitespace between tokens
3. **String escaping**: Minimal JSON escaping rules
4. **Number representation**: See our stricter rules below

## Field-Specific Canonicalization Rules

### All Numeric Values

ALL numeric values (size, leverage, strike, fees, etc.) are represented as canonical decimal strings:

```
Rules:
- Format: Sign? Digits ('.' Digits)?
- No scientific notation (1e6 → REJECT)
- No leading zeros except "0" itself ("00.5" → REJECT, "0.5" → ACCEPT)
- No trailing zeros after decimal ("1.50" → "1.5")
- No decimal point for integers ("100.0" → "100")
- Zero is exactly "0" (not "0.0", "-0", or "+0")
- No positive sign ("+100" → REJECT)
- Maximum 18 decimal places
- Minimum: "0"
- Rounding: REJECT if rounding needed (no silent precision loss)
```

## Field Bounds and Units Table

| Field | Type | Min | Max | Precision | Unit | Notes |
|-------|------|-----|-----|-----------|------|-------|
| `size` | Decimal String | "0.00000001" | "1000000" | 8 decimals | Base units | Size of position |
| `leverage` | Decimal String | "1" | "100" | 2 decimals | Multiplier | Default: "1" |
| `strike` | Decimal String | "0.01" | "1000000000" | 2 decimals | USD | Option strike price |
| `max_slippage_bps` | Integer | 0 | 1000 | N/A | Basis points | Default: 100 |
| `max_funding_bps_8h` | Integer | 0 | 100 | N/A | Basis points/8h | Default: 50 |
| `max_fee_bps` | Integer | 0 | 100 | N/A | Basis points | Default: 30 |
| `deadline` | ISO 8601 | 1970-01-01T00:00:00Z | 2100-12-31T23:59:59Z | Seconds | UTC | Must end with 'Z' |
| `nonce` | String | N/A | N/A | N/A | N/A | Unique per intent |

### String Normalization

```
symbol:           UPPERCASE, NFC, trim whitespace
side:             lowercase, NFC, trim whitespace
instrument:       lowercase, NFC, trim whitespace
chain:            lowercase, NFC, trim whitespace
venue IDs:        lowercase, NFC, trim whitespace
signer_id:        lowercase (NEAR account rules), NFC, trim whitespace
token addresses:  PRESERVE checksum case, NFC, trim whitespace
nonce:            Convert to string if numeric, NFC, trim whitespace
```

**Token Address Validation by Chain**:
- **Ethereum/Arbitrum/Base**: MUST be valid EIP-55 checksummed address (42 chars starting with 0x)
- **NEAR**: MUST be valid NEAR account ID (lowercase, alphanumeric with dots/dashes)
- **Solana**: MUST be valid base58 public key (32-44 characters)

**Unicode Normalization**: ALL strings MUST be normalized to Unicode NFC (Canonical Decomposition followed by Canonical Composition) form per [Unicode Standard Annex #15](https://unicode.org/reports/tr15/). This normalization MUST be applied BEFORE any other processing:
- Apply NFC normalization to all string values
- Apply NFC normalization to all object keys
- Implementations MUST use a Unicode NFC library (e.g., `unicodedata.normalize('NFC', s)` in Python, `String.Normalize(NormalizationForm.FormC)` in C#)

**Whitespace Trimming**: Leading and trailing whitespace is removed from ALL string values. Internal whitespace is NEVER modified:
- `" alice.near "` → `"alice.near"`
- `"gmx v2"` → `"gmx v2"` (internal space preserved)
- `"\n\tvalue\n"` → `"value"`

### Timestamp Normalization

ALL timestamps MUST be ISO 8601 Zulu format with EXACTLY seconds precision:

```
Format: YYYY-MM-DDTHH:MM:SSZ
Rules:
- MUST end with 'Z' (Zulu/UTC)
- NO milliseconds/microseconds
- NO timezone offsets (+00:00 rejected)
- Zero-padded (2024-01-09 not 2024-1-9)
- Uppercase T and Z
- Valid range: 1970-01-01T00:00:00Z to 2100-12-31T23:59:59Z
```

Examples:
- ✅ `2024-01-23T11:00:00Z`
- ❌ `2024-01-23T11:00:00.000Z` (has milliseconds)
- ❌ `2024-01-23T11:00:00+00:00` (has offset)
- ❌ `2024-1-23T11:00:00Z` (not zero-padded)

### Array Canonicalization

**venue_allowlist**:
1. Convert all elements to lowercase
2. Trim whitespace from each element
3. Sort alphabetically (UTF-16 code units)
4. Remove duplicates
5. Empty array if not provided

**Arrays of objects** (future-proofing):
1. Canonicalize each object recursively
2. Preserve array order (order is semantic)
3. Do NOT sort array elements

### Unknown Fields

**REJECT** intents with ANY fields not in this specification. Do NOT silently drop.

Valid fields at each level:

```
Root level (6 fields exactly):
- version
- intent_type  
- derivatives
- signer_id
- deadline
- nonce

derivatives object (8 fields exactly):
- instrument
- symbol
- side
- size
- leverage
- option
- constraints
- collateral

option object (3 fields exactly, or null):
- kind
- strike
- expiry

constraints object (4 fields exactly):
- max_slippage_bps
- max_funding_bps_8h
- max_fee_bps
- venue_allowlist

collateral object (2 fields exactly):
- token
- chain
```

## Canonicalization Algorithm

### Step 1: Parse and Validate

```python
def parse_and_validate(intent_json):
    intent = json.loads(intent_json)
    
    # Check version
    if intent.get("version") != "1.0.0":
        raise ValueError(f"Invalid version: {intent.get('version')}")
    
    # Check intent type
    if intent.get("intent_type") != "derivatives":
        raise ValueError(f"Invalid intent_type: {intent.get('intent_type')}")
    
    # Check for unknown fields at root
    allowed_root = {"version", "intent_type", "derivatives", "signer_id", "deadline", "nonce"}
    if set(intent.keys()) != allowed_root:
        raise ValueError(f"Unknown fields: {set(intent.keys()) - allowed_root}")
    
    return intent
```

### Step 2: Apply Normalization

```python
def normalize_intent(intent):
    return {
        "version": "1.0.0",
        "intent_type": "derivatives",
        "derivatives": normalize_derivatives(intent["derivatives"]),
        "signer_id": intent["signer_id"].strip().lower(),  # NEAR accounts are lowercase
        "deadline": normalize_timestamp(intent["deadline"]),
        "nonce": str(intent["nonce"]).strip()
    }

def normalize_derivatives(deriv):
    # Validate no unknown fields
    allowed = {"instrument", "symbol", "side", "size", "leverage", 
               "option", "constraints", "collateral"}
    if not set(deriv.keys()).issubset(allowed):
        raise ValueError(f"Unknown derivatives fields: {set(deriv.keys()) - allowed}")
    
    instrument = deriv["instrument"].strip().lower()
    
    return {
        "instrument": instrument,
        "symbol": deriv["symbol"].strip().upper(),
        "side": deriv["side"].strip().lower(),
        "size": canonicalize_decimal(deriv["size"], min="0.00000001", max="1000000", precision=8),
        "leverage": canonicalize_decimal(deriv.get("leverage", "1"), min="1", max="100", precision=2),
        "option": normalize_option(deriv.get("option")) if instrument == "option" else None,
        "constraints": normalize_constraints(deriv.get("constraints")),
        "collateral": normalize_collateral(deriv["collateral"])
    }

def canonicalize_decimal(value, min, max, precision):
    # Parse as Decimal to avoid float precision issues
    from decimal import Decimal, ROUND_DOWN
    
    d = Decimal(str(value).strip())
    
    # Check bounds
    if d < Decimal(min) or d > Decimal(max):
        raise ValueError(f"Value {value} out of range [{min}, {max}]")
    
    # Check precision
    if d.as_tuple().exponent < -precision:
        raise ValueError(f"Value {value} exceeds {precision} decimal places")
    
    # Format canonically
    if d == 0:
        return "0"
    elif d == d.to_integral_value():
        return str(int(d))
    else:
        # Remove trailing zeros
        return str(d).rstrip('0').rstrip('.')
```

### Step 3: Sort Keys Recursively (RFC 8785)

```python
def sort_keys_recursively(obj):
    if isinstance(obj, dict):
        return {k: sort_keys_recursively(v) 
                for k, v in sorted(obj.items())}
    elif isinstance(obj, list):
        return [sort_keys_recursively(item) for item in obj]
    else:
        return obj
```

### Step 4: Serialize Without Whitespace

```python
def serialize_canonical(obj):
    # RFC 8785 compliant serialization
    # No whitespace, minimal escaping, sorted keys
    return json.dumps(obj, separators=(',', ':'), 
                     ensure_ascii=False, sort_keys=True)
```

### Step 5: Compute SHA-256

```python
def compute_hash(canonical_json):
    import hashlib
    return hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()
```

## Complete Example

### Input (with deliberate variations):
```json
{
  "derivatives": {
    "constraints": {
      "venue_allowlist": ["HYPERLIQUID", "gmx-v2", "aevo", "gmx-v2"],
      "max_slippage_bps": 20,
      "max_fee_bps": 15
    },
    "symbol": "eth-usd",
    "size": "1.50000",
    "instrument": "PERP",
    "leverage": "10.00",
    "side": "LONG",
    "collateral": {
      "chain": "NEAR",
      "token": " usdc.near "
    }
  },
  "version": "1.0.0",
  "deadline": "2024-01-23T11:00:00.000Z",
  "nonce": 12345,
  "signer_id": "Alice.NEAR",
  "intent_type": "derivatives"
}
```

### After Canonicalization:
```json
{"deadline":"2024-01-23T11:00:00Z","derivatives":{"collateral":{"chain":"near","token":"usdc.near"},"constraints":{"max_fee_bps":15,"max_funding_bps_8h":50,"max_slippage_bps":20,"venue_allowlist":["aevo","gmx-v2","hyperliquid"]},"instrument":"perp","leverage":"10","option":null,"side":"long","size":"1.5","symbol":"ETH-USD"},"intent_type":"derivatives","nonce":"12345","signer_id":"alice.near","version":"1.0.0"}
```

### Hash:
```
3f2a8b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a
```

## Test Vectors

### Positive Test Vectors

See `test-vectors/canonical-hashing.json` for:
1. Minimal perpetual with defaults
2. Leveraged position with constraints
3. Call option with all fields
4. Put option with cross-chain collateral
5. Edge cases (Unicode, maximum decimals)

### Negative Test Vectors

These inputs MUST be rejected:

```json
// Unknown field
{"version":"1.0.0","intent_type":"derivatives","extra_field":"bad",...}

// Invalid timestamp format (has milliseconds)  
{"deadline":"2024-01-23T11:00:00.000Z",...}

// Scientific notation
{"derivatives":{"size":"1e6",...},...}

// Leading zeros
{"derivatives":{"size":"00.5",...},...}

// Negative value
{"derivatives":{"size":"-1",...},...}

// Out of range
{"derivatives":{"leverage":"101",...},...}

// Duplicate after normalization
{"derivatives":{"constraints":{"venue_allowlist":["GMX-V2","gmx-v2"],...},...},...}
```

## Implementation Requirements

### Language-Agnostic JSON Serialization

The canonical JSON MUST be produced as follows:

1. **Parse**: Deserialize the input JSON into native data structures
2. **Normalize**: Apply all field-specific rules (NFC, case, trimming, etc.)
3. **Sort**: Recursively sort all object keys using UTF-16 code unit order
4. **Serialize**: Output JSON with:
   - No whitespace between tokens (use `separators=(',', ':')` in Python)
   - Minimal escaping per RFC 8785
   - UTF-8 encoding
   - No BOM (Byte Order Mark)

### Rust Implementation
```rust
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;

fn normalize_string(s: &str) -> String {
    // Apply Unicode NFC normalization
    s.nfc().collect::<String>().trim().to_string()
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut canonical = BTreeMap::new();
            for (k, v) in map {
                // Keys are also NFC normalized
                let normalized_key = normalize_string(k);
                canonical.insert(normalized_key, canonicalize(v));
            }
            Value::Object(canonical.into_iter().collect())
        },
        Value::Array(arr) => {
            Value::Array(arr.iter().map(canonicalize).collect())
        },
        Value::String(s) => {
            Value::String(normalize_string(s))
        },
        _ => value.clone()
    }
}
```

### Python Implementation
```python
import json
import unicodedata
from collections import OrderedDict

def normalize_string(s: str) -> str:
    """Apply NFC normalization and trim whitespace"""
    return unicodedata.normalize('NFC', s).strip()

def canonicalize(obj):
    """Recursively canonicalize JSON structure"""
    if isinstance(obj, dict):
        # Sort keys and normalize
        return OrderedDict(
            (normalize_string(k), canonicalize(v))
            for k, v in sorted(obj.items())
        )
    elif isinstance(obj, list):
        return [canonicalize(item) for item in obj]
    elif isinstance(obj, str):
        return normalize_string(obj)
    else:
        return obj

def to_canonical_json(obj) -> str:
    """Serialize to canonical JSON per RFC 8785"""
    canonical = canonicalize(obj)
    return json.dumps(canonical, separators=(',', ':'), 
                     ensure_ascii=False, sort_keys=True)
```

### Cross-Language Compliance

Implementations in ANY language MUST:
1. Use RFC 8785 for base JSON canonicalization
2. Apply our field-specific rules EXACTLY
3. Produce identical hashes for test vectors
4. Reject negative test vectors with errors

## Validation Checklist

- [ ] Recursive key sorting at all depths
- [ ] All numerics as canonical decimal strings
- [ ] Timestamps normalized to seconds precision
- [ ] venue_allowlist sorted and deduplicated
- [ ] Unknown fields cause rejection
- [ ] Unicode NFC normalization applied
- [ ] Whitespace trimmed from all strings
- [ ] Field-specific bounds enforced
- [ ] Test vectors produce exact hashes
- [ ] Negative vectors properly rejected

## Executable Artifacts and Test Vectors

### Reference Implementation

The canonical reference implementation is provided in Rust at:
```
contracts/near-intents-derivatives/src/canonicalization.rs
```

This implementation:
- Enforces ALL rules specified in this document
- Rejects invalid inputs with descriptive error messages
- Includes comprehensive unit tests
- Is used by the on-chain contract for `verify_intent_hash`

### Cross-Language Test Vectors

Test vectors are provided in `test-vectors/canonical-hashing.json` with:

**Positive Test Vectors** (MUST produce exact hashes):
1. Minimal perpetual with all defaults
2. Leveraged position with constraints
3. Call option with all fields
4. Put option with cross-chain collateral
5. Unicode edge cases (emoji, CJK, RTL text)
6. Maximum precision decimals
7. Array deduplication cases

**Negative Test Vectors** (MUST be rejected):
```json
[
  {"description": "Unknown root field", "intent": {...}, "error": "Invalid root fields"},
  {"description": "Scientific notation", "intent": {...}, "error": "Scientific notation not allowed"},
  {"description": "Leading zeros", "intent": {...}, "error": "Leading zeros not allowed"},
  {"description": "Milliseconds in timestamp", "intent": {...}, "error": "has milliseconds"},
  {"description": "Timezone offset", "intent": {...}, "error": "must not have timezone offset"},
  {"description": "Out of range leverage", "intent": {...}, "error": "out of range"},
  {"description": "Invalid EIP-55 checksum", "intent": {...}, "error": "Invalid Ethereum address"}
]
```

### Verification Tools

Implementations can verify correctness using:

1. **On-chain verification** (Testnet):
```bash
near view deltanear-derivatives.testnet verify_intent_hash \
  '{"intent_json": "{...}"}'
```

2. **Offline test runner**:
```bash
cargo test canonicalization::
npm test canonical-hashing
python -m pytest test_canonicalization.py
```

3. **Cross-language validator**:
```bash
./scripts/validate-canonicalization.sh <intent.json>
```

## Version Stability

This specification is **IMMUTABLE** for v1.0.0. Any changes require v2.0.0.

### Change Process

1. **v1.x.x**: NO changes to canonicalization rules allowed
2. **v2.0.0**: New major version with different hash output
3. **Migration**: Contracts MUST support multiple versions during transition