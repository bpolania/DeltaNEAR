# DeltaNEAR Testnet Deployment

## Deployment Status

### Contract Deployment
- **Contract**: Successfully deployed to `demo.cuteharbor3573.testnet`
- **Transaction**: [4yyh3s4AqTDEsTWPMuVduAKUkwAwKdZF3yER1hXpXp7W](https://testnet.nearblocks.io/txns/4yyh3s4AqTDEsTWPMuVduAKUkwAwKdZF3yER1hXpXp7W)
- **WASM Size**: 296KB
- **Network**: NEAR Testnet

### Build Information
- **Rust Target**: wasm32-unknown-unknown
- **NEAR SDK**: v5.17.1
- **Build Command**: `cargo build --target wasm32-unknown-unknown --release`

## Deployment Steps Completed

1. ✅ **NEAR CLI Installation**
   - Version: 4.0.13
   - Network: Testnet

2. ✅ **Contract Build**
   - Fixed NEAR SDK v5 compatibility issues
   - Updated to use `near_sdk::store` collections
   - Added proper `NearToken` wrapping for transfers
   - Resolved all compilation errors

3. ✅ **Account Creation**
   - Created sub-account: `deltanear-intents.cuteharbor3573.testnet`
   - Deployed to existing account: `demo.cuteharbor3573.testnet`

4. ✅ **Contract Deployment**
   - WASM file: `deploy/near_intents_derivatives.wasm`
   - Successfully deployed to testnet

## Known Issues

### State Initialization
The deployed account (`demo.cuteharbor3573.testnet`) had a previous contract with incompatible state. For fresh deployment:

1. Create a new testnet account with sufficient balance (>3 NEAR)
2. Deploy the contract
3. Initialize with: `near call <account> new '{"treasury_account_id": "<treasury>"}' --accountId <account>`

## Next Steps for Full Deployment

### 1. Fresh Account Deployment
```bash
# Create new account with sufficient balance
near create-account <new-account>.testnet --masterAccount <parent> --initialBalance 5

# Deploy contract
near deploy <new-account>.testnet deploy/near_intents_derivatives.wasm

# Initialize
near call <new-account>.testnet new '{"treasury_account_id": "<treasury>.testnet"}' --accountId <new-account>.testnet
```

### 2. Add Authorized Solvers
```bash
near call <contract> add_authorized_solver '{"solver_id": "solver1.testnet"}' --accountId <contract>
near call <contract> add_authorized_solver '{"solver_id": "solver2.testnet"}' --accountId <contract>
```

### 3. Deploy Services
- Gateway service configuration in `deploy/gateway-config.json`
- Solver configurations in `deploy/solver1-config.json` and `deploy/solver2-config.json`
- Use Docker Compose: `docker-compose -f deploy/docker-compose.testnet.yml up`

### 4. Verify Deployment
```bash
# Check authorized solvers
near view <contract> get_authorized_solvers '{}'

# Run integration tests
npm run test:testnet
```

## Contract Methods

### Initialization
- `new(treasury_account_id: AccountId)`

### Intent Management
- `submit_intent(signed_intent: SignedIntent) -> String`
- `commit_execution(intent_hash, solver_id, venue, fill_price, notional, fees_bps)`
- `post_settlement(intent_hash, token, amount, pnl, fee, rebate)`
- `finalize_intent(intent_hash)`

### Admin Functions
- `add_authorized_solver(solver_id: AccountId)`

### View Methods
- `get_intent(intent_hash: String) -> Option<DerivativesIntent>`
- `get_receipt(intent_hash: String) -> Option<IntentReceipt>`
- `get_authorized_solvers() -> Vec<AccountId>`

## Resources

- [NEAR Testnet Explorer](https://testnet.nearblocks.io)
- [NEAR Testnet Wallet](https://testnet.mynearwallet.com)
- [NEAR Documentation](https://docs.near.org)