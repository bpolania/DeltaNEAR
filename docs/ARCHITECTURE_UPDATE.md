# Architecture Update: NEAR Intents Infrastructure

## Corrections and Updates

Based on the latest information, here are the key corrections to our understanding of NEAR's intent infrastructure:

### 1. 1Click API - Real Distribution Channel ✅

**Previous Understanding**: "1-Click" was thought to be a non-existent or purely UX feature.

**Reality**: 
- **1Click API** is a real REST-based distribution channel at `https://1click.chaindefuser.com`
- It provides simplified intent creation, solver coordination, and execution
- Offers automatic solver discovery and competitive pricing
- Requires JWT token for 0% fees (0.1% without token)
- Main endpoints: `/v0/quote`, `/v0/deposit/submit`, `/v0/status`

### 2. Canonical Verifier Contract - Exists ✅

**Previous Understanding**: The Verifier contract was hypothetical or future development.

**Reality**:
- **Canonical Verifier** (formerly "Defuse") is deployed and operational
- **Mainnet**: `intents.near`
- **Testnet**: `intents.testnet`
- Primary method: `execute_intents` for atomic transaction processing
- Handles intent validation, balance checks, and atomic execution

### 3. Integration Architecture

The correct integration approach involves:

```
User Intent → 1Click API → Solver Network → Verifier Contract → Settlement
```

**Key Components**:

1. **1Click API** (Distribution Layer)
   - Simplifies intent submission
   - Handles solver coordination
   - Provides quote aggregation
   - Manages cross-chain routing

2. **Verifier Contract** (Execution Layer)
   - Validates intent signatures (NEP-413)
   - Ensures atomic execution
   - Manages token custody during execution
   - Prevents double-spending

3. **Solver Network** (Liquidity Layer)
   - Market makers monitor intents
   - Provide competitive quotes
   - Execute cross-chain operations
   - Handle settlement logistics

## Updated Implementation

Our `NEARIntentsProvider` has been updated to:

1. **Use 1Click API** for intent distribution:
   ```typescript
   this.oneClickClient = axios.create({
     baseURL: 'https://1click.chaindefuser.com',
     headers: { 'Authorization': `Bearer ${jwtToken}` }
   });
   ```

2. **Reference correct Verifier contracts**:
   ```typescript
   this.verifierContract = network === 'mainnet' ? 
     'intents.near' : 'intents.testnet';
   ```

3. **Map 1Click statuses** correctly:
   - PENDING_DEPOSIT → pending
   - PROCESSING → executing
   - SUCCESS → settled
   - REFUNDED/FAILED → failed

## Benefits of Correct Integration

1. **Leverage Existing Infrastructure**: No need to build distribution from scratch
2. **Proven Security**: Verifier contract is audited and battle-tested
3. **Active Solver Network**: Multiple market makers already integrated
4. **Reduced Complexity**: 1Click handles routing and coordination
5. **Cross-chain Native**: Built-in support for multi-chain operations

## Migration Recommendations

### Phase 1: Hybrid Approach (Recommended)
- Use our OFA Gateway for derivatives-specific logic
- Integrate 1Click for standard swaps and transfers
- Gradually migrate complex operations

### Phase 2: Full Integration
- Migrate all intent distribution to 1Click
- Use Verifier for all atomic operations
- Maintain custom contract only for derivatives tracking

### Phase 3: Native Integration
- Fully adopt NEAR's intent standards
- Contribute derivatives extensions to ecosystem
- Participate in governance and improvements

## Resources

- [1Click API Documentation](https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api)
- [Verifier Contract Docs](https://docs.near-intents.org/near-intents/market-makers/verifier/introduction)
- [NEAR Intents GitHub](https://github.com/near/intents)
- [Integration Examples](https://learnnear.club/how-to-read-any-near-intents-transaction-step-by-step/)

## Conclusion

The NEAR Intents infrastructure is more mature than initially understood. The 1Click API and Canonical Verifier provide production-ready components for intent-based trading. Our Distribution Provider abstraction positions us well to leverage these tools while maintaining flexibility for derivatives-specific requirements.