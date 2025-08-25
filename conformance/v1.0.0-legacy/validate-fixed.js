#!/usr/bin/env node

/**
 * Validation script for DeltaNEAR conformance test vectors
 * FIXED VERSION - Matches Rust canonicalization implementation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

/**
 * Apply RFC-8785 style canonicalization matching Rust implementation
 */
class RustCompatibleCanonicalizer {
  canonicalize(obj) {
    // Check if this is an intent (has the required fields)
    if (obj.version && obj.intent_type && obj.derivatives) {
      // This is an intent - apply strict validation
      this.validateIntent(obj);
      const canonical = this.canonicalizeIntent(obj);
      return JSON.stringify(canonical);
    } else {
      // This is a solver API message - just normalize
      return JSON.stringify(obj);
    }
  }

  validateIntent(intent) {
    const rootKeys = Object.keys(intent).sort();
    const expected = ['deadline', 'derivatives', 'intent_type', 'nonce', 'signer_id', 'version'];
    if (JSON.stringify(rootKeys) !== JSON.stringify(expected)) {
      throw new Error(`Invalid root fields. Expected ${expected}, got ${rootKeys}`);
    }

    if (intent.version !== '1.0.0') {
      throw new Error(`Invalid version: ${intent.version}. Must be 1.0.0`);
    }

    if (intent.intent_type !== 'derivatives') {
      throw new Error(`Invalid intent_type: ${intent.intent_type}. Must be 'derivatives'`);
    }
  }

  canonicalizeIntent(intent) {
    const canonical = {};
    
    canonical.deadline = this.normalizeTimestamp(intent.deadline);
    canonical.derivatives = this.canonicalizeDerivatives(intent.derivatives);
    canonical.intent_type = 'derivatives';
    canonical.nonce = String(intent.nonce).trim();
    canonical.signer_id = intent.signer_id.trim().toLowerCase();
    canonical.version = '1.0.0';
    
    return canonical;
  }

  canonicalizeDerivatives(deriv) {
    const required = ['collateral', 'instrument', 'side', 'size', 'symbol'];
    for (const field of required) {
      if (!(field in deriv)) {
        throw new Error(`Missing required field in derivatives: ${field}`);
      }
    }

    const canonical = {};
    
    canonical.collateral = this.canonicalizeCollateral(deriv.collateral);
    canonical.constraints = this.canonicalizeConstraints(deriv.constraints);
    
    const instrument = deriv.instrument.trim().toLowerCase();
    if (!['perp', 'option'].includes(instrument)) {
      throw new Error(`Invalid instrument: ${instrument}`);
    }
    canonical.instrument = instrument;
    
    if (deriv.leverage !== undefined) {
      canonical.leverage = this.canonicalizeDecimal(deriv.leverage, 1, 100, 2);
    } else {
      canonical.leverage = '1';
    }
    
    if (instrument === 'option') {
      if (!deriv.option) {
        throw new Error('Missing option params for option instrument');
      }
      canonical.option = this.canonicalizeOption(deriv.option);
    } else {
      canonical.option = null;
    }
    
    const side = deriv.side.trim().toLowerCase();
    if (!['long', 'short', 'buy', 'sell'].includes(side)) {
      throw new Error(`Invalid side: ${side}`);
    }
    canonical.side = side;
    
    canonical.size = this.canonicalizeDecimal(deriv.size, 0.00000001, 1000000, 8);
    
    const symbol = deriv.symbol.trim().toUpperCase();
    if (!symbol.includes('-')) {
      throw new Error(`Invalid symbol format: ${symbol}`);
    }
    canonical.symbol = symbol;
    
    return canonical;
  }

  canonicalizeCollateral(collateral) {
    const keys = Object.keys(collateral).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['chain', 'token'])) {
      throw new Error(`Collateral must have exactly 'token' and 'chain'. Got: ${keys}`);
    }
    
    const canonical = {};
    
    const chain = collateral.chain.trim().toLowerCase();
    if (!['near', 'ethereum', 'arbitrum', 'base', 'solana'].includes(chain)) {
      throw new Error(`Invalid chain: ${chain}`);
    }
    canonical.chain = chain;
    canonical.token = collateral.token.trim();
    
    return canonical;
  }

  canonicalizeConstraints(constraints) {
    const canonical = {};
    
    canonical.max_fee_bps = 30;
    canonical.max_funding_bps_8h = 50;
    canonical.max_slippage_bps = 100;
    canonical.venue_allowlist = [];
    
    if (constraints) {
      if (constraints.max_fee_bps !== undefined) {
        const val = Number(constraints.max_fee_bps);
        if (val > 100) throw new Error(`max_fee_bps ${val} exceeds 100`);
        canonical.max_fee_bps = val;
      }
      
      if (constraints.max_funding_bps_8h !== undefined) {
        const val = Number(constraints.max_funding_bps_8h);
        if (val > 100) throw new Error(`max_funding_bps_8h ${val} exceeds 100`);
        canonical.max_funding_bps_8h = val;
      }
      
      if (constraints.max_slippage_bps !== undefined) {
        const val = Number(constraints.max_slippage_bps);
        if (val > 1000) throw new Error(`max_slippage_bps ${val} exceeds 1000`);
        canonical.max_slippage_bps = val;
      }
      
      if (constraints.venue_allowlist) {
        canonical.venue_allowlist = [...new Set(
          constraints.venue_allowlist.map(v => v.trim().toLowerCase())
        )].sort();
      }
    }
    
    return canonical;
  }

  canonicalizeOption(option) {
    const keys = Object.keys(option).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['expiry', 'kind', 'strike'])) {
      throw new Error(`Option must have exactly 'kind', 'strike', 'expiry'. Got: ${keys}`);
    }
    
    const canonical = {};
    
    canonical.expiry = this.normalizeTimestamp(option.expiry);
    
    const kind = option.kind.trim().toLowerCase();
    if (!['call', 'put'].includes(kind)) {
      throw new Error(`Invalid option kind: ${kind}`);
    }
    canonical.kind = kind;
    
    canonical.strike = this.canonicalizeDecimal(option.strike, 0.01, 1000000000, 2);
    
    return canonical;
  }

  canonicalizeDecimal(value, min, max, precision) {
    let str = String(value).trim();
    
    if (str.includes('e') || str.includes('E')) {
      throw new Error(`Scientific notation not allowed: ${str}`);
    }
    
    if (str.length > 1 && str.startsWith('0') && !str.startsWith('0.')) {
      throw new Error(`Leading zeros not allowed: ${str}`);
    }
    
    if (str.startsWith('+')) {
      throw new Error(`Positive sign not allowed: ${str}`);
    }
    
    if (str.startsWith('-')) {
      throw new Error(`Negative values not allowed: ${str}`);
    }
    
    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      throw new Error(`Invalid decimal: ${str}`);
    }
    
    if (parsed < min || parsed > max) {
      throw new Error(`Value ${str} out of range [${min}, ${max}]`);
    }
    
    if (str.includes('.')) {
      const decimals = str.split('.')[1].length;
      if (decimals > precision) {
        throw new Error(`Value ${str} exceeds ${precision} decimal places`);
      }
    }
    
    if (parsed === 0) {
      return '0';
    } else if (parsed === Math.floor(parsed)) {
      return String(Math.floor(parsed));
    } else {
      let result = String(parsed);
      if (result.includes('.')) {
        result = result.replace(/\.?0+$/, '');
        if (result.endsWith('.')) {
          result = result.slice(0, -1);
        }
      }
      return result;
    }
  }

  normalizeTimestamp(ts) {
    const trimmed = ts.trim();
    
    if (!trimmed.endsWith('Z')) {
      throw new Error(`Timestamp must end with 'Z': ${ts}`);
    }
    
    let normalized = trimmed;
    if (trimmed.includes('.')) {
      const parts = trimmed.split('.');
      if (parts.length !== 2) {
        throw new Error(`Invalid timestamp format: ${ts}`);
      }
      normalized = parts[0] + 'Z';
    }
    
    if (normalized.length !== 20) {
      throw new Error(`Invalid timestamp length: ${normalized}`);
    }
    
    return normalized;
  }
}

/**
 * Compute SHA-256 hash
 */
function computeSha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Validate a single test vector
 */
function validateTestVector(category, testName) {
  const dir = path.join(__dirname, category, testName);
  
  try {
    // Read test files
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'raw.json'), 'utf8'));
    const expectedCanonical = fs.readFileSync(path.join(dir, 'canonical.json'), 'utf8');
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
    
    // Apply canonicalization
    const canonicalizer = new RustCompatibleCanonicalizer();
    const actualCanonical = canonicalizer.canonicalize(raw);
    
    // Compute hash
    const actualSha256 = computeSha256(actualCanonical);
    
    // Validate results
    const errors = [];
    
    // Check canonical form matches
    if (actualCanonical !== expectedCanonical) {
      errors.push({
        type: 'canonical_mismatch',
        expected: expectedCanonical.substring(0, 100) + '...',
        actual: actualCanonical.substring(0, 100) + '...'
      });
    }
    
    // Check SHA-256 matches
    if (actualSha256 !== expected.sha256) {
      errors.push({
        type: 'sha256_mismatch',
        expected: expected.sha256,
        actual: actualSha256
      });
    }
    
    // Check byte length matches
    const actualByteLength = Buffer.from(actualCanonical, 'utf8').length;
    if (actualByteLength !== expected.byte_length) {
      errors.push({
        type: 'byte_length_mismatch',
        expected: expected.byte_length,
        actual: actualByteLength
      });
    }
    
    return {
      name: testName,
      category: category,
      passed: errors.length === 0,
      errors: errors,
      notes: expected.normalization_notes
    };
    
  } catch (error) {
    return {
      name: testName,
      category: category,
      passed: false,
      errors: [{
        type: 'exception',
        message: error.message
      }]
    };
  }
}

/**
 * Validate negative test vectors
 */
function validateNegativeTests() {
  const negativeTests = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'canonical-hashing/negative/negative_tests.json'), 'utf8')
  );
  
  const results = [];
  const canonicalizer = new RustCompatibleCanonicalizer();
  
  for (const test of negativeTests) {
    try {
      // This SHOULD throw an error
      canonicalizer.canonicalize(test.intent);
      results.push({
        name: test.name,
        passed: false,
        error: 'Should have rejected but did not'
      });
    } catch (error) {
      // Expected to throw - check if error message is reasonable
      const passed = error.message.toLowerCase().includes(test.reason.toLowerCase().split(':')[0]);
      results.push({
        name: test.name,
        passed: passed,
        expected_reason: test.reason,
        actual_error: error.message
      });
    }
  }
  
  return results;
}

/**
 * Validate all test vectors
 */
function validateAll() {
  console.log(`${colors.blue}DeltaNEAR Conformance Test Validation v1.0.0 (FIXED)${colors.reset}\n`);
  console.log('Validating test vectors against Rust-compatible canonicalizer...\n');
  
  const categories = [
    'canonical-hashing',
    'solver-api'
  ];
  
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const results = [];
  
  // Validate positive test vectors
  for (const category of categories) {
    const categoryPath = path.join(__dirname, category);
    if (!fs.existsSync(categoryPath)) continue;
    
    const tests = fs.readdirSync(categoryPath).filter(f => {
      const fullPath = path.join(categoryPath, f);
      return fs.statSync(fullPath).isDirectory() && f !== 'negative';
    });
    
    console.log(`${colors.blue}${category}:${colors.reset}`);
    
    for (const test of tests) {
      totalTests++;
      const result = validateTestVector(category, test);
      results.push(result);
      
      if (result.passed) {
        passedTests++;
        console.log(`  ${colors.green}✓${colors.reset} ${test}`);
      } else {
        failedTests++;
        console.log(`  ${colors.red}✗${colors.reset} ${test}`);
        for (const error of result.errors) {
          console.log(`    ${colors.red}└─ ${error.type}${colors.reset}`);
          if (error.message) {
            console.log(`       ${colors.gray}${error.message}${colors.reset}`);
          }
        }
      }
    }
    console.log('');
  }
  
  // Validate negative test vectors
  console.log(`${colors.blue}Negative Tests (Should Reject):${colors.reset}`);
  const negativeResults = validateNegativeTests();
  
  for (const result of negativeResults) {
    totalTests++;
    if (result.passed) {
      passedTests++;
      console.log(`  ${colors.green}✓${colors.reset} ${result.name} - Correctly rejected`);
    } else {
      failedTests++;
      console.log(`  ${colors.red}✗${colors.reset} ${result.name}`);
      console.log(`    ${colors.gray}${result.error || result.actual_error}${colors.reset}`);
    }
  }
  console.log('');
  
  // Print summary
  console.log('─'.repeat(60));
  console.log(`\n${colors.blue}Summary:${colors.reset}`);
  console.log(`  Total tests: ${totalTests}`);
  console.log(`  ${colors.green}Passed: ${passedTests}${colors.reset}`);
  console.log(`  ${colors.red}Failed: ${failedTests}${colors.reset}`);
  
  if (failedTests === 0) {
    console.log(`\n${colors.green}✅ All conformance tests passed!${colors.reset}`);
    console.log('Your implementation is conformant with DeltaNEAR v1.0.0\n');
    process.exit(0);
  } else {
    console.log(`\n${colors.red}❌ Some tests failed.${colors.reset}`);
    console.log('Please review the errors above and fix your implementation.\n');
    process.exit(1);
  }
}

// Run validation
if (require.main === module) {
  validateAll();
}

module.exports = {
  RustCompatibleCanonicalizer,
  validateTestVector,
  validateAll
};