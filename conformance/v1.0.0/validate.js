#!/usr/bin/env node

/**
 * Validation script for DeltaNEAR conformance test vectors
 * Validates that an implementation correctly canonicalizes all test cases
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
 * Apply RFC-8785 style canonicalization (same as generator)
 */
class Canonicalizer {
  canonicalize(obj) {
    const normalized = this.normalize(obj);
    return JSON.stringify(normalized);
  }

  normalize(obj) {
    if (obj === null) return null;
    if (obj === undefined) return undefined;
    
    if (typeof obj === 'boolean') return obj;
    if (typeof obj === 'string') {
      // Check if string looks like a number that needs normalization
      if (this.isNumericString(obj)) {
        return this.normalizeNumericString(obj);
      }
      return this.normalizeString(obj);
    }
    if (typeof obj === 'number') return this.normalizeNumber(obj);
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.normalize(item));
    }
    
    if (typeof obj === 'object') {
      const sorted = {};
      Object.keys(obj).sort().forEach(key => {
        const value = this.normalize(obj[key]);
        if (value !== undefined) {
          sorted[key] = value;
        }
      });
      return sorted;
    }
    
    return obj;
  }

  isNumericString(str) {
    // Check if string represents a number
    if (typeof str !== 'string') return false;
    // Must be a valid number when parsed
    const num = Number(str);
    return !isNaN(num) && str.trim() !== '';
  }

  normalizeNumericString(str) {
    const num = Number(str);
    return this.normalizeNumber(num);
  }

  normalizeString(str) {
    return str.normalize('NFC');
  }

  normalizeNumber(num) {
    let str = num.toString();
    
    if (str.includes('e') || str.includes('E')) {
      const n = Number(num);
      if (n === 0) return '0';
      str = n.toString();
    }
    
    if (str.includes('.')) {
      str = str.replace(/\.?0+$/, '');
      if (str.endsWith('.')) {
        str = str.slice(0, -1);
      }
    }
    
    return str;
  }

  normalizeTimestamp(timestamp) {
    const date = new Date(timestamp);
    const iso = date.toISOString();
    return iso.replace(/\.\d{3}/, '');
  }
}

/**
 * Compute SHA-256 hash
 */
function computeSha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Apply timestamp normalization recursively
 */
function normalizeTimestamps(obj) {
  if (obj === null || obj === undefined) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeTimestamps(item));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && 
          (key === 'deadline' || key === 'expiry' || key === 'timestamp' || 
           key === 'estimated_completion' || key === 'created_at' || key === 'updated_at')) {
        // Normalize timestamp fields
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          result[key] = date.toISOString().replace(/\.\d{3}/, '');
        } else {
          result[key] = value;
        }
      } else {
        result[key] = normalizeTimestamps(value);
      }
    }
    return result;
  }
  
  return obj;
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
    const canonicalizer = new Canonicalizer();
    
    // Apply timestamp normalization recursively
    const processedRaw = normalizeTimestamps(JSON.parse(JSON.stringify(raw)));
    
    const actualCanonical = canonicalizer.canonicalize(processedRaw);
    
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
 * Validate all test vectors
 */
function validateAll() {
  console.log(`${colors.blue}DeltaNEAR Conformance Test Validation v1.0.0${colors.reset}\n`);
  console.log('Validating test vectors...\n');
  
  const categories = [
    'canonical-hashing',
    'solver-api'
  ];
  
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const results = [];
  
  for (const category of categories) {
    const categoryPath = path.join(__dirname, category);
    if (!fs.existsSync(categoryPath)) continue;
    
    const tests = fs.readdirSync(categoryPath).filter(f => 
      fs.statSync(path.join(categoryPath, f)).isDirectory()
    );
    
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
    
    // Show detailed errors for failed tests
    console.log(`${colors.yellow}Detailed Error Report:${colors.reset}\n`);
    for (const result of results) {
      if (!result.passed) {
        console.log(`${colors.red}${result.category}/${result.name}:${colors.reset}`);
        for (const error of result.errors) {
          console.log(`  Error Type: ${error.type}`);
          if (error.expected !== undefined) {
            console.log(`    Expected: ${error.expected}`);
            console.log(`    Actual:   ${error.actual}`);
          }
          if (error.message) {
            console.log(`    Message: ${error.message}`);
          }
        }
        console.log('');
      }
    }
    
    process.exit(1);
  }
}

// Run validation
if (require.main === module) {
  validateAll();
}

module.exports = {
  Canonicalizer,
  validateTestVector,
  validateAll
};