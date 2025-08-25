#!/bin/bash
# Bootstrap script for DeltaNEAR testnet deployment
# Sets up test tokens, accounts, and initial deposits for conformance testing

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 DeltaNEAR Testnet Bootstrap Script v1.0.0${NC}"
echo "================================================"

# Configuration
NETWORK="${NETWORK:-testnet}"
CONTRACT_ID="${CONTRACT_ID:-deltanear-derivatives.testnet}"
CANONICAL_VERIFIER="${CANONICAL_VERIFIER:-intents.testnet}"
TREASURY="${TREASURY:-deltanear-treasury.testnet}"

# Test accounts
ALICE="${ALICE:-alice-deltanear-test.testnet}"
BOB="${BOB:-bob-deltanear-test.testnet}"
SOLVER="${SOLVER:-solver-deltanear-test.testnet}"

# Test tokens (using existing testnet tokens)
USDC_TOKEN="usdc.fakes.testnet"
WETH_TOKEN="weth.fakes.testnet"
WBTC_TOKEN="wbtc.fakes.testnet"
WNEAR_TOKEN="wrap.testnet"

# Token amounts (with proper decimals)
USDC_AMOUNT="10000000000" # 10,000 USDC (6 decimals)
WETH_AMOUNT="5000000000000000000" # 5 ETH (18 decimals)
WBTC_AMOUNT="100000000" # 1 BTC (8 decimals)
WNEAR_AMOUNT="1000000000000000000000000" # 1000 NEAR (24 decimals)

echo -e "${YELLOW}Network:${NC} $NETWORK"
echo -e "${YELLOW}Contract:${NC} $CONTRACT_ID"
echo -e "${YELLOW}Canonical Verifier:${NC} $CANONICAL_VERIFIER"
echo ""

# Function to check if account exists
account_exists() {
    near view-state --finality final --account-id "$1" 2>/dev/null | grep -q "Account"
}

# Function to create account if it doesn't exist
ensure_account() {
    local account=$1
    local parent=$2
    local amount=${3:-"10"}
    
    if account_exists "$account"; then
        echo -e "${GREEN}✓${NC} Account $account already exists"
    else
        echo -e "${YELLOW}Creating account:${NC} $account"
        near create-account "$account" --masterAccount "$parent" --initialBalance "$amount" --networkId "$NETWORK"
        echo -e "${GREEN}✓${NC} Account created: $account"
    fi
}

# Function to register storage for token
register_storage() {
    local account=$1
    local token=$2
    
    echo -e "${YELLOW}Registering storage for $account on $token${NC}"
    near call "$token" storage_deposit "{\"account_id\": \"$account\"}" \
        --accountId "$account" \
        --deposit 0.00125 \
        --networkId "$NETWORK" 2>/dev/null || true
}

# Function to get token from faucet
get_from_faucet() {
    local account=$1
    local token=$2
    local amount=$3
    
    echo -e "${YELLOW}Getting $amount tokens from $token faucet for $account${NC}"
    
    # First register storage
    register_storage "$account" "$token"
    
    # For fakes.testnet tokens, they have a mint function
    if [[ "$token" == *"fakes.testnet" ]]; then
        near call "$token" mint "{\"account_id\": \"$account\", \"amount\": \"$amount\"}" \
            --accountId "$account" \
            --networkId "$NETWORK" || true
    elif [[ "$token" == "wrap.testnet" ]]; then
        # For wNEAR, deposit NEAR to get wNEAR
        near call "$token" near_deposit "{}" \
            --accountId "$account" \
            --deposit 100 \
            --networkId "$NETWORK" || true
    fi
}

# Function to check token balance
check_balance() {
    local account=$1
    local token=$2
    
    balance=$(near view "$token" ft_balance_of "{\"account_id\": \"$account\"}" --networkId "$NETWORK" 2>/dev/null | grep -o '[0-9]*' | head -1)
    echo -e "${GREEN}Balance of $account on $token: $balance${NC}"
}

# Step 1: Create test accounts
echo -e "\n${GREEN}Step 1: Creating test accounts${NC}"
echo "================================"

# Note: These would need to be created from a parent account you control
# For testing, we'll assume they exist or you'll create them manually
echo -e "${YELLOW}Please ensure these accounts exist:${NC}"
echo "  - $ALICE"
echo "  - $BOB"
echo "  - $SOLVER"
echo ""

# Step 2: Deploy contract (if not already deployed)
echo -e "\n${GREEN}Step 2: Contract Deployment${NC}"
echo "============================="

if account_exists "$CONTRACT_ID"; then
    echo -e "${GREEN}✓${NC} Contract account already exists: $CONTRACT_ID"
else
    echo -e "${RED}Contract account does not exist: $CONTRACT_ID${NC}"
    echo "Please deploy the contract first using:"
    echo "  near deploy --accountId $CONTRACT_ID --wasmFile target/wasm32-unknown-unknown/release/near_intents_derivatives.wasm"
fi

# Step 3: Initialize contract
echo -e "\n${GREEN}Step 3: Initialize Contract${NC}"
echo "============================="

echo "Initializing contract with fee configuration..."
near call "$CONTRACT_ID" new "{
    \"treasury_account_id\": \"$TREASURY\",
    \"protocol_fee_bps\": 30,
    \"solver_rebate_bps\": 20
}" --accountId "$CONTRACT_ID" --networkId "$NETWORK" 2>/dev/null || echo "Contract already initialized"

# Step 4: Get test tokens from faucets
echo -e "\n${GREEN}Step 4: Getting Test Tokens${NC}"
echo "============================="

for account in "$ALICE" "$BOB" "$SOLVER"; do
    echo -e "\n${YELLOW}Setting up tokens for $account${NC}"
    
    # USDC
    get_from_faucet "$account" "$USDC_TOKEN" "$USDC_AMOUNT"
    check_balance "$account" "$USDC_TOKEN"
    
    # WETH
    get_from_faucet "$account" "$WETH_TOKEN" "$WETH_AMOUNT"
    check_balance "$account" "$WETH_TOKEN"
    
    # WBTC
    get_from_faucet "$account" "$WBTC_TOKEN" "$WBTC_AMOUNT"
    check_balance "$account" "$WBTC_TOKEN"
    
    # wNEAR
    get_from_faucet "$account" "$WNEAR_TOKEN" "$WNEAR_AMOUNT"
    check_balance "$account" "$WNEAR_TOKEN"
done

# Step 5: Pre-deposit to Canonical Verifier
echo -e "\n${GREEN}Step 5: Pre-depositing to Canonical Verifier${NC}"
echo "============================================="

echo -e "${YELLOW}Depositing collateral to $CANONICAL_VERIFIER${NC}"

# Alice deposits USDC as collateral
near call "$USDC_TOKEN" ft_transfer_call "{
    \"receiver_id\": \"$CANONICAL_VERIFIER\",
    \"amount\": \"1000000000\",
    \"msg\": \"deposit\"
}" --accountId "$ALICE" --depositYocto 1 --gas 300000000000000 --networkId "$NETWORK" || true

# Bob deposits wNEAR as collateral  
near call "$WNEAR_TOKEN" ft_transfer_call "{
    \"receiver_id\": \"$CANONICAL_VERIFIER\",
    \"amount\": \"100000000000000000000000\",
    \"msg\": \"deposit\"
}" --accountId "$BOB" --depositYocto 1 --gas 300000000000000 --networkId "$NETWORK" || true

# Step 6: Verify deployment
echo -e "\n${GREEN}Step 6: Verifying Deployment${NC}"
echo "==============================="

echo "Checking contract views..."

# Get schema version
echo -n "Schema version: "
near view "$CONTRACT_ID" get_schema_version "{}" --networkId "$NETWORK" 2>/dev/null | grep -o '"[^"]*"' | sed 's/"//g' || echo "Error"

# Get ABI hash
echo -n "ABI hash: "
near view "$CONTRACT_ID" get_abi_hash "{}" --networkId "$NETWORK" 2>/dev/null | grep -o '"[^"]*"' | head -1 | sed 's/"//g' || echo "Error"

# Get fee config
echo "Fee configuration:"
near view "$CONTRACT_ID" get_fee_config "{}" --networkId "$NETWORK" 2>/dev/null | head -20 || echo "Error"

# Step 7: Create test intent
echo -e "\n${GREEN}Step 7: Creating Test Intent${NC}"
echo "==============================="

TEST_INTENT='{
  "version": "1.0.0",
  "intent_type": "derivatives",
  "derivatives": {
    "instrument": "perp",
    "symbol": "ETH-USD",
    "side": "long",
    "size": "1",
    "leverage": "5",
    "collateral": {
      "token": "usdc.fakes.testnet",
      "chain": "near",
      "amount": "500000000"
    }
  },
  "signer_id": "'$ALICE'",
  "deadline": "2024-12-31T23:59:59Z",
  "nonce": "test-'$(date +%s)'"
}'

echo "Test intent created:"
echo "$TEST_INTENT" | jq .

# Save test configuration
echo -e "\n${GREEN}Step 8: Saving Configuration${NC}"
echo "==============================="

CONFIG_FILE="testnet-config.json"
cat > "$CONFIG_FILE" <<EOF
{
  "network": "$NETWORK",
  "contract_id": "$CONTRACT_ID",
  "canonical_verifier": "$CANONICAL_VERIFIER",
  "treasury": "$TREASURY",
  "accounts": {
    "alice": "$ALICE",
    "bob": "$BOB",
    "solver": "$SOLVER"
  },
  "tokens": {
    "usdc": {
      "address": "$USDC_TOKEN",
      "decimals": 6,
      "test_amount": "$USDC_AMOUNT"
    },
    "weth": {
      "address": "$WETH_TOKEN",
      "decimals": 18,
      "test_amount": "$WETH_AMOUNT"
    },
    "wbtc": {
      "address": "$WBTC_TOKEN",
      "decimals": 8,
      "test_amount": "$WBTC_AMOUNT"
    },
    "wnear": {
      "address": "$WNEAR_TOKEN",
      "decimals": 24,
      "test_amount": "$WNEAR_AMOUNT"
    }
  },
  "test_intent": $TEST_INTENT
}
EOF

echo -e "${GREEN}✓${NC} Configuration saved to $CONFIG_FILE"

echo -e "\n${GREEN}🎉 Bootstrap Complete!${NC}"
echo "======================="
echo ""
echo "Next steps:"
echo "1. Run conformance tests: npm run test:conformance"
echo "2. Submit test intent through 1Click: npm run test:1click"
echo "3. Monitor events: near events $CONTRACT_ID --networkId $NETWORK"
echo ""
echo "Accounts funded:"
echo "  - $ALICE"
echo "  - $BOB"
echo "  - $SOLVER"
echo ""
echo "Tokens available:"
echo "  - USDC: $USDC_TOKEN"
echo "  - WETH: $WETH_TOKEN"
echo "  - WBTC: $WBTC_TOKEN"
echo "  - wNEAR: $WNEAR_TOKEN"