#!/bin/bash

# DeltaNEAR Testnet Deployment Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}DeltaNEAR Testnet Deployment${NC}"
echo "================================="

# Check requirements
check_requirements() {
    echo -e "${YELLOW}Checking requirements...${NC}"
    
    if ! command -v near &> /dev/null; then
        echo -e "${RED}Error: NEAR CLI not found${NC}"
        echo "Install with: npm install -g near-cli"
        exit 1
    fi
    
    if ! command -v rustc &> /dev/null; then
        echo -e "${RED}Error: Rust not found${NC}"
        echo "Install from: https://rustup.rs"
        exit 1
    fi
    
    if ! command -v cargo-near &> /dev/null; then
        echo -e "${YELLOW}Warning: cargo-near not found${NC}"
        echo "Installing cargo-near..."
        cargo install cargo-near
    fi
    
    echo -e "${GREEN}All requirements met${NC}"
}

# Load environment
load_env() {
    if [ -f .env.testnet ]; then
        export $(cat .env.testnet | xargs)
        echo -e "${GREEN}Loaded .env.testnet${NC}"
    else
        echo -e "${YELLOW}No .env.testnet found, using defaults${NC}"
    fi
    
    # Set defaults if not provided
    : ${NEAR_ENV:=testnet}
    : ${MASTER_ACCOUNT:=deltanear.testnet}
    : ${CONTRACT_NAME:=intents.deltanear.testnet}
    : ${TREASURY_ACCOUNT:=treasury.deltanear.testnet}
    : ${SOLVER1_ACCOUNT:=solver1.deltanear.testnet}
    : ${SOLVER2_ACCOUNT:=solver2.deltanear.testnet}
}

# Build contract
build_contract() {
    echo -e "${YELLOW}Building NEAR contract...${NC}"
    cd contracts/near-intents-derivatives
    
    # Build with cargo-near for NEAR compatibility
    cargo near build --release
    
    # Copy wasm file to deployment directory
    cp target/near/near_intents_derivatives.wasm ../../deploy/
    
    cd ../..
    echo -e "${GREEN}Contract built successfully${NC}"
}

# Create accounts
create_accounts() {
    echo -e "${YELLOW}Creating testnet accounts...${NC}"
    
    # Create treasury account
    near create-account $TREASURY_ACCOUNT --masterAccount $MASTER_ACCOUNT --initialBalance 10 || true
    
    # Create solver accounts
    near create-account $SOLVER1_ACCOUNT --masterAccount $MASTER_ACCOUNT --initialBalance 5 || true
    near create-account $SOLVER2_ACCOUNT --masterAccount $MASTER_ACCOUNT --initialBalance 5 || true
    
    echo -e "${GREEN}Accounts created${NC}"
}

# Deploy contract
deploy_contract() {
    echo -e "${YELLOW}Deploying contract to testnet...${NC}"
    
    # Deploy contract
    near deploy \
        --accountId $CONTRACT_NAME \
        --wasmFile deploy/near_intents_derivatives.wasm \
        --initFunction new \
        --initArgs "{\"treasury_account_id\": \"$TREASURY_ACCOUNT\"}"
    
    echo -e "${GREEN}Contract deployed to: $CONTRACT_NAME${NC}"
}

# Configure contract
configure_contract() {
    echo -e "${YELLOW}Configuring contract...${NC}"
    
    # Add authorized solvers
    near call $CONTRACT_NAME add_authorized_solver \
        "{\"solver_id\": \"$SOLVER1_ACCOUNT\"}" \
        --accountId $CONTRACT_NAME
    
    near call $CONTRACT_NAME add_authorized_solver \
        "{\"solver_id\": \"$SOLVER2_ACCOUNT\"}" \
        --accountId $CONTRACT_NAME
    
    echo -e "${GREEN}Contract configured${NC}"
}

# Deploy services
deploy_services() {
    echo -e "${YELLOW}Preparing service deployments...${NC}"
    
    # Build TypeScript services
    pnpm build
    
    # Create deployment configs
    cat > deploy/gateway-config.json <<EOF
{
    "network": "testnet",
    "port": 3000,
    "wsPort": 3001,
    "nearNetwork": "testnet",
    "contractAddress": "$CONTRACT_NAME",
    "corsOrigins": ["https://deltanear.app", "http://localhost:3000"]
}
EOF

    cat > deploy/solver1-config.json <<EOF
{
    "solverId": "solver-1",
    "network": "testnet",
    "gatewayUrl": "wss://gateway.deltanear.app",
    "nearAccount": "$SOLVER1_ACCOUNT",
    "supportedVenues": ["gmx-v2", "lyra-v2"],
    "maxExposure": "1000000"
}
EOF

    cat > deploy/solver2-config.json <<EOF
{
    "solverId": "solver-2",
    "network": "testnet",
    "gatewayUrl": "wss://gateway.deltanear.app",
    "nearAccount": "$SOLVER2_ACCOUNT",
    "supportedVenues": ["gmx-v2"],
    "maxExposure": "500000"
}
EOF
    
    echo -e "${GREEN}Service configs created${NC}"
    echo -e "${YELLOW}Note: Deploy services to your preferred hosting provider${NC}"
    echo "  - Gateway: Use deploy/gateway-config.json"
    echo "  - Solver 1: Use deploy/solver1-config.json"
    echo "  - Solver 2: Use deploy/solver2-config.json"
}

# Verify deployment
verify_deployment() {
    echo -e "${YELLOW}Verifying deployment...${NC}"
    
    # Check contract
    near view $CONTRACT_NAME get_authorized_solvers "{}"
    
    # Get contract info
    near state $CONTRACT_NAME
    
    echo -e "${GREEN}Deployment verification complete${NC}"
}

# Main execution
main() {
    echo "Starting testnet deployment..."
    
    # Create deployment directory
    mkdir -p deploy
    
    check_requirements
    load_env
    build_contract
    create_accounts
    deploy_contract
    configure_contract
    deploy_services
    verify_deployment
    
    echo -e "${GREEN}=================================${NC}"
    echo -e "${GREEN}Testnet deployment complete!${NC}"
    echo -e "${GREEN}=================================${NC}"
    echo ""
    echo "Contract: $CONTRACT_NAME"
    echo "Treasury: $TREASURY_ACCOUNT"
    echo "Solvers: $SOLVER1_ACCOUNT, $SOLVER2_ACCOUNT"
    echo ""
    echo "Next steps:"
    echo "1. Deploy gateway service to your hosting provider"
    echo "2. Deploy solver nodes to compute instances"
    echo "3. Update DNS records for gateway.deltanear.app"
    echo "4. Test with: npm run test:testnet"
}

# Run main function
main "$@"