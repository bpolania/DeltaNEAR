#!/usr/bin/env node

/**
 * DeltaNEAR V1.0.0 to V2.0.0 Migration Utility
 * 
 * Converts V1.0.0 intents to V2.0.0 format by:
 * 1. Mapping chain_id -> derivatives.collateral.chain
 * 2. Adding required derivatives.constraints with defaults
 * 3. Requiring explicit collateral token specification
 */

const fs = require('fs');
const { migrateV1ToV2, CHAIN_MAPPING } = require('../proto/dist/index.js');

function migrateWithLogging(v1Intent, options = {}) {
  console.log('🔄 Migrating V1.0.0 intent to V2.0.0...');
  
  const token = options.token;
  if (!token) {
    throw new Error('Token must be specified explicitly for V2.0.0. Use --token option (e.g., --token USDC)');
  }

  if (v1Intent.chain_id) {
    const chain = CHAIN_MAPPING[v1Intent.chain_id];
    console.log(`📦 Mapping chain_id '${v1Intent.chain_id}' -> collateral.chain '${chain}'`);
  }
  console.log(`🪙 Setting collateral.token to '${token}'`);

  const v2Intent = migrateV1ToV2(v1Intent, options);

  console.log('✅ Migration completed successfully');
  return v2Intent;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
DeltaNEAR V1.0.0 to V2.0.0 Migration Utility

Usage:
  node migrate-v1-to-v2.js --input <v1-file> --output <v2-file> --token <TOKEN>

Options:
  --input <file>     Input V1.0.0 intent JSON file
  --output <file>    Output V2.0.0 intent JSON file  
  --token <TOKEN>    Collateral token (USDC, USDT, DAI, etc.)
  --help            Show this help message

Examples:
  # Convert V1 intent to V2 with USDC collateral
  node migrate-v1-to-v2.js --input v1-intent.json --output v2-intent.json --token USDC
  
  # Convert with custom token
  node migrate-v1-to-v2.js --input old.json --output new.json --token NEAR
    `);
    return;
  }

  // Parse arguments
  const inputFile = args[args.indexOf('--input') + 1];
  const outputFile = args[args.indexOf('--output') + 1];
  const token = args[args.indexOf('--token') + 1];

  if (!inputFile || !outputFile || !token) {
    console.error('❌ Missing required arguments. Use --help for usage.');
    process.exit(1);
  }

  try {
    // Read V1 intent
    console.log(`📖 Reading V1.0.0 intent from ${inputFile}`);
    const v1Content = fs.readFileSync(inputFile, 'utf8');
    const v1Intent = JSON.parse(v1Content);

    // Migrate to V2
    const v2Intent = migrateWithLogging(v1Intent, { token });

    // Write V2 intent
    console.log(`💾 Writing V2.0.0 intent to ${outputFile}`);
    fs.writeFileSync(outputFile, JSON.stringify(v2Intent, null, 2));

    console.log('');
    console.log('🎉 Migration completed successfully!');
    console.log('');
    console.log('⚠️  Important:');
    console.log('   - V2.0.0 intents will produce different hashes than V1.0.0');
    console.log('   - Update your validation and canonicalization logic');
    console.log('   - Test thoroughly before production use');
    console.log('');

  } catch (error) {
    console.error(`❌ Migration failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { migrateWithLogging, migrateV1ToV2, CHAIN_MAPPING };