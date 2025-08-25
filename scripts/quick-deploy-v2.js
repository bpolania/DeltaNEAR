#!/usr/bin/env node

const { execSync } = require('child_process');
const crypto = require('crypto');

async function quickDeployV2() {
  console.log('Quick Deploy DeltaNEAR V2 to Testnet');
  console.log('=====================================');
  
  try {
    // Generate a random account suffix
    const suffix = crypto.randomBytes(4).toString('hex');
    const devAccount = `dev-v2-${suffix}.testnet`;
    
    console.log(`\n1. Generating dev account: ${devAccount}`);
    
    // Create a temporary NEAR CLI configuration for dev deploy
    console.log('\n2. Preparing for deployment...');
    
    // Generate near dev-deploy command
    const deployCmd = `near dev-deploy contracts/near-intents-derivatives/target/near/deltanear_derivatives.wasm --initFunction new --initArgs '{"treasury_account_id": "${devAccount}"}' --networkId testnet`;
    
    console.log('\n3. Executing deployment...');
    console.log('Command:', deployCmd);
    
    // Note: This would require NEAR CLI to be logged in
    console.log('\nDEPLOYMENT READY - Run this command:');
    console.log('=====================================');
    console.log(deployCmd);
    console.log('');
    console.log('After deployment, test with:');
    console.log(`near view [DEPLOYED_ACCOUNT] get_schema_version '{}' --networkId testnet`);
    console.log(`near view [DEPLOYED_ACCOUNT] get_authorized_solvers '{}' --networkId testnet`);
    console.log('');
    console.log('V2 Features to test:');
    console.log('- Schema version should be "2.0.0"');
    console.log('- V2 Intent validation available');
    console.log('- Enhanced metadata and execution logging');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

quickDeployV2().catch(console.error);