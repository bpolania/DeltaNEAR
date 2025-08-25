#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONTRACT_WASM = 'contracts/near-intents-derivatives/target/near/deltanear_derivatives.wasm';
const TREASURY_ACCOUNT = 'treasury-v2.testnet'; // You'll need to create this
const CONTRACT_ACCOUNT = 'deltanear-v2-demo.testnet'; // You'll need to create this

async function deployV2Contract() {
  console.log('DeltaNEAR V2 Contract Testnet Deployment');
  console.log('=========================================');
  
  // Check if WASM file exists
  if (!fs.existsSync(CONTRACT_WASM)) {
    console.error(`✗ WASM file not found: ${CONTRACT_WASM}`);
    console.log('Run: cd contracts/near-intents-derivatives && cargo near build non-reproducible-wasm');
    process.exit(1);
  }
  
  const wasmStats = fs.statSync(CONTRACT_WASM);
  console.log(`✓ WASM file found: ${(wasmStats.size / 1024).toFixed(2)} KB`);
  
  // Copy WASM to deploy directory
  const deployWasm = 'deploy/deltanear_v2.wasm';
  execSync(`cp "${CONTRACT_WASM}" "${deployWasm}"`);
  console.log(`✓ WASM copied to: ${deployWasm}`);
  
  // Generate deployment instructions
  console.log('\nDeployment Instructions:');
  console.log('========================');
  console.log('1. Create accounts (if not already created):');
  console.log(`   near create-account ${TREASURY_ACCOUNT} --masterAccount YOUR_ACCOUNT.testnet`);
  console.log(`   near create-account ${CONTRACT_ACCOUNT} --masterAccount YOUR_ACCOUNT.testnet`);
  console.log('');
  console.log('2. Deploy and initialize contract:');
  console.log(`   near deploy --accountId ${CONTRACT_ACCOUNT} --wasmFile ${deployWasm} --initFunction new --initArgs '{"treasury_account_id": "${TREASURY_ACCOUNT}"}'`);
  console.log('');
  console.log('3. Verify deployment:');
  console.log(`   near view ${CONTRACT_ACCOUNT} get_schema_version '{}'`);
  console.log(`   near view ${CONTRACT_ACCOUNT} get_contract_version '{}'`);
  console.log(`   near view ${CONTRACT_ACCOUNT} get_authorized_solvers '{}'`);
  console.log('');
  console.log('4. Test V2 Intent validation:');
  const testIntent = {
    version: "1.0.0",
    intent_type: "derivatives",
    derivatives: {
      collateral: { token: "USDC", chain: "arbitrum" },
      constraints: { max_fee_bps: 30, max_funding_bps_8h: 50, max_slippage_bps: 100, venue_allowlist: ["gmx-v2"] },
      instrument: "perp",
      leverage: "5",
      side: "long", 
      size: "1.5",
      symbol: "ETH-USD"
    },
    signer_id: "alice.testnet",
    deadline: "2024-12-31T23:59:59Z",
    nonce: "test-001"
  };
  
  console.log(`   near view ${CONTRACT_ACCOUNT} validate_v2_intent '${JSON.stringify({ intent: testIntent }).replace(/'/g, "\\'")}'`);
  console.log('');
  console.log('5. Add authorized solvers:');
  console.log(`   near call ${CONTRACT_ACCOUNT} add_authorized_solver '{"solver_id": "solver1.testnet"}' --accountId ${CONTRACT_ACCOUNT}`);
  console.log(`   near call ${CONTRACT_ACCOUNT} add_authorized_solver '{"solver_id": "solver2.testnet"}' --accountId ${CONTRACT_ACCOUNT}`);
  console.log('');
  console.log('Contract Features Available:');
  console.log('- ✓ V2 Schema support (Collateral + Constraints)');
  console.log('- ✓ Intent validation with proper error handling');
  console.log('- ✓ Metadata storage and retrieval');
  console.log('- ✓ Execution logging');
  console.log('- ✓ Authorized solver management');
  console.log('- ✓ Schema version reporting (2.0.0)');
  
  // Create a test script for the deployed contract
  const testScript = `#!/usr/bin/env node

const { JsonRpcProvider } = require('@near-js/providers');

const CONTRACT_NAME = '${CONTRACT_ACCOUNT}';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });

async function testDeployedV2Contract() {
  console.log('Testing Deployed V2 Contract: ' + CONTRACT_NAME);
  console.log('='.repeat(50));
  
  try {
    // Test schema version
    const schemaResult = await provider.query({
      request_type: 'call_function',
      account_id: CONTRACT_NAME,
      method_name: 'get_schema_version',
      args_base64: btoa('{}'),
      finality: 'final'
    });
    const schemaVersion = JSON.parse(Buffer.from(schemaResult.result).toString());
    console.log('✓ Schema Version:', schemaVersion);
    
    // Test authorized solvers
    const solversResult = await provider.query({
      request_type: 'call_function',
      account_id: CONTRACT_NAME,
      method_name: 'get_authorized_solvers',
      args_base64: btoa('{}'),
      finality: 'final'
    });
    const solvers = JSON.parse(Buffer.from(solversResult.result).toString());
    console.log('✓ Authorized Solvers:', solvers);
    
  } catch (error) {
    console.error('✗ Error:', error.message);
  }
}

testDeployedV2Contract().catch(console.error);
`;
  
  fs.writeFileSync('test-deployed-v2.js', testScript);
  console.log('\n✓ Test script created: test-deployed-v2.js');
  console.log('Run after deployment: node test-deployed-v2.js');
}

deployV2Contract().catch(console.error);