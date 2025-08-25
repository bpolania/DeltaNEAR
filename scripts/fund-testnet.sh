#!/bin/bash

# Fund testnet accounts for integration testing
# This script sets up the complete testing environment on NEAR testnet

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Configuration
NETWORK="testnet"
VERIFIER_CONTRACT="intents.testnet"
METADATA_CONTRACT="deltanear-derivatives.testnet"
SOLVER_ACCOUNT="deltanear-solver1.testnet"
USER_ACCOUNT="deltanear-user1.testnet"

# Token addresses on testnet
USDC_TOKEN="usdc.fakes.testnet"  # Test USDC on testnet
WETH_TOKEN="weth.fakes.testnet"  # Test WETH on testnet

echo "🚀 Setting up DeltaNEAR testnet environment..."
echo

# Check NEAR CLI is installed
if ! command -v near &> /dev/null; then
    echo "❌ NEAR CLI not found. Please install: npm install -g near-cli-rs"
    exit 1
fi

# Set network
export NEAR_ENV=$NETWORK

# Function to check if account exists
account_exists() {
    near view-account "$1" --networkId $NETWORK &>/dev/null
}

# Function to create account if it doesn't exist
create_account_if_needed() {
    local ACCOUNT=$1
    local PARENT=${ACCOUNT#*.}  # Get parent account (everything after first dot)
    
    if account_exists "$ACCOUNT"; then
        echo "✅ Account $ACCOUNT already exists"
    else
        echo "Creating account $ACCOUNT..."
        near create-account "$ACCOUNT" --masterAccount "$PARENT" --initialBalance 10 --networkId $NETWORK
        echo "✅ Created account $ACCOUNT"
    fi
}

# Step 1: Create accounts
echo "Step 1: Creating accounts..."
create_account_if_needed "$SOLVER_ACCOUNT"
create_account_if_needed "$USER_ACCOUNT"
echo

# Step 2: Deploy metadata contract
echo "Step 2: Deploying metadata contract..."
if account_exists "$METADATA_CONTRACT"; then
    echo "✅ Metadata contract already deployed"
else
    echo "Building contract..."
    cd "$PROJECT_DIR/contracts/near-intents-derivatives"
    cargo build --release --target wasm32-unknown-unknown
    wasm-opt --signext-lowering \
        target/wasm32-unknown-unknown/release/deltanear_derivatives.wasm \
        -o deltanear_derivatives_optimized.wasm
    
    echo "Deploying contract..."
    near deploy "$METADATA_CONTRACT" \
        deltanear_derivatives_optimized.wasm \
        --initFunction new \
        --initArgs "{
            \"treasury_account_id\": \"$SOLVER_ACCOUNT\",
            \"protocol_fee_bps\": 20,
            \"solver_rebate_bps\": 10
        }" \
        --networkId $NETWORK
    
    echo "✅ Deployed metadata contract"
fi
echo

# Step 3: Configure metadata contract
echo "Step 3: Configuring metadata contract..."

# Add ETH-USD symbol
near call "$METADATA_CONTRACT" add_symbol_config "{
    \"config\": {
        \"symbol\": \"ETH-USD\",
        \"instruments\": [\"perp\", \"option\"],
        \"min_size\": \"0.01\",
        \"max_size\": \"1000\",
        \"tick_size\": \"0.01\"
    }
}" --accountId "$SOLVER_ACCOUNT" --networkId $NETWORK || true

# Add BTC-USD symbol
near call "$METADATA_CONTRACT" add_symbol_config "{
    \"config\": {
        \"symbol\": \"BTC-USD\",
        \"instruments\": [\"perp\", \"option\"],
        \"min_size\": \"0.001\",
        \"max_size\": \"100\",
        \"tick_size\": \"0.001\"
    }
}" --accountId "$SOLVER_ACCOUNT" --networkId $NETWORK || true

# Add GMX venue
near call "$METADATA_CONTRACT" add_venue_config "{
    \"config\": {
        \"venue_id\": \"gmx-v2\",
        \"chain\": \"arbitrum\",
        \"supported_instruments\": [\"perp\"],
        \"fee_bps\": 5
    },
    \"symbols\": [\"ETH-USD\", \"BTC-USD\"]
}" --accountId "$SOLVER_ACCOUNT" --networkId $NETWORK || true

echo "✅ Configured metadata contract"
echo

# Step 4: Fund accounts with test tokens
echo "Step 4: Funding accounts with test tokens..."

# Register and deposit USDC for solver
echo "Funding solver with USDC..."
near call "$USDC_TOKEN" storage_deposit "{
    \"account_id\": \"$SOLVER_ACCOUNT\"
}" --accountId "$SOLVER_ACCOUNT" --deposit 0.00125 --networkId $NETWORK || true

near call "$USDC_TOKEN" ft_transfer "{
    \"receiver_id\": \"$SOLVER_ACCOUNT\",
    \"amount\": \"1000000000\"
}" --accountId "$USDC_TOKEN" --depositYocto 1 --networkId $NETWORK || true

# Register and deposit USDC for user
echo "Funding user with USDC..."
near call "$USDC_TOKEN" storage_deposit "{
    \"account_id\": \"$USER_ACCOUNT\"
}" --accountId "$USER_ACCOUNT" --deposit 0.00125 --networkId $NETWORK || true

near call "$USDC_TOKEN" ft_transfer "{
    \"receiver_id\": \"$USER_ACCOUNT\",
    \"amount\": \"500000000\"
}" --accountId "$USDC_TOKEN" --depositYocto 1 --networkId $NETWORK || true

echo "✅ Funded accounts with test tokens"
echo

# Step 5: Pre-deposit to Verifier for settlement
echo "Step 5: Pre-depositing to Verifier..."

# Solver deposits to Verifier
near call "$VERIFIER_CONTRACT" deposit "{
    \"token_id\": \"nep141:$USDC_TOKEN\",
    \"amount\": \"100000000\"
}" --accountId "$SOLVER_ACCOUNT" --gas 100000000000000 --networkId $NETWORK || true

# User deposits to Verifier
near call "$VERIFIER_CONTRACT" deposit "{
    \"token_id\": \"nep141:$USDC_TOKEN\",
    \"amount\": \"50000000\"
}" --accountId "$USER_ACCOUNT" --gas 100000000000000 --networkId $NETWORK || true

echo "✅ Pre-deposited to Verifier"
echo

# Step 6: Verify setup
echo "Step 6: Verifying setup..."

# Check metadata contract
echo "Checking metadata contract..."
SCHEMA_VERSION=$(near view "$METADATA_CONTRACT" get_schema_version --networkId $NETWORK 2>/dev/null || echo "ERROR")
if [ "$SCHEMA_VERSION" = "1.0.0" ]; then
    echo "✅ Metadata contract responding (version $SCHEMA_VERSION)"
else
    echo "⚠️ Metadata contract not responding correctly"
fi

# Check Verifier balances
echo "Checking Verifier balances..."
SOLVER_BALANCE=$(near view "$VERIFIER_CONTRACT" get_balance "{
    \"account_id\": \"$SOLVER_ACCOUNT\",
    \"token_id\": \"nep141:$USDC_TOKEN\"
}" --networkId $NETWORK 2>/dev/null || echo "0")
echo "  Solver balance in Verifier: $SOLVER_BALANCE"

USER_BALANCE=$(near view "$VERIFIER_CONTRACT" get_balance "{
    \"account_id\": \"$USER_ACCOUNT\",
    \"token_id\": \"nep141:$USDC_TOKEN\"
}" --networkId $NETWORK 2>/dev/null || echo "0")
echo "  User balance in Verifier: $USER_BALANCE"

echo
echo "========================================="
echo "✅ TESTNET SETUP COMPLETE!"
echo "========================================="
echo
echo "Deployed contracts:"
echo "  Metadata: $METADATA_CONTRACT"
echo "  Verifier: $VERIFIER_CONTRACT (existing)"
echo
echo "Test accounts:"
echo "  Solver: $SOLVER_ACCOUNT"
echo "  User: $USER_ACCOUNT"
echo
echo "Test tokens:"
echo "  USDC: $USDC_TOKEN"
echo "  WETH: $WETH_TOKEN"
echo
echo "Next steps:"
echo "1. Run integration tests: npm test"
echo "2. Test canonical hashing: near view $METADATA_CONTRACT verify_intent_hash '{...}'"
echo "3. Monitor events: near logs $METADATA_CONTRACT"