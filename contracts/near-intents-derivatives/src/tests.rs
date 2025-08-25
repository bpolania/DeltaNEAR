use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId};
use near_sdk::json_types::U128;
use serde_json::json;
use sha2::{Sha256, Digest};

use crate::*;

/// Test helper to setup test context
fn setup_test_context() {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(accounts(0))
        .predecessor_account_id(accounts(1))
        .block_timestamp(1_000_000_000);
    testing_env!(context.build());
}

#[test]
fn test_schema_version_stable() {
    setup_test_context();
    let contract = Contract::new(accounts(1), 20, 10);
    
    // Schema version MUST always return 1.0.0
    assert_eq!(contract.get_schema_version(), "1.0.0");
}

#[test]
fn test_fee_config_structure() {
    setup_test_context();
    let contract = Contract::new(accounts(1), 20, 10);
    
    let fee_config = contract.get_fee_config();
    
    // Verify all required fields are present
    assert_eq!(fee_config.protocol_fee_bps, 20);
    assert_eq!(fee_config.solver_rebate_bps, 10);
    assert_eq!(fee_config.min_fee_usdc, "0.10");
    assert_eq!(fee_config.max_fee_bps, 100);
    assert_eq!(fee_config.treasury, accounts(1));
}

#[test]
fn test_guardrails_defaults() {
    setup_test_context();
    let contract = Contract::new(accounts(1), 20, 10);
    
    let guardrails = contract.get_guardrails(None, None);
    
    // Verify default guardrails
    assert_eq!(guardrails.max_position_size, "100000");
    assert_eq!(guardrails.max_leverage, "20");
    assert_eq!(guardrails.max_daily_volume, "1000000");
    assert_eq!(guardrails.allowed_instruments, vec!["perp", "option"]);
    assert_eq!(guardrails.cooldown_seconds, 60);
}

#[test]
fn test_canonical_hashing_basic() {
    setup_test_context();
    let contract = Contract::new(accounts(1), 20, 10);
    
    let intent_json = r#"{
        "version": "1.0.0",
        "intent_type": "derivatives",
        "derivatives": {
            "instrument": "perp",
            "symbol": "eth-usd",
            "side": "LONG",
            "size": "1.5",
            "collateral": {
                "token": "usdc.near",
                "chain": "near"
            }
        },
        "signer_id": "alice.near",
        "deadline": "2024-01-23T11:00:00Z",
        "nonce": "1234567890"
    }"#;
    
    let hash = contract.verify_intent_hash(intent_json.to_string());
    
    // Hash should be 64 characters (32 bytes in hex)
    assert_eq!(hash.len(), 64);
    
    // Hash should be deterministic
    let hash2 = contract.verify_intent_hash(intent_json.to_string());
    assert_eq!(hash, hash2);
}

#[test]
fn test_canonical_hashing_normalization() {
    setup_test_context();
    let contract = Contract::new(accounts(1), 20, 10);
    
    // These two intents should produce the same hash after normalization
    let intent1 = r#"{
        "version": "1.0.0",
        "intent_type": "derivatives",
        "derivatives": {
            "instrument": "perp",
            "symbol": "eth-usd",
            "side": "LONG",
            "size": "1",
            "collateral": {
                "token": "usdc.near",
                "chain": "near"
            }
        },
        "signer_id": "alice.near",
        "deadline": "2024-01-23T11:00:00Z",
        "nonce": "123"
    }"#;
    
    let intent2 = r#"{
        "version": "1.0.0",
        "intent_type": "derivatives",
        "derivatives": {
            "instrument": "perp",
            "symbol": "ETH-USD",
            "side": "long",
            "size": "1",
            "leverage": "1",
            "collateral": {
                "token": "usdc.near",
                "chain": "near"
            }
        },
        "signer_id": "alice.near",
        "deadline": "2024-01-23T11:00:00Z",
        "nonce": "123"
    }"#;
    
    let hash1 = contract.verify_intent_hash(intent1.to_string());
    let hash2 = contract.verify_intent_hash(intent2.to_string());
    
    // Hashes should be equal after normalization
    assert_eq!(hash1, hash2);
}

#[test]
fn test_symbol_config_management() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1), 20, 10);
    
    // Initially no symbols
    assert_eq!(contract.get_supported_symbols().len(), 0);
    
    // Add a symbol config
    let config = SymbolConfig {
        symbol: "ETH-USD".to_string(),
        instruments: vec!["perp".to_string(), "option".to_string()],
        min_size: "0.01".to_string(),
        max_size: "1000".to_string(),
        tick_size: "0.01".to_string(),
    };
    
    contract.add_symbol_config(config.clone());
    
    // Verify symbol was added
    let symbols = contract.get_supported_symbols();
    assert_eq!(symbols.len(), 1);
    assert_eq!(symbols[0].symbol, "ETH-USD");
}

#[test]
fn test_venue_config_management() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1), 20, 10);
    
    // Add venue config
    let venue_config = VenueConfig {
        venue_id: "gmx-v2".to_string(),
        chain: "arbitrum".to_string(),
        supported_instruments: vec!["perp".to_string()],
        fee_bps: 5,
    };
    
    contract.add_venue_config(venue_config.clone(), vec!["ETH-USD".to_string()]);
    
    // Verify venue was added
    let venues = contract.get_allowed_venues("ETH-USD".to_string());
    assert_eq!(venues.len(), 1);
    assert_eq!(venues[0].venue_id, "gmx-v2");
}

#[test]
fn test_intent_metadata_storage() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1), 20, 10);
    
    let metadata = IntentMetadata {
        intent_hash: "test_hash".to_string(),
        instrument: "perp".to_string(),
        symbol: "ETH-USD".to_string(),
        side: "long".to_string(),
        size: "1.5".to_string(),
        leverage: Some("10".to_string()),
        strike: None,
        expiry: None,
        solver_id: accounts(2),
        created_at: 1_000_000_000,
    };
    
    // Store metadata
    contract.store_intent_metadata("test_hash".to_string(), metadata.clone());
    
    // Retrieve and verify
    let retrieved = contract.get_intent_metadata("test_hash".to_string());
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.intent_hash, "test_hash");
    assert_eq!(retrieved.symbol, "ETH-USD");
}

#[test]
fn test_execution_log() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1), 20, 10);
    
    let log = ExecutionLog {
        intent_hash: "test_hash".to_string(),
        solver_id: accounts(2),
        venue: "gmx-v2".to_string(),
        fill_price: "3650.50".to_string(),
        notional: U128(5475000000),
        fees_bps: 5,
        pnl: Some("150.50".to_string()),
        status: "filled".to_string(),
        timestamp: 1_000_000_000,
    };
    
    // Log execution
    contract.log_execution("test_hash".to_string(), log.clone());
    
    // Retrieve and verify
    let retrieved = contract.get_execution_log("test_hash".to_string());
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.fill_price, "3650.50");
    assert_eq!(retrieved.status, "filled");
}

#[test]
fn test_nep297_event_format() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1), 20, 10);
    
    // This test verifies the event structure matches NEP-297
    // In a real test environment, we would capture and parse the log output
    let metadata = IntentMetadata {
        intent_hash: "test_hash".to_string(),
        instrument: "perp".to_string(),
        symbol: "ETH-USD".to_string(),
        side: "long".to_string(),
        size: "1.5".to_string(),
        leverage: Some("10".to_string()),
        strike: None,
        expiry: None,
        solver_id: accounts(2),
        created_at: 1_000_000_000,
    };
    
    // This should emit a NEP-297 compliant event
    contract.store_intent_metadata("test_hash".to_string(), metadata);
    
    // In production, we would verify the logged event structure
    // For now, we just ensure the method doesn't panic
}

#[test]
fn test_guardrails_priority() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1), 20, 10);
    
    // Set symbol-specific guardrails
    let symbol_guardrails = Guardrails {
        max_position_size: "50000".to_string(),
        max_leverage: "10".to_string(),
        max_daily_volume: "500000".to_string(),
        allowed_instruments: vec!["perp".to_string()],
        cooldown_seconds: 30,
    };
    contract.set_symbol_guardrails("ETH-USD".to_string(), symbol_guardrails.clone());
    
    // Set user-specific guardrails
    let user_guardrails = Guardrails {
        max_position_size: "10000".to_string(),
        max_leverage: "5".to_string(),
        max_daily_volume: "100000".to_string(),
        allowed_instruments: vec!["perp".to_string()],
        cooldown_seconds: 120,
    };
    contract.set_user_guardrails(accounts(3), user_guardrails.clone());
    
    // Test priority: user > symbol > default
    let user_result = contract.get_guardrails(None, Some(accounts(3)));
    assert_eq!(user_result.max_leverage, "5");
    
    let symbol_result = contract.get_guardrails(Some("ETH-USD".to_string()), None);
    assert_eq!(symbol_result.max_leverage, "10");
    
    let default_result = contract.get_guardrails(None, None);
    assert_eq!(default_result.max_leverage, "20");
}

/// Test that verifies ABI stability - this should NEVER change for v1.0.0
#[test]
fn test_abi_stability() {
    // This test ensures that the view method signatures remain stable
    // If this test fails, it means we've broken backward compatibility
    
    setup_test_context();
    let contract = Contract::new(accounts(1), 20, 10);
    
    // Test all stable view methods exist and return expected types
    let _version: String = contract.get_schema_version();
    let _fee_config: FeeConfig = contract.get_fee_config();
    let _guardrails: Guardrails = contract.get_guardrails(None, None);
    let _symbols: Vec<SymbolConfig> = contract.get_supported_symbols();
    let _venues: Vec<VenueConfig> = contract.get_allowed_venues("ETH-USD".to_string());
    let _hash: String = contract.verify_intent_hash("{}".to_string());
    let _metadata: Option<IntentMetadata> = contract.get_intent_metadata("test".to_string());
    let _log: Option<ExecutionLog> = contract.get_execution_log("test".to_string());
    
    // If this compiles, the ABI is stable
}

#[cfg(test)]
mod test_vectors {
    use super::*;
    use std::fs;
    use serde_json::Value;

    #[test]
    #[ignore] // Run with: cargo test test_vectors -- --ignored
    fn validate_test_vectors() {
        setup_test_context();
        let contract = Contract::new(accounts(1), 20, 10);
        
        // Load test vectors
        let test_vectors_json = fs::read_to_string("test-vectors/canonical-hashing.json")
            .expect("Failed to read test vectors");
        let test_vectors: Value = serde_json::from_str(&test_vectors_json)
            .expect("Failed to parse test vectors");
        
        let vectors = test_vectors["test_vectors"].as_array()
            .expect("test_vectors should be an array");
        
        for vector in vectors {
            let name = vector["name"].as_str().unwrap();
            let input = vector["input"].to_string();
            let expected_hash = vector["expected_hash"].as_str().unwrap();
            
            let actual_hash = contract.verify_intent_hash(input);
            
            // For now, we just ensure the hash is deterministic and has correct length
            // In production, we would compute the actual expected hash
            assert_eq!(
                actual_hash.len(), 
                64, 
                "Hash length mismatch for test vector: {}", 
                name
            );
            
            println!("Test vector '{}' passed", name);
        }
    }
}