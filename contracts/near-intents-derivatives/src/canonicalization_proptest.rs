#[cfg(test)]
mod property_tests {
    use crate::canonicalization::Canonicalizer;
    use serde_json::{json, Value};
    use proptest::prelude::*;

    // Property 1: Canonicalization is deterministic
    // Same input always produces same output
    proptest! {
        #[test]
        fn canonicalization_is_deterministic(
            size in r"[0-9]+(\.[0-9]{1,8})?",
            leverage in 1u32..=100u32,
            max_slippage in 0u32..=1000u32,
            nonce in "[a-zA-Z0-9]{1,32}"
        ) {
            let intent = json!({
                "version": "1.0.0",
                "intent_type": "derivatives",
                "derivatives": {
                    "instrument": "perp",
                    "symbol": "ETH-USD",
                    "side": "long",
                    "size": size,
                    "leverage": leverage.to_string(),
                    "constraints": {
                        "max_slippage_bps": max_slippage
                    },
                    "collateral": {
                        "token": "usdc.near",
                        "chain": "near"
                    }
                },
                "signer_id": "alice.near",
                "deadline": "2024-12-31T23:59:59Z",
                "nonce": nonce
            });

            if let Ok(size_float) = size.parse::<f64>() {
                if size_float >= 0.00000001 && size_float <= 1000000.0 {
                    let result1 = Canonicalizer::canonicalize_intent(&intent);
                    let result2 = Canonicalizer::canonicalize_intent(&intent);
                    
                    if let (Ok(canonical1), Ok(canonical2)) = (result1, result2) {
                        // Same input should always produce same output
                        prop_assert_eq!(canonical1, canonical2);
                        
                        // Hash should also be identical
                        let json1 = serde_json::to_string(&canonical1).unwrap();
                        let json2 = serde_json::to_string(&canonical2).unwrap();
                        let hash1 = Canonicalizer::compute_hash(&json1);
                        let hash2 = Canonicalizer::compute_hash(&json2);
                        prop_assert_eq!(hash1, hash2);
                    }
                }
            }
        }
    }

    // Property 2: Field order independence
    // Different field orders produce same canonical form
    proptest! {
        #[test]
        fn field_order_independence(
            instrument in prop::sample::select(vec!["perp", "option"]),
            side in prop::sample::select(vec!["long", "short", "buy", "sell"]),
            size in 0.00000001f64..1000000.0f64
        ) {
            let size_str = if size == size.floor() {
                format!("{:.0}", size)
            } else {
                let s = format!("{:.8}", size);
                s.trim_end_matches('0').trim_end_matches('.').to_string()
            };

            // Create intent with fields in different orders
            let intent1 = json!({
                "version": "1.0.0",
                "intent_type": "derivatives",
                "signer_id": "alice.near",
                "deadline": "2024-12-31T23:59:59Z",
                "nonce": "test-nonce",
                "derivatives": {
                    "instrument": instrument,
                    "symbol": "ETH-USD",
                    "side": side,
                    "size": size_str,
                    "collateral": {
                        "token": "usdc.near",
                        "chain": "near"
                    }
                }
            });

            let intent2 = json!({
                "deadline": "2024-12-31T23:59:59Z",
                "derivatives": {
                    "collateral": {
                        "chain": "near",
                        "token": "usdc.near"
                    },
                    "size": size_str,
                    "side": side,
                    "symbol": "ETH-USD",
                    "instrument": instrument
                },
                "nonce": "test-nonce",
                "signer_id": "alice.near",
                "intent_type": "derivatives",
                "version": "1.0.0"
            });

            let result1 = Canonicalizer::canonicalize_intent(&intent1);
            let result2 = Canonicalizer::canonicalize_intent(&intent2);

            if let (Ok(canonical1), Ok(canonical2)) = (result1, result2) {
                prop_assert_eq!(canonical1, canonical2);
            }
        }
    }

    // Property 3: Decimal normalization preserves value
    proptest! {
        #[test]
        fn decimal_normalization_preserves_value(
            value in 0.00000001f64..1000000.0f64
        ) {
            let str_value = format!("{}", value);
            let json_value = json!(str_value);
            
            let result = Canonicalizer::canonicalize_decimal(
                &json_value,
                "0.00000001",
                "1000000",
                8
            );

            if let Ok(canonical) = result {
                if let Some(canonical_str) = canonical.as_str() {
                    let parsed: f64 = canonical_str.parse().unwrap();
                    // Value should be preserved (within floating point precision)
                    let epsilon = value * 1e-10;
                    prop_assert!((parsed - value).abs() <= epsilon);
                }
            }
        }
    }

    // Property 4: Venue list always sorted and deduplicated
    proptest! {
        #[test]
        fn venue_list_always_sorted(
            venues in prop::collection::vec("[a-z0-9\\-]{1,20}", 0..10)
        ) {
            let constraints = json!({
                "venue_allowlist": venues.clone()
            });

            let result = Canonicalizer::canonicalize_constraints(
                Some(constraints.as_object().unwrap())
            );

            if let Ok(canonical) = result {
                if let Some(venue_list) = canonical["venue_allowlist"].as_array() {
                    let venues_str: Vec<String> = venue_list
                        .iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect();
                    
                    // Check sorted
                    for i in 1..venues_str.len() {
                        prop_assert!(venues_str[i-1] <= venues_str[i]);
                    }
                    
                    // Check no duplicates
                    for i in 1..venues_str.len() {
                        prop_assert_ne!(venues_str[i-1], venues_str[i]);
                    }
                }
            }
        }
    }

    // Property 5: Timestamp normalization is idempotent
    proptest! {
        #[test]
        fn timestamp_normalization_idempotent(
            year in 1970u32..=2100u32,
            month in 1u32..=12u32,
            day in 1u32..=28u32,  // Safe for all months
            hour in 0u32..=23u32,
            minute in 0u32..=59u32,
            second in 0u32..=59u32
        ) {
            let timestamp = format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
                year, month, day, hour, minute, second
            );

            let result1 = Canonicalizer::normalize_timestamp(&timestamp);
            if let Ok(normalized1) = result1 {
                // Normalizing again should give same result
                let result2 = Canonicalizer::normalize_timestamp(&normalized1);
                prop_assert_eq!(Ok(normalized1.clone()), result2);
            }
        }
    }

    // Property 6: Case normalization is consistent
    proptest! {
        #[test]
        fn case_normalization_consistency(
            base in "[A-Z]{2,4}",
            quote in "[A-Z]{3,4}",
            side_upper in prop::sample::select(vec!["LONG", "SHORT", "BUY", "SELL"]),
            instrument_upper in prop::sample::select(vec!["PERP", "OPTION"]),
            chain_upper in prop::sample::select(vec!["NEAR", "ETHEREUM", "ARBITRUM"])
        ) {
            let symbol = format!("{}-{}", base, quote);
            
            let intent = json!({
                "version": "1.0.0",
                "intent_type": "derivatives",
                "derivatives": {
                    "instrument": instrument_upper,
                    "symbol": symbol.to_lowercase(),  // Test mixed case
                    "side": side_upper,
                    "size": "1",
                    "collateral": {
                        "token": "usdc.near",
                        "chain": chain_upper
                    }
                },
                "signer_id": "ALICE.NEAR",  // Test uppercase account
                "deadline": "2024-12-31T23:59:59Z",
                "nonce": "test"
            });

            let result = Canonicalizer::canonicalize_intent(&intent);
            
            if let Ok(canonical) = result {
                let deriv = &canonical["derivatives"];
                
                // Check normalizations
                prop_assert_eq!(
                    deriv["instrument"].as_str().unwrap(),
                    instrument_upper.to_lowercase()
                );
                prop_assert_eq!(
                    deriv["symbol"].as_str().unwrap(),
                    symbol.to_uppercase()
                );
                prop_assert_eq!(
                    deriv["side"].as_str().unwrap(),
                    side_upper.to_lowercase()
                );
                prop_assert_eq!(
                    deriv["collateral"]["chain"].as_str().unwrap(),
                    chain_upper.to_lowercase()
                );
                prop_assert_eq!(
                    canonical["signer_id"].as_str().unwrap(),
                    "alice.near"
                );
            }
        }
    }

    // Property 7: Invalid inputs are consistently rejected
    proptest! {
        #[test]
        fn invalid_inputs_rejected(
            extra_field in "[a-z]{5,15}",
            extra_value in "[a-z0-9]{1,20}"
        ) {
            let mut intent = json!({
                "version": "1.0.0",
                "intent_type": "derivatives",
                "derivatives": {
                    "instrument": "perp",
                    "symbol": "ETH-USD",
                    "side": "long",
                    "size": "1",
                    "collateral": {
                        "token": "usdc.near",
                        "chain": "near"
                    }
                },
                "signer_id": "alice.near",
                "deadline": "2024-12-31T23:59:59Z",
                "nonce": "test"
            });

            // Add extra field
            intent[extra_field] = json!(extra_value);

            let result = Canonicalizer::canonicalize_intent(&intent);
            prop_assert!(result.is_err());
            if let Err(msg) = result {
                prop_assert!(msg.contains("Invalid root fields"));
            }
        }
    }

    // Property 8: Canonicalization never increases data size significantly
    proptest! {
        #[test]
        fn canonicalization_size_bounded(
            size in 0.00000001f64..1000000.0f64,
            leverage in 1u32..=100u32,
            venues in prop::collection::vec("[a-z0-9\\-]{1,20}", 0..10)
        ) {
            let intent = json!({
                "version": "1.0.0",
                "intent_type": "derivatives",
                "derivatives": {
                    "instrument": "perp",
                    "symbol": "ETH-USD",
                    "side": "long",
                    "size": format!("{}", size),
                    "leverage": leverage.to_string(),
                    "constraints": {
                        "venue_allowlist": venues
                    },
                    "collateral": {
                        "token": "usdc.near",
                        "chain": "near"
                    }
                },
                "signer_id": "alice.near",
                "deadline": "2024-12-31T23:59:59Z",
                "nonce": "test"
            });

            let original_size = serde_json::to_string(&intent).unwrap().len();
            
            if let Ok(canonical) = Canonicalizer::canonicalize_intent(&intent) {
                let canonical_size = serde_json::to_string(&canonical).unwrap().len();
                
                // Canonical form shouldn't be more than 2x original
                // (accounting for added defaults)
                prop_assert!(canonical_size < original_size * 2);
            }
        }
    }

    // Property 9: Hash output is always 64 hex characters
    proptest! {
        #[test]
        fn hash_always_64_chars(
            input in prop::string::string_regex("[a-zA-Z0-9 ]{1,1000}").unwrap()
        ) {
            let hash = Canonicalizer::compute_hash(&input);
            prop_assert_eq!(hash.len(), 64);
            prop_assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }

    // Property 10: Defaults are applied consistently
    proptest! {
        #[test]
        fn defaults_applied_consistently(
            include_leverage in prop::bool::ANY,
            include_constraints in prop::bool::ANY
        ) {
            let mut derivatives = json!({
                "instrument": "perp",
                "symbol": "ETH-USD",
                "side": "long",
                "size": "1",
                "collateral": {
                    "token": "usdc.near",
                    "chain": "near"
                }
            });

            if include_leverage {
                derivatives["leverage"] = json!("5");
            }
            
            if include_constraints {
                derivatives["constraints"] = json!({
                    "max_slippage_bps": 50
                });
            }

            let intent = json!({
                "version": "1.0.0",
                "intent_type": "derivatives",
                "derivatives": derivatives,
                "signer_id": "alice.near",
                "deadline": "2024-12-31T23:59:59Z",
                "nonce": "test"
            });

            if let Ok(canonical) = Canonicalizer::canonicalize_intent(&intent) {
                let deriv = &canonical["derivatives"];
                
                // Check defaults are applied
                prop_assert!(deriv["leverage"].as_str().is_some());
                prop_assert!(deriv["constraints"].as_object().is_some());
                
                let constraints = deriv["constraints"].as_object().unwrap();
                prop_assert!(constraints.contains_key("max_slippage_bps"));
                prop_assert!(constraints.contains_key("max_funding_bps_8h"));
                prop_assert!(constraints.contains_key("max_fee_bps"));
                prop_assert!(constraints.contains_key("venue_allowlist"));
                
                // Check default values
                if !include_leverage {
                    prop_assert_eq!(deriv["leverage"].as_str().unwrap(), "1");
                }
                
                if !include_constraints {
                    prop_assert_eq!(constraints["max_slippage_bps"].as_u64().unwrap(), 100);
                    prop_assert_eq!(constraints["max_funding_bps_8h"].as_u64().unwrap(), 50);
                    prop_assert_eq!(constraints["max_fee_bps"].as_u64().unwrap(), 30);
                }
            }
        }
    }
}