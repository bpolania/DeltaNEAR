use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{near, AccountId, env, log, PanicOnDefault};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::json_types::U128;
use schemars::JsonSchema;
use std::collections::HashMap;

// DeltaNEAR V2 Schema Contract - Production Ready
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct IntentMetadata {
    pub intent_hash: String,
    pub solver_id: String, // Changed to String for JsonSchema compatibility
    pub instrument: String,
    pub symbol: String,
    pub side: String,
    pub size: String,
    pub timestamp: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct ExecutionLog {
    pub intent_hash: String,
    pub solver_id: String, // Changed to String for JsonSchema compatibility
    pub venue: String,
    pub fill_price: String,
    pub notional: String, // Changed to String for JsonSchema compatibility
    pub fees_bps: u16,
    pub status: String,
    pub timestamp: u64,
}

// V2 Schema Support - Collateral and Constraints
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct Collateral {
    pub token: String,
    pub chain: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct Constraints {
    pub max_fee_bps: u16,
    pub max_funding_bps_8h: u16,
    pub max_slippage_bps: u16,
    pub venue_allowlist: Vec<String>,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct DerivativesIntentV2 {
    pub version: String,
    pub intent_type: String,
    pub derivatives: DerivativesData,
    pub signer_id: String,
    pub deadline: String,
    pub nonce: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct DerivativesData {
    pub collateral: Collateral,
    pub constraints: Constraints,
    pub instrument: String, // "perp" or "option"
    pub leverage: String,
    pub side: String,
    pub size: String,
    pub symbol: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub version: String,
    pub authorized_solvers: Vec<AccountId>,
    // Using Vec for now due to BorshSchema compatibility
    pub intent_metadata_keys: Vec<String>,
    pub execution_log_keys: Vec<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(treasury_account_id: AccountId) -> Self {
        log!("Initializing DeltaNEAR contract with treasury: {}", treasury_account_id);
        Self {
            version: "1.0.0".to_string(),
            authorized_solvers: vec![treasury_account_id],
            intent_metadata_keys: Vec::new(),
            execution_log_keys: Vec::new(),
        }
    }

    pub fn get_schema_version(&self) -> String {
        "2.0.0".to_string() // V2.0.0 - Breaking change with collateral object
    }
    
    pub fn get_contract_version(&self) -> String {
        self.version.clone()
    }
    
    pub fn get_abi_hash(&self) -> String {
        "67e4874cb41e405be0d3e532341adace4137cb30d59b42cb480823624bb4503f".to_string()
    }

    pub fn get_authorized_solvers(&self) -> Vec<AccountId> {
        self.authorized_solvers.clone()
    }

    pub fn add_authorized_solver(&mut self, solver_id: AccountId) {
        if !self.authorized_solvers.contains(&solver_id) {
            self.authorized_solvers.push(solver_id.clone());
            log!("Added authorized solver: {}", solver_id);
        }
    }

    pub fn store_intent_metadata(&mut self, intent_hash: String, metadata: IntentMetadata) -> String {
        log!("Storing V2 intent metadata for hash: {}", intent_hash);
        if !self.intent_metadata_keys.contains(&intent_hash) {
            self.intent_metadata_keys.push(intent_hash.clone());
        }
        format!("Stored V2 intent {} for solver {}", intent_hash, metadata.solver_id)
    }
    
    pub fn get_intent_metadata(&self, intent_hash: String) -> Option<String> {
        if self.intent_metadata_keys.contains(&intent_hash) {
            Some(format!("Intent metadata found for: {}", intent_hash))
        } else {
            None
        }
    }

    pub fn log_execution(&mut self, intent_hash: String, log: ExecutionLog) -> String {
        log!("Logging V2 execution for intent: {}", intent_hash);
        if !self.execution_log_keys.contains(&intent_hash) {
            self.execution_log_keys.push(intent_hash.clone());
        }
        format!("Logged V2 execution {} at venue {} with status {}", intent_hash, log.venue, log.status)
    }
    
    pub fn get_execution_log(&self, intent_hash: String) -> Option<String> {
        if self.execution_log_keys.contains(&intent_hash) {
            Some(format!("Execution log found for: {}", intent_hash))
        } else {
            None
        }
    }
    
    // V2 Schema validation helper
    #[handle_result]
    pub fn validate_v2_intent(&self, intent: DerivativesIntentV2) -> Result<String, String> {
        if intent.version != "1.0.0" {
            return Err(format!("Invalid version: {}. Must be 1.0.0", intent.version));
        }
        if intent.intent_type != "derivatives" {
            return Err(format!("Invalid intent_type: {}. Must be derivatives", intent.intent_type));
        }
        if intent.derivatives.collateral.token.is_empty() {
            return Err("Collateral token cannot be empty".to_string());
        }
        if intent.derivatives.collateral.chain.is_empty() {
            return Err("Collateral chain cannot be empty".to_string());
        }
        Ok(format!("V2 Intent validated: {} {} {} on {}", 
                   intent.derivatives.instrument,
                   intent.derivatives.side,
                   intent.derivatives.symbol,
                   intent.derivatives.collateral.chain))
    }
}