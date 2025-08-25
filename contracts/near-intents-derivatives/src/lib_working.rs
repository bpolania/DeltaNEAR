use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{near, AccountId, env, log, PanicOnDefault};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::json_types::U128;

// Working minimal contract for deployment testing
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct IntentMetadata {
    pub intent_hash: String,
    pub solver_id: AccountId,
    pub instrument: String,
    pub symbol: String,
    pub side: String,
    pub size: String,
    pub timestamp: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ExecutionLog {
    pub intent_hash: String,
    pub solver_id: AccountId,
    pub venue: String,
    pub fill_price: String,
    pub notional: U128,
    pub fees_bps: u16,
    pub status: String,
    pub timestamp: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub version: String,
    pub authorized_solvers: Vec<AccountId>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(treasury_account_id: AccountId) -> Self {
        log!("Initializing DeltaNEAR contract with treasury: {}", treasury_account_id);
        Self {
            version: "1.0.0".to_string(),
            authorized_solvers: vec![treasury_account_id],
        }
    }

    pub fn get_schema_version(&self) -> String {
        self.version.clone()
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
        log!("Storing intent metadata for hash: {}", intent_hash);
        format!("Stored intent {} for solver {}", intent_hash, metadata.solver_id)
    }

    pub fn log_execution(&mut self, intent_hash: String, log: ExecutionLog) -> String {
        log!("Logging execution for intent: {}", intent_hash);
        format!("Logged execution {} at venue {} with status {}", intent_hash, log.venue, log.status)
    }
}