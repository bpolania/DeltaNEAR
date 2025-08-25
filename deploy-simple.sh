#!/bin/bash

# Simple deployment script for testnet
set -e

echo "DeltaNEAR Testnet Deployment"
echo "=============================="

# Set environment
export NEAR_ENV=testnet
CONTRACT_NAME=intents.deltanear.testnet
WASM_FILE=deploy/near_intents_derivatives.wasm

echo "Deploying contract to testnet..."

# Check if account exists
if near state $CONTRACT_NAME 2>/dev/null; then
    echo "Account $CONTRACT_NAME already exists"
else
    echo "Account $CONTRACT_NAME does not exist"
    echo "Please create the account first:"
    echo "  near create-account $CONTRACT_NAME --masterAccount deltanear.testnet --initialBalance 10"
    echo ""
    echo "Or use an existing account with sufficient balance."
    exit 1
fi

# Deploy contract without initialization
echo "Deploying contract..."
near deploy $CONTRACT_NAME $WASM_FILE

echo "Contract deployed successfully!"
echo ""
echo "To initialize the contract, run:"
echo "  near call $CONTRACT_NAME new '{\"treasury_account_id\": \"treasury.deltanear.testnet\"}' --accountId $CONTRACT_NAME"
echo ""
echo "To add authorized solvers:"
echo "  near call $CONTRACT_NAME add_authorized_solver '{\"solver_id\": \"solver1.deltanear.testnet\"}' --accountId $CONTRACT_NAME"

echo ""
echo "Deployment complete!"