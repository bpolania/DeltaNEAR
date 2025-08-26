use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

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

/// Helper to create a valid V2 derivatives intent
fn create_test_intent_v2() -> DerivativesIntentV2 {
    DerivativesIntentV2 {
        version: "1.0.0".to_string(),
        intent_type: "derivatives".to_string(),
        derivatives: DerivativesData {
            collateral: Collateral {
                token: "USDC".to_string(),
                chain: "near".to_string(),
            },
            constraints: Constraints {
                max_fee_bps: 30,
                max_funding_bps_8h: 50,
                max_slippage_bps: 100,
                venue_allowlist: vec!["binance".to_string(), "okx".to_string()],
            },
            instrument: "perp".to_string(),
            side: "long".to_string(),
            size: "1000.0".to_string(),
            symbol: "BTC-USD".to_string(),
            leverage: "10.0".to_string(),
        },
        signer_id: accounts(1).to_string(),
        deadline: "2025-12-31T23:59:59Z".to_string(),
        nonce: "12345".to_string(),
    }
}

/// Helper to create an option intent
fn create_option_intent_v2() -> DerivativesIntentV2 {
    DerivativesIntentV2 {
        version: "1.0.0".to_string(),
        intent_type: "derivatives".to_string(),
        derivatives: DerivativesData {
            collateral: Collateral {
                token: "USDT".to_string(),
                chain: "ethereum".to_string(),
            },
            constraints: Constraints {
                max_fee_bps: 25,
                max_funding_bps_8h: 40,
                max_slippage_bps: 75,
                venue_allowlist: vec!["deribit".to_string()],
            },
            instrument: "option".to_string(),
            side: "buy".to_string(),
            size: "10.0".to_string(),
            symbol: "ETH-USD".to_string(),
            leverage: "1.0".to_string(), // Options don't use leverage
        },
        signer_id: accounts(1).to_string(),
        deadline: "2025-12-30T23:59:59Z".to_string(),
        nonce: "54321".to_string(),
    }
}

#[test]
fn test_schema_version_v2() {
    setup_test_context();
    let contract = Contract::new(accounts(1));
    
    // Schema version MUST return 2.0.0 for V2
    assert_eq!(contract.get_schema_version(), "2.0.0");
}

#[test]
fn test_contract_initialization() {
    setup_test_context();
    let treasury = accounts(1);
    let contract = Contract::new(treasury.clone());
    
    assert_eq!(contract.version, "1.0.0"); // Contract version is 1.0.0
    assert_eq!(contract.authorized_solvers.len(), 1); // Treasury is added as solver
    assert_eq!(contract.authorized_solvers[0], treasury);
}

#[test]
fn test_validate_intent_v2_success() {
    setup_test_context();
    let contract = Contract::new(accounts(1));
    let intent = create_test_intent_v2();
    
    let result = contract.validate_v2_intent(intent);
    assert!(result.is_ok());
    
    let message = result.unwrap();
    assert!(message.contains("V2 Intent validated"));
    assert!(message.contains("BTC-USD"));
    assert!(message.contains("perp"));
    assert!(message.contains("long"));
    assert!(message.contains("near"));
}

#[test]
fn test_validate_intent_v2_option_success() {
    setup_test_context();
    let contract = Contract::new(accounts(1));
    let intent = create_option_intent_v2();
    
    let result = contract.validate_v2_intent(intent);
    assert!(result.is_ok());
    
    let message = result.unwrap();
    assert!(message.contains("V2 Intent validated"));
    assert!(message.contains("ETH-USD"));
    assert!(message.contains("option"));
    assert!(message.contains("buy"));
    assert!(message.contains("ethereum"));
}

#[test]
fn test_validate_intent_v2_invalid_version() {
    setup_test_context();
    let contract = Contract::new(accounts(1));
    let mut intent = create_test_intent_v2();
    intent.version = "2.0.0".to_string(); // Wrong version
    
    let result = contract.validate_v2_intent(intent);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid version"));
}

#[test]
fn test_validate_intent_v2_invalid_type() {
    setup_test_context();
    let contract = Contract::new(accounts(1));
    let mut intent = create_test_intent_v2();
    intent.intent_type = "spot".to_string(); // Wrong type
    
    let result = contract.validate_v2_intent(intent);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid intent_type"));
}

#[test]
fn test_validate_intent_v2_empty_collateral_token() {
    setup_test_context();
    let contract = Contract::new(accounts(1));
    let mut intent = create_test_intent_v2();
    intent.derivatives.collateral.token = "".to_string();
    
    let result = contract.validate_v2_intent(intent);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Collateral token cannot be empty"));
}

#[test]
fn test_validate_intent_v2_empty_collateral_chain() {
    setup_test_context();
    let contract = Contract::new(accounts(1));
    let mut intent = create_test_intent_v2();
    intent.derivatives.collateral.chain = "".to_string();
    
    let result = contract.validate_v2_intent(intent);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Collateral chain cannot be empty"));
}

#[test]
fn test_add_authorized_solver() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1));
    let solver = accounts(2);
    
    // Initially has treasury as authorized solver
    assert_eq!(contract.authorized_solvers.len(), 1);
    assert_eq!(contract.authorized_solvers[0], accounts(1));
    
    // Add another solver
    contract.add_authorized_solver(solver.clone());
    assert_eq!(contract.authorized_solvers.len(), 2);
    assert_eq!(contract.authorized_solvers[1], solver);
}

#[test]
fn test_get_authorized_solvers() {
    setup_test_context();
    let mut contract = Contract::new(accounts(1));
    let solver1 = accounts(2);
    let solver2 = accounts(3);
    
    // Initially has treasury as authorized solver
    let solvers = contract.get_authorized_solvers();
    assert_eq!(solvers.len(), 1);
    assert_eq!(solvers[0], accounts(1));
    
    // Add more solvers
    contract.add_authorized_solver(solver1.clone());
    contract.add_authorized_solver(solver2.clone());
    
    let solvers = contract.get_authorized_solvers();
    assert_eq!(solvers.len(), 3);
    assert!(solvers.contains(&accounts(1)));
    assert!(solvers.contains(&solver1));
    assert!(solvers.contains(&solver2));
}

#[test]
fn test_constraints_defaults() {
    let constraints = Constraints {
        max_fee_bps: 30,
        max_funding_bps_8h: 50,
        max_slippage_bps: 100,
        venue_allowlist: vec!["binance".to_string(), "okx".to_string()],
    };
    
    assert_eq!(constraints.max_fee_bps, 30);
    assert_eq!(constraints.max_funding_bps_8h, 50);
    assert_eq!(constraints.max_slippage_bps, 100);
    assert_eq!(constraints.venue_allowlist.len(), 2);
}

#[test]
fn test_constraints_max_values() {
    // Test that constraints respect maximum values in real usage
    let constraints = Constraints {
        max_fee_bps: 100, // Max allowed
        max_funding_bps_8h: 100, // Max allowed
        max_slippage_bps: 1000, // Max allowed
        venue_allowlist: vec![],
    };
    
    assert!(constraints.max_fee_bps <= 100);
    assert!(constraints.max_funding_bps_8h <= 100);
    assert!(constraints.max_slippage_bps <= 1000);
}

#[test]
fn test_collateral_chains() {
    // Test various valid chain names
    let chains = vec!["near", "ethereum", "arbitrum", "base", "solana"];
    
    for chain in chains {
        let collateral = Collateral {
            token: "USDC".to_string(),
            chain: chain.to_string(),
        };
        assert!(!collateral.chain.is_empty());
        assert!(!collateral.token.is_empty());
    }
}

#[test]
fn test_option_derivatives() {
    // Options are represented as derivatives with option-specific fields
    let derivatives = DerivativesData {
        collateral: Collateral {
            token: "USDC".to_string(),
            chain: "ethereum".to_string(),
        },
        constraints: Constraints {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: vec!["deribit".to_string()],
        },
        instrument: "option".to_string(),
        side: "buy".to_string(),
        size: "10.0".to_string(),
        symbol: "ETH-USD".to_string(),
        leverage: "1.0".to_string(), // Options don't use leverage
    };
    
    assert_eq!(derivatives.instrument, "option");
    assert_eq!(derivatives.side, "buy");
}

#[test]
fn test_derivatives_data_perp() {
    let derivatives = DerivativesData {
        collateral: Collateral {
            token: "USDC".to_string(),
            chain: "near".to_string(),
        },
        constraints: Constraints {
            max_fee_bps: 30,
            max_funding_bps_8h: 50,
            max_slippage_bps: 100,
            venue_allowlist: vec!["binance".to_string()],
        },
        instrument: "perp".to_string(),
        side: "long".to_string(),
        size: "1000.0".to_string(),
        symbol: "BTC-USD".to_string(),
        leverage: "10.0".to_string(),
    };
    
    assert_eq!(derivatives.instrument, "perp");
    assert_eq!(derivatives.leverage, "10.0");
}

#[test]
fn test_derivatives_data_option() {
    let derivatives = DerivativesData {
        collateral: Collateral {
            token: "USDT".to_string(),
            chain: "ethereum".to_string(),
        },
        constraints: Constraints {
            max_fee_bps: 25,
            max_funding_bps_8h: 40,
            max_slippage_bps: 75,
            venue_allowlist: vec!["deribit".to_string()],
        },
        instrument: "option".to_string(),
        side: "buy".to_string(),
        size: "10.0".to_string(),
        symbol: "ETH-USD".to_string(),
        leverage: "1.0".to_string(), // Options typically don't use leverage
    };
    
    assert_eq!(derivatives.instrument, "option");
    assert_eq!(derivatives.leverage, "1.0");
}

#[test]
fn test_intent_metadata() {
    let metadata = IntentMetadata {
        intent_hash: "abc123".to_string(),
        solver_id: accounts(1).to_string(),
        instrument: "perp".to_string(),
        symbol: "BTC-USD".to_string(),
        side: "long".to_string(),
        size: "1000.0".to_string(),
        timestamp: 1000000000,
    };
    
    assert_eq!(metadata.intent_hash, "abc123");
    assert_eq!(metadata.solver_id, accounts(1).to_string());
    assert_eq!(metadata.instrument, "perp");
    assert_eq!(metadata.symbol, "BTC-USD");
    assert_eq!(metadata.side, "long");
    assert_eq!(metadata.size, "1000.0");
    assert_eq!(metadata.timestamp, 1000000000);
}

#[test]
fn test_execution_log() {
    let log = ExecutionLog {
        intent_hash: "abc123".to_string(),
        solver_id: accounts(1).to_string(),
        venue: "binance".to_string(),
        fill_price: "50000.0".to_string(),
        notional: "50000.0".to_string(),
        fees_bps: 30,
        status: "completed".to_string(),
        timestamp: 1000000000,
    };
    
    assert_eq!(log.intent_hash, "abc123");
    assert_eq!(log.solver_id, accounts(1).to_string());
    assert_eq!(log.venue, "binance");
    assert_eq!(log.fill_price, "50000.0");
    assert_eq!(log.notional, "50000.0");
    assert_eq!(log.fees_bps, 30);
    assert_eq!(log.status, "completed");
    assert_eq!(log.timestamp, 1000000000);
}

#[test]
fn test_json_serialization() {
    let intent = create_test_intent_v2();
    
    // Test that the intent can be serialized to JSON
    let json = serde_json::to_value(&intent);
    assert!(json.is_ok());
    
    let json_value = json.unwrap();
    assert_eq!(json_value["version"], "1.0.0");
    assert_eq!(json_value["intent_type"], "derivatives");
    assert_eq!(json_value["derivatives"]["symbol"], "BTC-USD");
    assert_eq!(json_value["derivatives"]["collateral"]["chain"], "near");
    assert_eq!(json_value["derivatives"]["constraints"]["max_fee_bps"], 30);
}

#[test]
fn test_venue_allowlist() {
    let intent = create_test_intent_v2();
    let venues = &intent.derivatives.constraints.venue_allowlist;
    
    assert_eq!(venues.len(), 2);
    assert!(venues.contains(&"binance".to_string()));
    assert!(venues.contains(&"okx".to_string()));
    
    // Venues should be lowercase
    for venue in venues {
        assert_eq!(venue.to_lowercase(), *venue);
    }
}