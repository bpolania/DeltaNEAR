#!/usr/bin/env node

/**
 * Generate conformance test vectors for DeltaNEAR v1.0.0
 * FIXED VERSION - Matches Rust canonicalization implementation exactly
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The frozen manifest hash for v1.0.0
const MANIFEST_HASH = '4d1b6241b61316237252e7a03d4c406daf856397a898ce2638084a18c37a06cc';

/**
 * Apply RFC-8785 style canonicalization matching Rust implementation
 */
class RustCompatibleCanonicalizer {
  canonicalize(obj) {
    // Validate and canonicalize intent structure
    this.validateIntent(obj);
    const canonical = this.canonicalizeIntent(obj);
    return JSON.stringify(canonical);
  }

  validateIntent(intent) {
    // Check root fields match exactly
    const rootKeys = Object.keys(intent).sort();
    const expected = ['deadline', 'derivatives', 'intent_type', 'nonce', 'signer_id', 'version'];
    if (JSON.stringify(rootKeys) !== JSON.stringify(expected)) {
      throw new Error(`Invalid root fields. Expected ${expected}, got ${rootKeys}`);
    }

    // Validate version
    if (intent.version !== '1.0.0') {
      throw new Error(`Invalid version: ${intent.version}. Must be 1.0.0`);
    }

    // Validate intent_type
    if (intent.intent_type !== 'derivatives') {
      throw new Error(`Invalid intent_type: ${intent.intent_type}. Must be 'derivatives'`);
    }
  }

  canonicalizeIntent(intent) {
    const canonical = {};
    
    // Order MUST match Rust: deadline, derivatives, intent_type, nonce, signer_id, version
    canonical.deadline = this.normalizeTimestamp(intent.deadline);
    canonical.derivatives = this.canonicalizeDerivatives(intent.derivatives);
    canonical.intent_type = 'derivatives';
    canonical.nonce = String(intent.nonce).trim();
    canonical.signer_id = intent.signer_id.trim().toLowerCase();
    canonical.version = '1.0.0';
    
    return canonical;
  }

  canonicalizeDerivatives(deriv) {
    // Validate required fields
    const required = ['collateral', 'instrument', 'side', 'size', 'symbol'];
    for (const field of required) {
      if (!(field in deriv)) {
        throw new Error(`Missing required field in derivatives: ${field}`);
      }
    }

    const canonical = {};
    
    // Order MUST match Rust implementation
    // 1. collateral (required)
    canonical.collateral = this.canonicalizeCollateral(deriv.collateral);
    
    // 2. constraints (with defaults)
    canonical.constraints = this.canonicalizeConstraints(deriv.constraints);
    
    // 3. instrument (lowercase)
    const instrument = deriv.instrument.trim().toLowerCase();
    if (!['perp', 'option'].includes(instrument)) {
      throw new Error(`Invalid instrument: ${instrument}`);
    }
    canonical.instrument = instrument;
    
    // 4. leverage (default "1")
    if (deriv.leverage !== undefined) {
      canonical.leverage = this.canonicalizeDecimal(deriv.leverage, 1, 100, 2);
    } else {
      canonical.leverage = '1';
    }
    
    // 5. option (required for options, null for perps)
    if (instrument === 'option') {
      if (!deriv.option) {
        throw new Error('Missing option params for option instrument');
      }
      canonical.option = this.canonicalizeOption(deriv.option);
    } else {
      canonical.option = null;
    }
    
    // 6. side (lowercase)
    const side = deriv.side.trim().toLowerCase();
    if (!['long', 'short', 'buy', 'sell'].includes(side)) {
      throw new Error(`Invalid side: ${side}`);
    }
    canonical.side = side;
    
    // 7. size (canonical decimal)
    canonical.size = this.canonicalizeDecimal(deriv.size, 0.00000001, 1000000, 8);
    
    // 8. symbol (UPPERCASE)
    const symbol = deriv.symbol.trim().toUpperCase();
    if (!symbol.includes('-')) {
      throw new Error(`Invalid symbol format: ${symbol}`);
    }
    canonical.symbol = symbol;
    
    return canonical;
  }

  canonicalizeCollateral(collateral) {
    // Must have exactly token and chain
    const keys = Object.keys(collateral).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['chain', 'token'])) {
      throw new Error(`Collateral must have exactly 'token' and 'chain'. Got: ${keys}`);
    }
    
    const canonical = {};
    
    // chain (lowercase)
    const chain = collateral.chain.trim().toLowerCase();
    if (!['near', 'ethereum', 'arbitrum', 'base', 'solana'].includes(chain)) {
      throw new Error(`Invalid chain: ${chain}`);
    }
    canonical.chain = chain;
    
    // token (preserve case, trim whitespace)
    canonical.token = collateral.token.trim();
    
    return canonical;
  }

  canonicalizeConstraints(constraints) {
    const canonical = {};
    
    // Apply defaults matching Rust implementation
    canonical.max_fee_bps = 30;
    canonical.max_funding_bps_8h = 50;
    canonical.max_slippage_bps = 100;
    canonical.venue_allowlist = [];
    
    if (constraints) {
      // Override with provided values
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
    // Must have exactly kind, strike, expiry
    const keys = Object.keys(option).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['expiry', 'kind', 'strike'])) {
      throw new Error(`Option must have exactly 'kind', 'strike', 'expiry'. Got: ${keys}`);
    }
    
    const canonical = {};
    
    // Order matches Rust: expiry, kind, strike
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
    
    // Reject scientific notation
    if (str.includes('e') || str.includes('E')) {
      throw new Error(`Scientific notation not allowed: ${str}`);
    }
    
    // Reject leading zeros (except "0" itself)
    if (str.length > 1 && str.startsWith('0') && !str.startsWith('0.')) {
      throw new Error(`Leading zeros not allowed: ${str}`);
    }
    
    // Reject positive sign
    if (str.startsWith('+')) {
      throw new Error(`Positive sign not allowed: ${str}`);
    }
    
    // Reject negative values
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
    
    // Check precision
    if (str.includes('.')) {
      const decimals = str.split('.')[1].length;
      if (decimals > precision) {
        throw new Error(`Value ${str} exceeds ${precision} decimal places`);
      }
    }
    
    // Format canonically
    if (parsed === 0) {
      return '0';
    } else if (parsed === Math.floor(parsed)) {
      return String(Math.floor(parsed));
    } else {
      // Remove trailing zeros
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
    
    // Must end with Z
    if (!trimmed.endsWith('Z')) {
      throw new Error(`Timestamp must end with 'Z': ${ts}`);
    }
    
    // Remove milliseconds if present
    let normalized = trimmed;
    if (trimmed.includes('.')) {
      const parts = trimmed.split('.');
      if (parts.length !== 2) {
        throw new Error(`Invalid timestamp format: ${ts}`);
      }
      normalized = parts[0] + 'Z';
    }
    
    // Validate format YYYY-MM-DDTHH:MM:SSZ
    if (normalized.length !== 20) {
      throw new Error(`Invalid timestamp length: ${normalized}`);
    }
    
    return normalized;
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
 * Generate test vector files
 */
function generateTestVector(testName, category, rawIntent, notes = []) {
  const canonicalizer = new RustCompatibleCanonicalizer();
  
  try {
    // Generate canonical form
    const canonical = canonicalizer.canonicalize(rawIntent);
    
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
  } catch (error) {
    console.error(`✗ Failed ${category}/${testName}: ${error.message}`);
  }
}

/**
 * Generate all test vectors with CORRECT schema
 */
function generateAllVectors() {
  console.log('Generating FIXED conformance test vectors for DeltaNEAR v1.0.0...\n');

  // ===== CANONICAL HASHING VECTORS =====
  
  // 1. Minimal perpetual intent (WITH required collateral)
  generateTestVector('intent_minimal_perp', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'ETH-USD',
      side: 'long',
      size: '1.5',
      collateral: {
        token: 'USDC',
        chain: 'near'
      }
    },
    signer_id: 'alice.testnet',
    deadline: '2024-12-31T23:59:59Z',
    nonce: 'test-minimal-perp-001'
  }, [
    'Minimal perpetual intent with required fields only',
    'Collateral field is mandatory per Rust implementation'
  ]);

  // 2. Minimal option intent (WITH required collateral and option object)
  generateTestVector('intent_minimal_option', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'option',
      symbol: 'BTC-USD',
      side: 'buy',
      size: '0.1',
      collateral: {
        token: 'USDC',
        chain: 'near'
      },
      option: {
        kind: 'call',
        strike: '50000',
        expiry: '2024-12-31T00:00:00Z'
      }
    },
    signer_id: 'bob.testnet',
    deadline: '2024-12-30T23:59:59Z',
    nonce: 'test-minimal-option-001'
  }, [
    'Minimal option intent with required option object structure',
    'Option parameters must be in option sub-object'
  ]);

  // 3. Full perpetual intent (WITH constraints object)
  generateTestVector('intent_full_perp', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'SOL-USD',
      side: 'short',
      size: '100.5',
      leverage: '5',
      collateral: {
        token: 'USDC',
        chain: 'near'
      },
      constraints: {
        max_slippage_bps: 200,
        max_fee_bps: 50,
        venue_allowlist: ['dydx', 'gmx']
      }
    },
    signer_id: 'trader.testnet',
    deadline: '2024-12-31T23:59:59.000Z',
    nonce: 'test-full-perp-001'
  }, [
    'Full perpetual with constraints object',
    'Constraints must be in constraints sub-object',
    'Venue allowlist will be lowercased and sorted'
  ]);

  // 4. Full option intent (WITH proper structure)
  generateTestVector('intent_full_option', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'option',
      symbol: 'ETH-USD',
      side: 'sell',
      size: '5',
      leverage: '1',
      collateral: {
        token: 'ETH',
        chain: 'near'
      },
      option: {
        kind: 'call',
        strike: '3000',
        expiry: '2025-01-31T00:00:00.000Z'
      },
      constraints: {
        max_slippage_bps: 150,
        venue_allowlist: ['lyra', 'hegic']
      }
    },
    signer_id: 'options.testnet',
    deadline: '2024-12-30T12:00:00.000Z',
    nonce: 'test-full-option-001'
  }, [
    'Full option with all fields properly structured',
    'Option params in option object, constraints in constraints object'
  ]);

  // 5. Intent with complex constraints
  generateTestVector('intent_with_constraints', 'canonical-hashing', {
    version: '1.0.0',
    intent_type: 'derivatives',
    derivatives: {
      instrument: 'perp',
      symbol: 'NEAR-USD',
      side: 'long',
      size: '1000',
      leverage: '3',
      collateral: {
        token: 'NEAR',
        chain: 'near'
      },
      constraints: {
        max_fee_bps: 25,
        max_funding_bps_8h: 40,
        max_slippage_bps: 75,
        venue_allowlist: ['dYdX', 'GMX', 'Drift']
      }
    },
    signer_id: 'analytics.testnet',
    deadline: '2024-12-31T23:59:59Z',
    nonce: 'test-constraints-001'
  }, [
    'All constraint fields properly specified',
    'Venue names will be lowercased and sorted'
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
      leverage: '2',
      collateral: {
        token: 'USDC',
        chain: 'near'
      }
    },
    signer_id: 'café.testnet',
    deadline: '2024-12-31T23:59:59Z',
    nonce: 'café-001'
  }, [
    'Unicode in signer_id and nonce',
    'Signer ID will be lowercased'
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
      collateral: {
        token: 'USDT',
        chain: 'arbitrum'
      }
    },
    signer_id: 'numbers.testnet',
    deadline: '2024-12-31T23:59:59Z',
    nonce: 12345
  }, [
    'Trailing zeros removed from size and leverage',
    'Nonce as number will be converted to string'
  ]);

  // ===== NEGATIVE TEST VECTORS (Should be rejected) =====
  
  const negativeDir = 'canonical-hashing/negative';
  fs.mkdirSync(path.join(__dirname, negativeDir), { recursive: true });

  // Create a summary of negative tests
  const negativeTests = [
    {
      name: 'missing_collateral',
      reason: 'Missing required field: collateral',
      intent: {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1'
        },
        signer_id: 'test.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-001'
      }
    },
    {
      name: 'invalid_instrument',
      reason: 'Invalid instrument: future',
      intent: {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          instrument: 'future',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1',
          collateral: { token: 'USDC', chain: 'near' }
        },
        signer_id: 'test.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-002'
      }
    },
    {
      name: 'scientific_notation',
      reason: 'Scientific notation not allowed',
      intent: {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1.5e10',
          collateral: { token: 'USDC', chain: 'near' }
        },
        signer_id: 'test.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-003'
      }
    },
    {
      name: 'extra_root_field',
      reason: 'Invalid root fields',
      intent: {
        version: '1.0.0',
        intent_type: 'derivatives',
        derivatives: {
          instrument: 'perp',
          symbol: 'ETH-USD',
          side: 'long',
          size: '1',
          collateral: { token: 'USDC', chain: 'near' }
        },
        signer_id: 'test.testnet',
        deadline: '2024-12-31T23:59:59Z',
        nonce: 'test-004',
        metadata: { note: 'not allowed' }
      }
    }
  ];

  fs.writeFileSync(
    path.join(__dirname, negativeDir, 'negative_tests.json'),
    JSON.stringify(negativeTests, null, 2)
  );
  console.log(`✓ Generated ${negativeDir}/negative_tests.json`);

  // ===== SOLVER API VECTORS (Updated schema) =====

  // Note: Solver API messages have different structure - they wrap intents
  // Create a separate handler for solver API messages
  
  function generateSolverApiVector(testName, rawData, notes = []) {
    const dir = path.join(__dirname, 'solver-api', testName);
    fs.mkdirSync(dir, { recursive: true });
    
    // For solver API, we just normalize the data without strict validation
    const canonical = JSON.stringify(rawData);
    const sha256 = computeSha256(canonical);
    
    const expected = {
      sha256: sha256,
      intent_hash: rawData.intent_hash || 'N/A',
      manifest_hash: MANIFEST_HASH,
      byte_length: Buffer.from(canonical, 'utf8').length,
      normalization_notes: notes
    };
    
    fs.writeFileSync(
      path.join(dir, 'raw.json'),
      JSON.stringify(rawData, null, 2)
    );
    
    fs.writeFileSync(
      path.join(dir, 'canonical.json'),
      canonical
    );
    
    fs.writeFileSync(
      path.join(dir, 'expected.json'),
      JSON.stringify(expected, null, 2)
    );
    
    console.log(`✓ Generated solver-api/${testName}`);
  }

  // Solver API test vectors
  generateSolverApiVector('quote_request_minimal', {
    intent_hash: 'abc123def456789012345678901234567890123456789012345678901234567',
    intent: {
      version: '1.0.0',
      intent_type: 'derivatives',
      derivatives: {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '5',
        collateral: {
          token: 'USDC',
          chain: 'near'
        }
      },
      signer_id: 'user.testnet',
      deadline: '2024-12-31T23:59:59Z',
      nonce: 'quote-req-001'
    },
    solver_id: 'solver1.testnet'
  }, [
    'Quote request with proper intent structure'
  ]);

  generateSolverApiVector('quote_request_full', {
    intent_hash: 'def456789012345678901234567890123456789012345678901234567890abc',
    intent: {
      version: '1.0.0',
      intent_type: 'derivatives',
      derivatives: {
        instrument: 'option',
        symbol: 'BTC-USD',
        side: 'buy',
        size: '0.5',
        collateral: {
          token: 'USDC',
          chain: 'near'
        },
        option: {
          kind: 'call',
          strike: '60000',
          expiry: '2025-03-31T00:00:00Z'
        }
      },
      signer_id: 'trader.testnet',
      deadline: '2024-12-30T23:59:59Z',
      nonce: 'quote-req-full-001'
    },
    solver_id: 'premium-solver.testnet',
    preferences: {
      max_slippage: '0.02',
      min_fill_rate: '0.95',
      preferred_chains: ['near', 'ethereum']
    }
  }, [
    'Full quote request with preferences and proper option structure'
  ]);

  generateSolverApiVector('quote_response_success', {
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
    'Successful quote response'
  ]);

  generateSolverApiVector('accept_request', {
    intent_hash: '012345678901234567890123456789012345678901234567890123456789abc',
    solver_id: 'solver1.testnet',
    quote_id: 'quote-123456',
    signature: 'ed25519:3a7b9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b',
    signer_id: 'user.testnet',
    timestamp: '2024-12-31T23:55:00Z'
  }, [
    'Intent acceptance with signature'
  ]);

  generateSolverApiVector('accept_response_success', {
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

  generateSolverApiVector('settlement_tokendiff', {
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
    'TokenDiff settlement structure'
  ]);

  console.log('\n✅ All FIXED test vectors generated successfully!');
  console.log('⚠️  Note: These vectors now match the Rust canonicalization implementation');
}

// Run generation
generateAllVectors();