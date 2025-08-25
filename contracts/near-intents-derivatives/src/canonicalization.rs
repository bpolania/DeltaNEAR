use serde_json::{Value, Map, Number};
use sha2::{Sha256, Digest};
use std::collections::BTreeMap;

/// Deep canonicalization rules for DeltaNEAR Derivatives v1.0.0
/// 
/// IMMUTABLE SPECIFICATION - ANY CHANGE BREAKS COMPATIBILITY
/// Follows RFC 8785 with additional domain-specific rules
pub struct Canonicalizer;

impl Canonicalizer {
    /// Validate and canonicalize a derivatives intent
    pub fn canonicalize_intent(intent: &Value) -> Result<Value, String> {
        let obj = intent.as_object()
            .ok_or("Intent must be an object")?;

        // STRICT: Check for exactly the required fields
        let mut keys: Vec<_> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort();
        let expected = vec!["deadline", "derivatives", "intent_type", "nonce", "signer_id", "version"];
        if keys != expected {
            return Err(format!("Invalid root fields. Expected {:?}, got {:?}", expected, keys));
        }

        // Validate version
        let version = obj.get("version")
            .and_then(|v| v.as_str())
            .ok_or("Missing or invalid version")?;
        
        if version != "1.0.0" {
            return Err(format!("Invalid version: {}. Must be 1.0.0", version));
        }

        // Validate intent_type
        let intent_type = obj.get("intent_type")
            .and_then(|v| v.as_str())
            .ok_or("Missing or invalid intent_type")?;
        
        if intent_type != "derivatives" {
            return Err(format!("Invalid intent_type: {}. Must be 'derivatives'", intent_type));
        }

        // Parse and validate derivatives
        let derivatives = obj.get("derivatives")
            .and_then(|v| v.as_object())
            .ok_or("Missing or invalid derivatives")?;

        // Build canonical form with ALL fields in deterministic order
        let mut canonical = BTreeMap::new();
        
        canonical.insert("deadline".to_string(), 
            Value::String(Self::normalize_timestamp(
                obj.get("deadline")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing deadline")?
            )?));
        
        canonical.insert("derivatives".to_string(), 
            Self::canonicalize_derivatives(derivatives)?);
        
        canonical.insert("intent_type".to_string(), 
            Value::String("derivatives".to_string()));
        
        canonical.insert("nonce".to_string(), 
            Value::String(Self::normalize_nonce(
                obj.get("nonce")
                    .ok_or("Missing nonce")?
            )?));
        
        canonical.insert("signer_id".to_string(), 
            Value::String(Self::normalize_signer_id(
                obj.get("signer_id")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing signer_id")?
            )?));
        
        canonical.insert("version".to_string(), 
            Value::String("1.0.0".to_string()));

        Ok(Value::Object(canonical.into_iter().collect()))
    }

    /// Canonicalize derivatives object with strict field validation
    fn canonicalize_derivatives(deriv: &Map<String, Value>) -> Result<Value, String> {
        // STRICT: Validate allowed fields
        let mut keys: Vec<_> = deriv.keys().map(|k| k.as_str()).collect();
        keys.sort();
        
        // Check for required fields and no extras
        let required = vec!["collateral", "instrument", "side", "size", "symbol"];
        for field in &required {
            if !keys.contains(field) {
                return Err(format!("Missing required field: {}", field));
            }
        }
        
        let allowed = vec!["collateral", "constraints", "instrument", "leverage", "option", "side", "size", "symbol"];
        for key in &keys {
            if !allowed.contains(key) {
                return Err(format!("Unknown field in derivatives: {}", key));
            }
        }

        let mut canonical = BTreeMap::new();

        // 1. collateral (required)
        let collateral = deriv.get("collateral")
            .and_then(|v| v.as_object())
            .ok_or("Missing or invalid collateral")?;
        canonical.insert("collateral".to_string(), 
            Self::canonicalize_collateral(collateral)?);

        // 2. constraints (optional with defaults)
        let constraints = deriv.get("constraints")
            .and_then(|v| v.as_object());
        canonical.insert("constraints".to_string(), 
            Self::canonicalize_constraints(constraints)?);

        // 3. instrument (required, lowercase)
        let instrument = deriv.get("instrument")
            .and_then(|v| v.as_str())
            .ok_or("Missing instrument")?
            .trim()
            .to_lowercase();
        
        if !["perp", "option"].contains(&instrument.as_str()) {
            return Err(format!("Invalid instrument: {}", instrument));
        }
        canonical.insert("instrument".to_string(), Value::String(instrument.clone()));

        // 4. leverage (optional, default "1")
        let leverage = deriv.get("leverage")
            .map(|v| Self::canonicalize_decimal(v, "1", "100", 2))
            .transpose()?
            .unwrap_or_else(|| Value::String("1".to_string()));
        canonical.insert("leverage".to_string(), leverage);

        // 5. option (required for options, null for perps)
        if instrument == "option" {
            let option = deriv.get("option")
                .and_then(|v| v.as_object())
                .ok_or("Missing option params for option instrument")?;
            canonical.insert("option".to_string(), 
                Self::canonicalize_option(option)?);
        } else {
            canonical.insert("option".to_string(), Value::Null);
        }

        // 6. side (required, lowercase)
        let side = deriv.get("side")
            .and_then(|v| v.as_str())
            .ok_or("Missing side")?
            .trim()
            .to_lowercase();
        
        if !["long", "short", "buy", "sell"].contains(&side.as_str()) {
            return Err(format!("Invalid side: {}", side));
        }
        canonical.insert("side".to_string(), Value::String(side));

        // 7. size (required, canonical decimal)
        let size = deriv.get("size")
            .ok_or("Missing size")?;
        canonical.insert("size".to_string(), 
            Self::canonicalize_decimal(size, "0.00000001", "1000000", 8)?);

        // 8. symbol (required, UPPERCASE)
        let symbol = deriv.get("symbol")
            .and_then(|v| v.as_str())
            .ok_or("Missing symbol")?
            .trim()
            .to_uppercase();
        
        if !symbol.contains('-') {
            return Err(format!("Invalid symbol format: {}", symbol));
        }
        canonical.insert("symbol".to_string(), Value::String(symbol));

        Ok(Value::Object(canonical.into_iter().collect()))
    }

    /// Canonicalize decimal string with bounds and precision checking
    fn canonicalize_decimal(value: &Value, min: &str, max: &str, precision: usize) -> Result<Value, String> {
        let s = if let Some(str_val) = value.as_str() {
            str_val.trim()
        } else if let Some(num_val) = value.as_number() {
            &num_val.to_string()
        } else {
            return Err("Decimal value must be string or number".to_string());
        };
        
        // Reject scientific notation
        if s.contains('e') || s.contains('E') {
            return Err(format!("Scientific notation not allowed: {}", s));
        }
        
        // Reject leading zeros (except "0" itself)
        if s.len() > 1 && s.starts_with('0') && !s.starts_with("0.") {
            return Err(format!("Leading zeros not allowed: {}", s));
        }
        
        // Reject positive sign
        if s.starts_with('+') {
            return Err(format!("Positive sign not allowed: {}", s));
        }
        
        // Reject negative values
        if s.starts_with('-') {
            return Err(format!("Negative values not allowed: {}", s));
        }
        
        // Parse as f64 for validation
        let parsed: f64 = s.parse()
            .map_err(|_| format!("Invalid decimal: {}", s))?;
        
        let min_val: f64 = min.parse().unwrap();
        let max_val: f64 = max.parse().unwrap();
        
        if parsed < min_val || parsed > max_val {
            return Err(format!("Value {} out of range [{}, {}]", s, min, max));
        }
        
        // Check precision
        if let Some(dot_pos) = s.find('.') {
            let decimals = s.len() - dot_pos - 1;
            if decimals > precision {
                return Err(format!("Value {} exceeds {} decimal places", s, precision));
            }
        }
        
        // Format canonically
        if parsed == 0.0 {
            Ok(Value::String("0".to_string()))
        } else if parsed == parsed.floor() {
            // Integer value
            Ok(Value::String(format!("{:.0}", parsed)))
        } else {
            // Decimal value - format and trim trailing zeros
            let formatted = format!("{}", parsed);
            let trimmed = formatted.trim_end_matches('0').trim_end_matches('.');
            Ok(Value::String(trimmed.to_string()))
        }
    }

    /// Canonicalize option parameters with strict validation
    fn canonicalize_option(option: &Map<String, Value>) -> Result<Value, String> {
        // STRICT: Exactly 3 fields
        let keys: Vec<_> = option.keys().map(|k| k.as_str()).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        if sorted != vec!["expiry", "kind", "strike"] {
            return Err(format!("Option must have exactly 'kind', 'strike', 'expiry'. Got: {:?}", keys));
        }

        let mut canonical = BTreeMap::new();

        // expiry (ISO 8601 seconds precision)
        let expiry = option.get("expiry")
            .and_then(|v| v.as_str())
            .ok_or("Missing option expiry")?;
        canonical.insert("expiry".to_string(), 
            Value::String(Self::normalize_timestamp(expiry)?));

        // kind (lowercase)
        let kind = option.get("kind")
            .and_then(|v| v.as_str())
            .ok_or("Missing option kind")?
            .trim()
            .to_lowercase();
        
        if !["call", "put"].contains(&kind.as_str()) {
            return Err(format!("Invalid option kind: {}", kind));
        }
        canonical.insert("kind".to_string(), Value::String(kind));

        // strike (canonical decimal)
        let strike = option.get("strike")
            .ok_or("Missing strike price")?;
        canonical.insert("strike".to_string(), 
            Self::canonicalize_decimal(strike, "0.01", "1000000000", 2)?);

        Ok(Value::Object(canonical.into_iter().collect()))
    }

    /// Canonicalize constraints with strict validation and defaults
    fn canonicalize_constraints(constraints: Option<&Map<String, Value>>) -> Result<Value, String> {
        let mut canonical = BTreeMap::new();

        if let Some(c) = constraints {
            // STRICT: Check for unknown fields
            for key in c.keys() {
                if !["max_slippage_bps", "max_funding_bps_8h", "max_fee_bps", "venue_allowlist"].contains(&key.as_str()) {
                    return Err(format!("Unknown constraint field: {}", key));
                }
            }
        }

        // max_fee_bps (integer, default 30)
        let max_fee_bps = constraints
            .and_then(|c| c.get("max_fee_bps"))
            .and_then(|v| v.as_u64())
            .unwrap_or(30);
        if max_fee_bps > 100 {
            return Err(format!("max_fee_bps {} exceeds 100", max_fee_bps));
        }
        canonical.insert("max_fee_bps".to_string(), 
            Value::Number(Number::from(max_fee_bps)));

        // max_funding_bps_8h (integer, default 50)
        let max_funding_bps_8h = constraints
            .and_then(|c| c.get("max_funding_bps_8h"))
            .and_then(|v| v.as_u64())
            .unwrap_or(50);
        if max_funding_bps_8h > 100 {
            return Err(format!("max_funding_bps_8h {} exceeds 100", max_funding_bps_8h));
        }
        canonical.insert("max_funding_bps_8h".to_string(), 
            Value::Number(Number::from(max_funding_bps_8h)));

        // max_slippage_bps (integer, default 100)
        let max_slippage_bps = constraints
            .and_then(|c| c.get("max_slippage_bps"))
            .and_then(|v| v.as_u64())
            .unwrap_or(100);
        if max_slippage_bps > 1000 {
            return Err(format!("max_slippage_bps {} exceeds 1000", max_slippage_bps));
        }
        canonical.insert("max_slippage_bps".to_string(), 
            Value::Number(Number::from(max_slippage_bps)));

        // venue_allowlist (sorted, deduplicated, lowercase)
        let mut venue_allowlist: Vec<String> = constraints
            .and_then(|c| c.get("venue_allowlist"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_lowercase()))
                    .collect()
            })
            .unwrap_or_default();
        
        venue_allowlist.sort();
        venue_allowlist.dedup();
        
        canonical.insert("venue_allowlist".to_string(), 
            Value::Array(venue_allowlist.into_iter()
                .map(Value::String)
                .collect()));

        Ok(Value::Object(canonical.into_iter().collect()))
    }

    /// Canonicalize collateral info with strict validation
    fn canonicalize_collateral(collateral: &Map<String, Value>) -> Result<Value, String> {
        // STRICT: Exactly 2 fields
        let keys: Vec<_> = collateral.keys().map(|k| k.as_str()).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        if sorted != vec!["chain", "token"] {
            return Err(format!("Collateral must have exactly 'token' and 'chain'. Got: {:?}", keys));
        }

        let mut canonical = BTreeMap::new();

        // chain (lowercase)
        let chain = collateral.get("chain")
            .and_then(|v| v.as_str())
            .ok_or("Missing collateral chain")?
            .trim()
            .to_lowercase();
        
        if !["near", "ethereum", "arbitrum", "base", "solana"].contains(&chain.as_str()) {
            return Err(format!("Invalid chain: {}", chain));
        }
        canonical.insert("chain".to_string(), Value::String(chain));

        // token (preserve checksum case, trim whitespace)
        let token = collateral.get("token")
            .and_then(|v| v.as_str())
            .ok_or("Missing collateral token")?
            .trim();
        canonical.insert("token".to_string(), Value::String(token.to_string()));

        Ok(Value::Object(canonical.into_iter().collect()))
    }

    /// Normalize ISO 8601 timestamp to seconds precision
    fn normalize_timestamp(ts: &str) -> Result<String, String> {
        let trimmed = ts.trim();
        
        // Must end with Z
        if !trimmed.ends_with('Z') {
            return Err(format!("Timestamp must end with 'Z': {}", ts));
        }
        
        // Check for timezone offset
        if trimmed.contains('+') || (trimmed.contains('-') && !trimmed.starts_with("20")) {
            return Err(format!("Timestamp must not have timezone offset: {}", ts));
        }
        
        // Remove milliseconds if present
        let normalized = if trimmed.contains('.') {
            let parts: Vec<&str> = trimmed.split('.').collect();
            if parts.len() != 2 {
                return Err(format!("Invalid timestamp format: {}", ts));
            }
            format!("{}Z", parts[0])
        } else {
            trimmed.to_string()
        };
        
        // Validate format YYYY-MM-DDTHH:MM:SSZ
        if normalized.len() != 20 {
            return Err(format!("Invalid timestamp length: {}", normalized));
        }
        
        // Basic format validation
        let parts: Vec<&str> = normalized[..19].split('T').collect();
        if parts.len() != 2 {
            return Err(format!("Invalid timestamp format, missing 'T': {}", normalized));
        }
        
        Ok(normalized)
    }

    /// Normalize signer_id (NEAR account rules)
    fn normalize_signer_id(signer_id: &str) -> Result<String, String> {
        let normalized = signer_id.trim().to_lowercase();
        
        // Basic NEAR account validation
        if normalized.is_empty() || normalized.len() > 64 {
            return Err(format!("Invalid signer_id length: {}", signer_id));
        }
        
        Ok(normalized)
    }

    /// Normalize nonce to string
    fn normalize_nonce(nonce: &Value) -> Result<String, String> {
        match nonce {
            Value::String(s) => Ok(s.trim().to_string()),
            Value::Number(n) => Ok(n.to_string()),
            _ => Err("Nonce must be string or number".to_string())
        }
    }

    /// Compute SHA-256 hash of canonicalized intent
    pub fn compute_hash(canonical_json: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(canonical_json.as_bytes());
        let result = hasher.finalize();
        
        // Return full 64-character hex digest (256 bits = 32 bytes = 64 hex chars)
        format!("{:x}", result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use proptest::prelude::*;

    #[test]
    fn test_strict_field_validation() {
        // Extra field should be rejected
        let intent = json!({
            "version": "1.0.0",
            "intent_type": "derivatives",
            "extra_field": "should fail",
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
            "deadline": "2024-01-23T11:00:00Z",
            "nonce": "123"
        });

        let result = Canonicalizer::canonicalize_intent(&intent);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid root fields"));
    }

    #[test]
    fn test_timestamp_normalization() {
        // With milliseconds - should normalize
        let ts_with_ms = "2024-01-23T11:00:00.123Z";
        let normalized = Canonicalizer::normalize_timestamp(ts_with_ms).unwrap();
        assert_eq!(normalized, "2024-01-23T11:00:00Z");

        // With timezone offset - should reject
        let ts_with_offset = "2024-01-23T11:00:00+00:00";
        let result = Canonicalizer::normalize_timestamp(ts_with_offset);
        assert!(result.is_err());
    }

    #[test]
    fn test_decimal_canonicalization() {
        // Scientific notation - should reject
        let sci = json!("1e6");
        let result = Canonicalizer::canonicalize_decimal(&sci, "0", "10000000", 8);
        assert!(result.is_err());

        // Leading zeros - should reject
        let leading = json!("00.5");
        let result = Canonicalizer::canonicalize_decimal(&leading, "0", "1", 8);
        assert!(result.is_err());

        // Positive sign - should reject
        let positive = json!("+10");
        let result = Canonicalizer::canonicalize_decimal(&positive, "0", "100", 2);
        assert!(result.is_err());

        // Valid decimal
        let valid = json!("1.50000");
        let result = Canonicalizer::canonicalize_decimal(&valid, "0", "100", 8).unwrap();
        assert_eq!(result, json!("1.5"));
    }

    #[test]
    fn test_venue_allowlist_deduplication() {
        let constraints = json!({
            "venue_allowlist": ["GMX-V2", "aevo", "gmx-v2", "AEVO"]
        });

        let result = Canonicalizer::canonicalize_constraints(
            Some(constraints.as_object().unwrap())
        ).unwrap();

        let venues = result.as_object().unwrap()
            .get("venue_allowlist").unwrap()
            .as_array().unwrap();

        // Should be sorted and deduplicated
        assert_eq!(venues.len(), 2);
        assert_eq!(venues[0], "aevo");
        assert_eq!(venues[1], "gmx-v2");
    }

    #[test]
    fn test_unknown_constraint_field() {
        let constraints = json!({
            "max_slippage_bps": 50,
            "unknown_field": "bad"
        });

        let result = Canonicalizer::canonicalize_constraints(
            Some(constraints.as_object().unwrap())
        );
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown constraint field"));
    }

    #[test]
    fn test_full_canonicalization() {
        let intent = json!({
            "version": "1.0.0",
            "intent_type": "derivatives",
            "derivatives": {
                "instrument": "PERP",
                "symbol": "eth-usd",
                "side": "LONG",
                "size": "1.50000",
                "leverage": "10.00",
                "constraints": {
                    "max_slippage_bps": 20,
                    "venue_allowlist": ["HYPERLIQUID", "gmx-v2", "gmx-v2"]
                },
                "collateral": {
                    "token": " usdc.near ",
                    "chain": "NEAR"
                }
            },
            "signer_id": "Alice.NEAR",
            "deadline": "2024-01-23T11:00:00.000Z",
            "nonce": 12345
        });

        let canonical = Canonicalizer::canonicalize_intent(&intent).unwrap();
        
        // Check normalizations
        let deriv = canonical["derivatives"].as_object().unwrap();
        assert_eq!(deriv["instrument"], "perp");
        assert_eq!(deriv["symbol"], "ETH-USD");
        assert_eq!(deriv["side"], "long");
        assert_eq!(deriv["size"], "1.5");
        assert_eq!(deriv["leverage"], "10");
        
        let collateral = deriv["collateral"].as_object().unwrap();
        assert_eq!(collateral["chain"], "near");
        assert_eq!(collateral["token"], "usdc.near");
        
        assert_eq!(canonical["signer_id"], "alice.near");
        assert_eq!(canonical["deadline"], "2024-01-23T11:00:00Z");
        assert_eq!(canonical["nonce"], "12345");
    }
}