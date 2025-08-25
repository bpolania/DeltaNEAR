# Verifier Contract Integration

## Overview

This documents the integration with NEAR's canonical Verifier contract (formerly "Defuse"), which handles atomic intent execution on the NEAR blockchain.

## Contract Details

### Mainnet
- **Contract ID**: `intents.near`
- **Purpose**: Atomic mediator for transferring assets among users in the intents ecosystem

### Testnet
- **Contract ID**: `intents.testnet`
- **Purpose**: Testing environment for intent execution

## Key Methods

### `execute_intents`
The primary method for processing atomic transactions between parties.

**Parameters**:
- `intents`: Array of signed intents to execute atomically
- Each intent must have tokens pre-deposited in the Verifier contract

**Flow**:
1. Users deposit tokens into the Verifier contract
2. Users create and sign intents (e.g., token swaps, derivatives positions)
3. Intents are validated for signatures and balances
4. All intents execute atomically or none execute

## Intent Types Supported

### 1. Transfer
Simple token transfer from one user to another.

### 2. TokenDiff
Token swap where users exchange different tokens.

### 3. FtWithdraw
Withdrawal of fungible tokens from the contract.

## Integration with DeltaNEAR

Our derivatives intents extend the base intent types to support:
- **Perpetual positions** (long/short with leverage)
- **Options contracts** (calls/puts with strikes)

### Workflow

1. **Intent Creation**
   - User specifies derivatives parameters
   - Intent is signed with NEP-413 standard
   
2. **Deposit Phase**
   - Collateral is deposited to Verifier contract
   - Can be done directly or through 1Click API

3. **Solver Coordination**
   - Solvers monitor the Verifier for intents
   - They prepare counter-intents for execution
   
4. **Atomic Execution**
   - `execute_intents` is called with matched intents
   - All succeed or all fail atomically
   
5. **Settlement**
   - Positions are recorded on-chain
   - Payouts are distributed per intent terms

## Example Integration

```typescript
// Connect to Verifier contract
const verifier = new Contract(
  account,
  'intents.near',
  {
    viewMethods: ['get_balance', 'get_intent_status'],
    changeMethods: ['deposit', 'execute_intents', 'withdraw']
  }
);

// Deposit collateral
await verifier.deposit({
  token_id: 'usdc.near',
  amount: '1000000' // 1 USDC with 6 decimals
});

// Create derivatives intent
const intent = {
  intent_type: 'TokenDiff',
  token_in: 'usdc.near',
  amount_in: '1000000',
  token_out: 'eth-perp.near',
  min_amount_out: '1000000000000000000', // 1 ETH perp token
  receiver: account.accountId,
  expiry: Date.now() + 3600000
};

// Sign intent with NEP-413
const signedIntent = await signWithNEP413(intent, account);

// Submit for execution (usually done by solver)
await verifier.execute_intents({
  intents: [signedIntent, counterIntent]
});
```

## Security Considerations

1. **Pre-deposit Required**: Tokens must be in Verifier before execution
2. **Signature Validation**: All intents verified with NEP-413
3. **Atomic Execution**: All or nothing - no partial fills
4. **Time Bounds**: Intents have expiry timestamps
5. **Balance Checks**: Ensures sufficient funds before execution

## Benefits of Using Canonical Verifier

1. **Standardization**: Common infrastructure for all NEAR intents
2. **Security**: Battle-tested contract with audit history
3. **Composability**: Works with other NEAR protocols
4. **Efficiency**: Optimized for gas usage
5. **Trust Minimization**: No custody risk during execution

## Migration Path

### Current State (Custom Contract)
Our `near-intents-derivatives` contract implements similar functionality but is derivatives-specific.

### Future State (Verifier Integration)
1. Use Verifier for atomic execution layer
2. Keep derivatives logic in separate contract
3. Verifier handles token movements
4. Our contract handles position tracking

### Hybrid Approach
- Use 1Click API for distribution and solver coordination
- Use Verifier contract for atomic execution
- Maintain our contract for derivatives-specific logic

## Resources

- [NEAR Intents GitHub](https://github.com/near/intents)
- [Verifier Documentation](https://docs.near-intents.org/near-intents/market-makers/verifier/introduction)
- [1Click API Docs](https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api)
- [NEP-413 Specification](https://github.com/near/NEPs/pull/413)