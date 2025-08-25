#!/bin/bash

# Script to validate ABI stability and test vectors
# Run this before committing changes to ensure ABI compatibility

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONTRACT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "🔍 Validating DeltaNEAR Derivatives ABI v1.0.0..."
echo

# Check ABI file exists
if [ ! -f "$CONTRACT_DIR/abi/v1.0.0.json" ]; then
    echo "❌ ERROR: ABI file v1.0.0.json not found!"
    exit 1
fi

# Validate JSON structure
echo "Checking ABI JSON structure..."
python3 -m json.tool "$CONTRACT_DIR/abi/v1.0.0.json" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ ERROR: ABI JSON is invalid!"
    exit 1
fi
echo "✅ ABI JSON is valid"

# Check schema version
ABI_VERSION=$(python3 -c "import json; print(json.load(open('$CONTRACT_DIR/abi/v1.0.0.json'))['schema_version'])")
if [ "$ABI_VERSION" != "1.0.0" ]; then
    echo "❌ ERROR: ABI schema_version must be 1.0.0, got: $ABI_VERSION"
    exit 1
fi
echo "✅ Schema version: $ABI_VERSION"

# Verify required view methods
echo
echo "Checking required view methods..."
REQUIRED_METHODS=(
    "get_schema_version"
    "get_fee_config"
    "get_guardrails"
    "get_supported_symbols"
    "get_allowed_venues"
    "verify_intent_hash"
    "get_intent_metadata"
    "get_execution_log"
)

for method in "${REQUIRED_METHODS[@]}"; do
    python3 -c "
import json
abi = json.load(open('$CONTRACT_DIR/abi/v1.0.0.json'))
methods = [m['name'] for m in abi['methods']['view']]
if '$method' not in methods:
    exit(1)
" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "  ❌ Missing: $method"
        exit 1
    else
        echo "  ✅ Found: $method"
    fi
done

# Verify NEP-297 events
echo
echo "Checking NEP-297 events..."
REQUIRED_EVENTS=(
    "intent_submitted"
    "execution_logged"
)

for event in "${REQUIRED_EVENTS[@]}"; do
    python3 -c "
import json
abi = json.load(open('$CONTRACT_DIR/abi/v1.0.0.json'))
events = [e['name'] for e in abi['events']['events']]
if '$event' not in events:
    exit(1)
" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "  ❌ Missing: $event"
        exit 1
    else
        echo "  ✅ Found: $event"
    fi
done

# Check event standard
EVENT_STANDARD=$(python3 -c "import json; print(json.load(open('$CONTRACT_DIR/abi/v1.0.0.json'))['events']['standard'])")
if [ "$EVENT_STANDARD" != "deltanear_derivatives" ]; then
    echo "❌ ERROR: Event standard must be 'deltanear_derivatives', got: $EVENT_STANDARD"
    exit 1
fi
echo "✅ Event standard: $EVENT_STANDARD"

# Check test vectors
echo
echo "Checking test vectors..."
if [ ! -f "$CONTRACT_DIR/test-vectors/canonical-hashing.json" ]; then
    echo "❌ ERROR: Test vectors file not found!"
    exit 1
fi

python3 -m json.tool "$CONTRACT_DIR/test-vectors/canonical-hashing.json" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ ERROR: Test vectors JSON is invalid!"
    exit 1
fi

VECTOR_COUNT=$(python3 -c "import json; print(len(json.load(open('$CONTRACT_DIR/test-vectors/canonical-hashing.json'))['test_vectors']))")
echo "✅ Found $VECTOR_COUNT test vectors"

# Run Rust tests
echo
echo "Running contract tests..."
cd "$CONTRACT_DIR"
cargo test --lib --quiet
if [ $? -eq 0 ]; then
    echo "✅ All contract tests passed"
else
    echo "❌ Contract tests failed!"
    exit 1
fi

# Build contract to ensure it compiles
echo
echo "Building contract..."
cargo build --release --target wasm32-unknown-unknown --quiet
if [ $? -eq 0 ]; then
    echo "✅ Contract builds successfully"
    
    # Check size
    WASM_FILE="target/wasm32-unknown-unknown/release/deltanear_derivatives.wasm"
    if [ -f "$WASM_FILE" ]; then
        SIZE=$(stat -c%s "$WASM_FILE" 2>/dev/null || stat -f%z "$WASM_FILE")
        SIZE_MB=$(echo "scale=2; $SIZE / 1024 / 1024" | bc)
        echo "📦 Contract size: ${SIZE_MB}MB (${SIZE} bytes)"
        
        MAX_SIZE=$((4 * 1024 * 1024))
        if [ $SIZE -gt $MAX_SIZE ]; then
            echo "❌ WARNING: Contract exceeds 4MB limit!"
        fi
    fi
else
    echo "❌ Contract build failed!"
    exit 1
fi

echo
echo "========================================="
echo "✅ ABI VALIDATION SUCCESSFUL!"
echo "========================================="
echo
echo "The ABI is stable and all tests pass."
echo "Safe to commit these changes."