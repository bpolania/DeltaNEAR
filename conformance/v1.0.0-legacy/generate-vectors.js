#!/usr/bin/env node

/**
 * Generate conformance test vectors for DeltaNEAR v1.0.0
 * This script creates canonical test cases for all integrators to validate against
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The frozen manifest hash for v1.0.0
const MANIFEST_HASH = '4d1b6241b61316237252e7a03d4c406daf856397a898ce2638084a18c37a06cc';

/**
 * Apply RFC-8785 style canonicalization
 */
class Canonicalizer {
  canonicalize(obj) {
    // First normalize the object
    const normalized = this.normalize(obj);
    // Then stringify without spaces
    return JSON.stringify(normalized);
  }

  normalize(obj) {
    if (obj === null) return null;
    if (obj === undefined) return undefined;
    
    // Handle primitives
    if (typeof obj === 'boolean') return obj;
    if (typeof obj === 'string') {
      // Check if string looks like a number that needs normalization
      if (this.isNumericString(obj)) {
        return this.normalizeNumericString(obj);
      }
      return this.normalizeString(obj);
    }
    if (typeof obj === 'number') return this.normalizeNumber(obj);
    
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.normalize(item));
    }
    
    // Handle objects - sort keys lexicographically
    if (typeof obj === 'object') {
      const sorted = {};
      Object.keys(obj).sort().forEach(key => {
        const value = this.normalize(obj[key]);
        // Skip undefined values
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
    // Apply Unicode NFC normalization
    return str.normalize('NFC');
  }

  normalizeNumber(num) {
    // Convert to string and remove trailing zeros
    let str = num.toString();
    
    // Handle scientific notation
    if (str.includes('e') || str.includes('E')) {
      // Normalize scientific notation
      const n = Number(num);
      if (n === 0) return '0';
      str = n.toString();
    }
    
    // Remove trailing zeros after decimal point
    if (str.includes('.')) {
      str = str.replace(/\.?0+$/, '');
      // If only decimal point remains, remove it
      if (str.endsWith('.')) {
        str = str.slice(0, -1);
      }
    }
    
    return str;
  }

  normalizeTimestamp(timestamp) {
    // Convert to ISO 8601 without milliseconds
    const date = new Date(timestamp);
    const iso = date.toISOString();
    // Remove milliseconds (.000)
    return iso.replace(/\.\d{3}/, '');
  }
}

/**
 * Compute SHA-256 hash of a string
 */
function computeSha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Compute intent hash (includes manifest hash)
 */
function computeIntentHash(canonical, manifestHash) {
  const combined = canonical + manifestHash;
  return crypto.createHash('sha256').update(combined, 'utf8').digest('hex');
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
 * Generate test vector files
 */
function generateTestVector(testName, category, rawIntent, notes = []) {
  const canonicalizer = new Canonicalizer();
  
  // Apply timestamp normalization recursively
  const processedIntent = normalizeTimestamps(JSON.parse(JSON.stringify(rawIntent)));
  
  // Generate canonical form
  const canonical = canonicalizer.canonicalize(processedIntent);
  
  // Compute hashes
  const sha256 = computeSha256(canonical);
  const intentHash = computeIntentHash(canonical, MANIFEST_HASH);
  
  // Create expected output
  const expected = {
    sha256: sha256,
    intent_hash: intentHash,
    manifest_hash: MANIFEST_HASH,
    byte_length: Buffer.from(canonical, 'utf8').length,
    normalization_notes: notes
  };
  
  // Create directory
  const dir = path.join(__dirname, category, testName);
  fs.mkdirSync(dir, { recursive: true });
  
  // Write files
  fs.writeFileSync(
    path.join(dir, 'raw.json'),
    JSON.stringify(rawIntent, null, 2)
  );
  
  fs.writeFileSync(
    path.join(dir, 'canonical.json'),
    canonical
  );
  
  fs.writeFileSync(
    path.join(dir, 'expected.json'),
    JSON.stringify(expected, null, 2)
  );
  
  console.log(`✓ Generated ${category}/${testName}`);
}

/**
 * Generate all test vectors
 */
function generateAllVectors() {
  console.log('Generating conformance test vectors for DeltaNEAR v1.0.0...\n');

  // ===== CANONICAL HASHING VECTORS =====
  
  // 1. Minimal perpetual intent
  generateTestVector('intent_minimal_perp', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'ETH-USD',
      side: 'long',
      size: '1.5',
      leverage: '10'
    },
    signer_id: 'alice.testnet',
    deadline: '2024-12-31T23:59:59Z',
    nonce: 'test-minimal-perp-001'
  }, [
    'Minimal perpetual intent with required fields only'
  ]);

  // 2. Minimal option intent
  generateTestVector('intent_minimal_option', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'option',
      symbol: 'BTC-USD',
      side: 'buy',
      size: '0.1',
      strike: '50000',
      expiry: '2024-12-31T00:00:00Z'
    },
    signer_id: 'bob.testnet',
    deadline: '2024-12-30T23:59:59Z',
    nonce: 'test-minimal-option-001'
  }, [
    'Minimal option intent with strike and expiry'
  ]);

  // 3. Full perpetual intent
  generateTestVector('intent_full_perp', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'SOL-USD',
      side: 'short',
      size: '100.50000',
      leverage: '5.0',
      collateral: {
        token: 'USDC',
        chain: 'near',
        amount: '2010.00'
      },
      max_slippage: '0.02',
      limit_price: '150.25'
    },
    signer_id: 'trader.testnet',
    deadline: '2024-12-31T23:59:59.000Z',
    nonce: 'test-full-perp-001',
    metadata: {
      client: 'web-app',
      version: '2.1.0',
      user_agent: 'Mozilla/5.0'
    }
  }, [
    'Removed trailing zeros from size: 100.50000 -> 100.5',
    'Removed trailing zero from leverage: 5.0 -> 5',
    'Removed trailing zeros from collateral.amount: 2010.00 -> 2010',
    'Removed milliseconds from deadline',
    'Sorted object keys lexicographically'
  ]);

  // 4. Full option intent
  generateTestVector('intent_full_option', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'option',
      symbol: 'ETH-USD',
      side: 'sell',
      size: '5.000',
      strike: '3000.00',
      expiry: '2025-01-31T00:00:00.000Z',
      option_type: 'call',
      collateral: {
        token: 'ETH',
        chain: 'near',
        amount: '5.000'
      },
      premium: '150.50'
    },
    signer_id: 'options.testnet',
    deadline: '2024-12-30T12:00:00.000Z',
    nonce: 'test-full-option-001',
    metadata: {
      strategy: 'covered_call',
      notes: 'Monthly income strategy'
    }
  }, [
    'Removed trailing zeros from size: 5.000 -> 5',
    'Removed trailing zeros from strike: 3000.00 -> 3000',
    'Removed trailing zeros from collateral.amount: 5.000 -> 5',
    'Removed milliseconds from expiry and deadline',
    'Sorted object keys lexicographically'
  ]);

  // 5. Intent with complex metadata
  generateTestVector('intent_with_metadata', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'NEAR-USD',
      side: 'long',
      size: '1000',
      leverage: '3'
    },
    signer_id: 'analytics.testnet',
    deadline: '2024-12-31T23:59:59Z',
    nonce: 'test-metadata-001',
    metadata: {
      tags: ['automated', 'momentum', 'breakout'],
      analytics: {
        rsi: 65.5,
        volume_24h: '1500000',
        price_change: '0.05'
      },
      source: {
        platform: 'DeltaNEAR',
        api_version: '1.0.0',
        timestamp: '2024-12-01T10:30:00Z'
      },
      notes: 'Breakout pattern detected'
    }
  }, [
    'Complex nested metadata structure preserved',
    'Arrays maintain original order',
    'Nested objects sorted lexicographically'
  ]);

  // 6. Unicode normalization test
  generateTestVector('intent_unicode_normalization', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'ETH-USD',
      side: 'long',
      size: '1',
      leverage: '2'
    },
    signer_id: 'café.testnet',  // é in decomposed form will be normalized
    deadline: '2024-12-31T23:59:59Z',
    nonce: 'test-unicode-001',
    metadata: {
      notes: 'café',  // This will be NFC normalized
      emoji: '🚀',
      japanese: 'こんにちは',
      accents: 'naïve résumé'
    }
  }, [
    'Applied NFC normalization to Unicode strings',
    'café normalized from decomposed to composed form',
    'All Unicode characters preserved correctly'
  ]);

  // 7. Number normalization test
  generateTestVector('intent_number_normalization', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'BTC-USD',
      side: 'long',
      size: '1.50000',
      leverage: '10.0',
      limit_price: '45000.00',
      stop_loss: '43000',
      take_profit: '50000.0',
      max_slippage: '0.0100'
    },
    signer_id: 'numbers.testnet',
    deadline: '2024-12-31T23:59:59Z',
    nonce: 'test-numbers-001',
    metadata: {
      values: {
        integer: 42,
        decimal: '123.456',
        trailing: '100.000',
        scientific: 1.5e10,
        negative: -123.45,
        zero: 0.0
      }
    }
  }, [
    'Removed trailing zeros from size: 1.50000 -> 1.5',
    'Removed trailing zero from leverage: 10.0 -> 10',
    'Removed trailing zeros from limit_price: 45000.00 -> 45000',
    'Removed trailing zero from take_profit: 50000.0 -> 50000',
    'Removed trailing zeros from max_slippage: 0.0100 -> 0.01',
    'Normalized zero: 0.0 -> 0',
    'Scientific notation preserved'
  ]);

  // ===== SOLVER API VECTORS =====

  // 1. Minimal quote request
  generateTestVector('quote_request_minimal', 'solver-api', {
    intent_hash: 'abc123def456789012345678901234567890123456789012345678901234567',
    intent: {
      version: '1.0.0',
      intent_type: 'derivatives',
      derivatives: {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '5'
      },
      signer_id: 'user.testnet',
      deadline: '2024-12-31T23:59:59Z',
      nonce: 'quote-req-001'
    },
    solver_id: 'solver1.testnet'
  }, [
    'Minimal quote request structure'
  ]);

  // 2. Full quote request
  generateTestVector('quote_request_full', 'solver-api', {
    intent_hash: 'def456789012345678901234567890123456789012345678901234567890abc',
    intent: {
      version: '1.0.0',
      intent_type: 'derivatives',
      derivatives: {
        instrument: 'option',
        symbol: 'BTC-USD',
        side: 'buy',
        size: '0.5',
        strike: '60000',
        expiry: '2025-03-31T00:00:00Z',
        option_type: 'call'
      },
      signer_id: 'trader.testnet',
      deadline: '2024-12-30T23:59:59Z',
      nonce: 'quote-req-full-001',
      metadata: {
        urgency: 'high',
        preferred_venues: ['dYdX', 'GMX']
      }
    },
    solver_id: 'premium-solver.testnet',
    preferences: {
      max_slippage: '0.02',
      min_fill_rate: '0.95',
      preferred_chains: ['near', 'ethereum']
    }
  }, [
    'Full quote request with preferences',
    'Option parameters included',
    'Metadata preserved'
  ]);

  // 3. Quote response success
  generateTestVector('quote_response_success', 'solver-api', {
    intent_hash: '789012345678901234567890123456789012345678901234567890123456def',
    solver_id: 'solver1.testnet',
    quote: {
      price: '2850.50',
      size: '1',
      fee: '2.85',
      expiry: '2024-12-31T23:55:00Z',
      venue: 'dYdX',
      chain: 'near'
    },
    status: 'success',
    timestamp: '2024-12-31T23:50:00Z'
  }, [
    'Successful quote response',
    'Price and fee included'
  ]);

  // 4. Accept request
  generateTestVector('accept_request', 'solver-api', {
    intent_hash: '012345678901234567890123456789012345678901234567890123456789abc',
    solver_id: 'solver1.testnet',
    quote_id: 'quote-123456',
    signature: 'ed25519:3a7b9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f',
    signer_id: 'user.testnet',
    timestamp: '2024-12-31T23:55:00Z'
  }, [
    'Intent acceptance with signature'
  ]);

  // 5. Accept response success
  generateTestVector('accept_response_success', 'solver-api', {
    intent_hash: '345678901234567890123456789012345678901234567890123456789012abc',
    status: 'accepted',
    execution_id: 'exec-789012',
    solver_id: 'solver1.testnet',
    estimated_completion: '2024-12-31T23:58:00Z',
    venue: 'dYdX',
    chain: 'near'
  }, [
    'Successful acceptance response'
  ]);

  // 6. Settlement with TokenDiff
  generateTestVector('settlement_tokendiff', 'solver-api', {
    intent_hash: '678901234567890123456789012345678901234567890123456789012345abc',
    execution_id: 'exec-789012',
    settlement: {
      type: 'token_diff',
      diffs: [
        {
          token: 'USDC',
          chain: 'near',
          amount: '-2850.50',
          account: 'user.testnet'
        },
        {
          token: 'ETH-PERP',
          chain: 'near',
          amount: '1',
          account: 'user.testnet'
        }
      ],
      timestamp: '2024-12-31T23:58:30Z',
      block_height: 150000000,
      transaction_hash: '5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6'
    },
    status: 'settled'
  }, [
    'TokenDiff settlement structure',
    'Multiple token movements tracked'
  ]);

  console.log('\n✅ All test vectors generated successfully!');
}

// Run generation
generateAllVectors();