#!/bin/bash
# Test script for real 1Click API integration
# Demonstrates metadata preservation through the complete round-trip

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔗 1Click API Integration Test${NC}"
echo "=================================="
echo ""

# Configuration
export ONE_CLICK_API="${ONE_CLICK_API:-https://1click.chaindefuser.com}"
export SOLVER_ENDPOINT="${SOLVER_ENDPOINT:-http://localhost:8080}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  1Click API: $ONE_CLICK_API"
echo "  Solver Endpoint: $SOLVER_ENDPOINT"
echo ""

# Check if 1Click API is reachable
echo -e "${BLUE}Checking 1Click API availability...${NC}"
if curl -s -o /dev/null -w "%{http_code}" "$ONE_CLICK_API/health" | grep -q "200"; then
    echo -e "${GREEN}✓ 1Click API is available${NC}"
    export USE_REAL_1CLICK=true
else
    echo -e "${YELLOW}⚠ 1Click API not reachable, will use mock responses${NC}"
    export USE_REAL_1CLICK=false
fi
echo ""

# Run metadata preservation test
echo -e "${BLUE}Running metadata preservation audit test...${NC}"
echo ""

# Navigate to solver-node directory
cd services/solver-node

# Run the specific test
npm test -- --testNamePattern="1Click Metadata Preservation Audit" --verbose

echo ""
echo -e "${GREEN}Test Summary:${NC}"
echo "=============="

if [ "$USE_REAL_1CLICK" = "true" ]; then
    echo -e "${GREEN}✓ Real 1Click API integration tested${NC}"
    echo ""
    echo "The test demonstrated:"
    echo "  1. Intent submission to production 1Click API"
    echo "  2. Metadata checksum preservation verification"
    echo "  3. NEP-297 audit event generation"
    echo "  4. Solver receipt confirmation"
else
    echo -e "${YELLOW}⚠ Mock 1Click responses used (API unavailable)${NC}"
    echo ""
    echo "To test with real API:"
    echo "  1. Ensure 1Click API is accessible"
    echo "  2. Set ONE_CLICK_API_KEY if required"
    echo "  3. Re-run this script"
fi

echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Deploy contract to testnet: npm run deploy:testnet"
echo "  2. Submit real intent through 1Click: npm run submit:intent"
echo "  3. Monitor solver execution: npm run monitor:solver"