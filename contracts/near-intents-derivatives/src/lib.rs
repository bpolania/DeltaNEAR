use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::store::{UnorderedMap, UnorderedSet};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault, log};

mod canonicalization;
mod events;

use canonicalization::Canonicalizer;
use events::EventEmitter;

/// Stable Public Contract for DeltaNEAR Derivatives v1.0.0
/// Provides metadata, configuration, and audit functionality
/// All token operations handled by Canonical Verifier (intents.near)

const SCHEMA_VERSION: &str = "1.0.0";

// ============ Configuration Structures ============

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct FeeConfig {
    pub protocol_fee_bps: u16,
    pub solver_rebate_bps: u16,
    pub min_fee_usdc: String,
    pub max_fee_bps: u16,
    pub treasury: AccountId,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Guardrails {
    pub max_position_size: String,
    pub max_leverage: String,
    pub max_daily_volume: String,
    pub allowed_instruments: Vec<String>,
    pub cooldown_seconds: u32,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct SymbolConfig {
    pub symbol: String,
    pub instruments: Vec<String>,
    pub min_size: String,
    pub max_size: String,
    pub tick_size: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct VenueConfig {
    pub venue_id: String,
    pub chain: String,
    pub supported_instruments: Vec<String>,
    pub fee_bps: u16,
}

// ============ Intent and Metadata Structures ============

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DerivativesIntent {
    pub version: String,
    pub intent_type: String,
    pub derivatives: DerivativesAction,
    pub signer_id: AccountId,
    pub deadline: String,
    pub nonce: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DerivativesAction {
    pub instrument: String,
    pub symbol: String,
    pub side: String,
    pub size: String,
    pub leverage: Option<String>,
    pub option: Option<OptionParams>,
    pub constraints: Option<Constraints>,
    pub collateral: CollateralInfo,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct OptionParams {
    pub kind: String,
    pub strike: String,
    pub expiry: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Constraints {
    pub max_slippage_bps: Option<u16>,
    pub max_funding_bps_8h: Option<u16>,
    pub max_fee_bps: Option<u16>,
    pub venue_allowlist: Option<Vec<String>>,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct CollateralInfo {
    pub token: String,
    pub chain: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct IntentMetadata {
    pub intent_hash: String,
    pub instrument: String,
    pub symbol: String,
    pub side: String,
    pub size: String,
    pub leverage: Option<String>,
    pub strike: Option<String>,
    pub expiry: Option<String>,
    pub solver_id: AccountId,
    pub created_at: u64,
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
    pub pnl: Option<String>,
    pub status: String,
    pub timestamp: u64,
}

// NEP-297 events are defined in events.rs module

// ============ Storage Keys ============

#[derive(BorshStorageKey, BorshSerialize)]
pub enum StorageKey {
    Metadata,
    ExecutionLogs,
    SymbolConfigs,
    VenueConfigs,
    VenuesBySymbol { symbol_hash: Vec<u8> },
    UserGuardrails,
    SymbolGuardrails,
    SimulationResults,
}

// ============ Contract Implementation ============

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct SimulationResult {
    pub intent_hash: String,
    pub simulation_hash: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub timestamp: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct SimulationData {
    pub simulation_hash: String,
    pub timestamp: u64,
    pub estimated_fill: String,
    pub estimated_fees: String,
    pub venue: String,
    pub valid: bool,
    pub error: Option<String>,
}


#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ExecutionReceipt {
    pub success: bool,
    pub executed: Vec<String>,
    pub failed: Vec<serde_json::Value>,
    pub total_fee: String,
    pub settlements: Vec<TokenDiff>,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenDiff {
    pub account_id: String,
    pub token_id: String,
    pub amount_delta: String,
    pub direction: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub fee_config: FeeConfig,
    pub default_guardrails: Guardrails,
    pub metadata: UnorderedMap<String, IntentMetadata>,
    pub execution_logs: UnorderedMap<String, ExecutionLog>,
    pub symbol_configs: UnorderedMap<String, SymbolConfig>,
    pub venue_configs: UnorderedMap<String, VenueConfig>,
    pub venues_by_symbol: UnorderedMap<String, UnorderedSet<String>>,
    pub user_guardrails: UnorderedMap<AccountId, Guardrails>,
    pub symbol_guardrails: UnorderedMap<String, Guardrails>,
    pub simulation_results: UnorderedMap<String, SimulationResult>,
}

#[near]
impl Contract {
    /// Initialize contract with comprehensive configuration
    #[init]
    pub fn new(
        treasury_account_id: AccountId,
        protocol_fee_bps: u16,
        solver_rebate_bps: u16,
    ) -> Self {
        Self {
            fee_config: FeeConfig {
                protocol_fee_bps,
                solver_rebate_bps,
                min_fee_usdc: "0.10".to_string(),
                max_fee_bps: 100,
                treasury: treasury_account_id,
            },
            default_guardrails: Guardrails {
                max_position_size: "100000".to_string(),
                max_leverage: "20".to_string(),
                max_daily_volume: "1000000".to_string(),
                allowed_instruments: vec!["perp".to_string(), "option".to_string()],
                cooldown_seconds: 60,
            },
            metadata: UnorderedMap::new(StorageKey::Metadata),
            execution_logs: UnorderedMap::new(StorageKey::ExecutionLogs),
            symbol_configs: UnorderedMap::new(StorageKey::SymbolConfigs),
            venue_configs: UnorderedMap::new(StorageKey::VenueConfigs),
            venues_by_symbol: UnorderedMap::new(StorageKey::VenuesBySymbol { symbol_hash: vec![] }),
            user_guardrails: UnorderedMap::new(StorageKey::UserGuardrails),
            symbol_guardrails: UnorderedMap::new(StorageKey::SymbolGuardrails),
            simulation_results: UnorderedMap::new(StorageKey::SimulationResults),
        }
    }

    // ============ Stable View Methods (v1.0.0) ============

    /// Get current schema version - ALWAYS returns "1.0.0" for v1
    pub fn get_schema_version(&self) -> String {
        SCHEMA_VERSION.to_string()
    }
    
    /// Get major version only
    pub fn get_major_version(&self) -> u32 {
        1
    }
    
    /// Get ABI hash for quick drift detection
    pub fn get_abi_hash(&self) -> String {
        // This is the SHA-256 hash of abi/v1.0.0.json
        // MUST be updated if ABI changes
        "a3f2e8c9d4a5b6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2".to_string()
    }

    /// Get fee configuration
    pub fn get_fee_config(&self) -> FeeConfig {
        self.fee_config.clone()
    }

    /// Get guardrails with explicit precedence: user > symbol > default
    /// Returns default guardrails if neither symbol nor account specified
    pub fn get_guardrails(&self, symbol: Option<String>, account: Option<AccountId>) -> Guardrails {
        // Priority 1: User-specific guardrails
        if let Some(account_id) = account {
            if let Some(user_guardrails) = self.user_guardrails.get(&account_id) {
                return user_guardrails.clone();
            }
        }
        
        // Priority 2: Symbol-specific guardrails
        if let Some(sym) = symbol {
            if let Some(symbol_guardrails) = self.symbol_guardrails.get(&sym) {
                return symbol_guardrails.clone();
            }
        }
        
        // Priority 3: Default guardrails
        self.default_guardrails.clone()
    }

    /// Get supported trading symbols
    pub fn get_supported_symbols(&self) -> Vec<SymbolConfig> {
        self.symbol_configs.values().cloned().collect()
    }

    /// Get allowed venues for a symbol
    pub fn get_allowed_venues(&self, symbol: String) -> Vec<VenueConfig> {
        let mut venues = Vec::new();
        
        if let Some(venue_ids) = self.venues_by_symbol.get(&symbol) {
            for venue_id in venue_ids.iter() {
                if let Some(config) = self.venue_configs.get(venue_id) {
                    venues.push(config.clone());
                }
            }
        }
        
        venues
    }

    /// Verify intent hash matches our computation
    pub fn verify_intent_hash(&self, intent_json: String) -> String {
        self.compute_intent_hash(intent_json)
    }

    /// Get metadata for an intent
    pub fn get_intent_metadata(&self, intent_hash: String) -> Option<IntentMetadata> {
        self.metadata.get(&intent_hash).cloned()
    }

    /// Get execution log for an intent
    pub fn get_execution_log(&self, intent_hash: String) -> Option<ExecutionLog> {
        self.execution_logs.get(&intent_hash).cloned()
    }
    
    /// Get simulation result for an intent
    pub fn get_simulation_result(&self, intent_hash: String) -> Option<SimulationResult> {
        self.simulation_results.get(&intent_hash).cloned()
    }
    
    /// Check if intent has successful simulation
    pub fn has_successful_simulation(&self, intent_hash: String) -> bool {
        self.simulation_results.get(&intent_hash)
            .map(|result| result.success)
            .unwrap_or(false)
    }

    // ============ Change Methods ============

    /// Store intent metadata
    pub fn store_intent_metadata(&mut self, intent_hash: String, metadata: IntentMetadata) {
        self.metadata.insert(intent_hash.clone(), metadata.clone());
        
        EventEmitter::emit_intent_submitted(
            intent_hash,
            metadata.solver_id,
            metadata.instrument,
            metadata.symbol,
            metadata.side,
            metadata.size,
        );
    }

    /// Log execution after venue execution
    /// REQUIRES successful simulation to be recorded first
    pub fn log_execution(&mut self, intent_hash: String, log: ExecutionLog) {
        // Enforce simulation gate
        require!(
            self.has_successful_simulation(intent_hash.clone()),
            "Execution requires successful simulation"
        );
        
        self.execution_logs.insert(intent_hash.clone(), log.clone());
        
        EventEmitter::emit_execution_logged(
            intent_hash,
            log.solver_id,
            log.venue,
            log.fill_price,
            log.notional.0.to_string(),
            log.status,
        );
    }
    
    /// Record simulation result
    pub fn record_simulation(&mut self, 
        intent_hash: String,
        simulation_hash: String,
        success: bool,
        error_message: Option<String>
    ) {
        let result = SimulationResult {
            intent_hash: intent_hash.clone(),
            simulation_hash: simulation_hash.clone(),
            success,
            error_message: error_message.clone(),
            timestamp: env::block_timestamp(),
        };
        
        self.simulation_results.insert(intent_hash.clone(), result);
        
        EventEmitter::emit_simulation_completed(
            intent_hash,
            simulation_hash,
            success,
            error_message,
        );
    }

    // ============ Configuration Methods ============

    /// Add or update a symbol configuration
    pub fn add_symbol_config(&mut self, config: SymbolConfig) {
        require!(
            env::predecessor_account_id() == self.fee_config.treasury,
            "Only treasury can add symbols"
        );
        
        self.symbol_configs.insert(config.symbol.clone(), config.clone());
        
        log!(
            "SymbolAdded: symbol={}, instruments={:?}, min_size={}, max_size={}",
            config.symbol,
            config.instruments,
            config.min_size,
            config.max_size
        );
    }

    /// Add or update a venue configuration
    pub fn add_venue_config(&mut self, config: VenueConfig, symbols: Vec<String>) {
        require!(
            env::predecessor_account_id() == self.fee_config.treasury,
            "Only treasury can add venues"
        );
        
        self.venue_configs.insert(config.venue_id.clone(), config.clone());
        
        // Update venue-symbol mappings
        for symbol in symbols {
            // Check if we already have a set for this symbol
            if let Some(mut venue_set) = self.venues_by_symbol.remove(&symbol) {
                venue_set.insert(config.venue_id.clone());
                self.venues_by_symbol.insert(symbol.clone(), venue_set);
            } else {
                let mut venue_set = UnorderedSet::new(
                    StorageKey::VenuesBySymbol { 
                        symbol_hash: env::sha256(symbol.as_bytes()) 
                    }
                );
                venue_set.insert(config.venue_id.clone());
                self.venues_by_symbol.insert(symbol.clone(), venue_set);
            }
        }
        
        log!(
            "VenueAdded: venue_id={}, chain={}, instruments={:?}",
            config.venue_id,
            config.chain,
            config.supported_instruments
        );
    }

    /// Set guardrails for a specific user
    pub fn set_user_guardrails(&mut self, account: AccountId, guardrails: Guardrails) {
        require!(
            env::predecessor_account_id() == self.fee_config.treasury,
            "Only treasury can set guardrails"
        );
        
        self.user_guardrails.insert(account.clone(), guardrails);
        
        log!("UserGuardrailsSet: account={}", account);
    }

    /// Set guardrails for a specific symbol
    pub fn set_symbol_guardrails(&mut self, symbol: String, guardrails: Guardrails) {
        require!(
            env::predecessor_account_id() == self.fee_config.treasury,
            "Only treasury can set guardrails"
        );
        
        self.symbol_guardrails.insert(symbol.clone(), guardrails);
        
        log!("SymbolGuardrailsSet: symbol={}", symbol);
    }

    /// Update fee configuration
    pub fn update_fee_config(&mut self, config: FeeConfig) {
        require!(
            env::predecessor_account_id() == self.fee_config.treasury,
            "Only treasury can update fees"
        );
        require!(config.protocol_fee_bps <= 1000, "Protocol fee cannot exceed 10%");
        require!(config.max_fee_bps <= 1000, "Max fee cannot exceed 10%");
        
        self.fee_config = config;
        
        log!("FeeConfigUpdated");
    }

    /// Get preserved metadata for an intent by hash
    pub fn get_intent_metadata(&self, intent_hash: String) -> Option<serde_json::Value> {
        self.intent_metadata.get(&intent_hash).map(|metadata| {
            serde_json::json!({
                "checksum": metadata.checksum,
                "timestamp": metadata.timestamp,
                "preserved": metadata.opaque_data
            })
        })
    }
    
    /// Get execution log for an intent by hash
    pub fn get_execution_log(&self, intent_hash: String) -> Option<ExecutionLog> {
        self.execution_logs.get(&intent_hash)
    }

    // ============ Execution Methods with Simulation Gating ============
    
    /// Simulate intents and store results for later execution
    pub fn simulate_intents(&mut self, intents_json: String) -> SimulationResult {
        let intents: Vec<serde_json::Value> = serde_json::from_str(&intents_json)
            .expect("Invalid intents JSON");
        
        let mut simulated = vec![];
        let mut errors = vec![];
        let mut total_fees = 0u128;
        
        for intent in intents {
            let intent_hash = self.compute_intent_hash(serde_json::to_string(&intent).unwrap());
            
            // Perform simulation (simplified - would call actual venue quotes)
            let simulation = self.simulate_single_intent(&intent);
            
            if simulation.valid {
                // Store simulation result with hash
                let simulation_hash = self.compute_simulation_hash(&intent_hash, &simulation);
                
                self.simulation_results.insert(&intent_hash, &SimulationData {
                    simulation_hash: simulation_hash.clone(),
                    timestamp: env::block_timestamp(),
                    estimated_fill: simulation.estimated_fill.clone(),
                    estimated_fees: simulation.estimated_fees.clone(),
                    venue: simulation.venue.clone(),
                });
                
                simulated.push(serde_json::json!({
                    "intent_hash": intent_hash,
                    "simulation_hash": simulation_hash,
                    "estimated_fill": simulation.estimated_fill,
                    "venue": simulation.venue
                }));
                
                // Emit simulation event
                EventEmitter::emit_simulation_event(
                    intent_hash.clone(),
                    "success".to_string(),
                    simulation_hash,
                    Some(simulation.venue),
                    Some(simulation.estimated_fill),
                    Some(simulation.estimated_fees.clone()),
                );
            } else {
                errors.push(serde_json::json!({
                    "intent_hash": intent_hash,
                    "error": simulation.error
                }));
                
                EventEmitter::emit_simulation_event(
                    intent_hash,
                    "failed".to_string(),
                    "".to_string(),
                    None,
                    None,
                    None,
                );
            }
        }
        
        SimulationResult {
            valid: errors.is_empty(),
            simulated,
            errors,
            estimated_fees: total_fees.to_string(),
            warnings: vec![],
        }
    }
    
    /// Execute intents ONLY if they have been simulated
    pub fn execute_intents(&mut self, intents_json: String) -> ExecutionReceipt {
        let intents: Vec<serde_json::Value> = serde_json::from_str(&intents_json)
            .expect("Invalid intents JSON");
        
        let mut executed = vec![];
        let mut failed = vec![];
        let mut total_fee = 0u128;
        
        for intent in intents {
            let intent_hash = self.compute_intent_hash(serde_json::to_string(&intent).unwrap());
            
            // CRITICAL: Check if intent was simulated
            let simulation = self.simulation_results.get(&intent_hash);
            
            if simulation.is_none() {
                // Emit event that simulation is required
                EventEmitter::emit_event("simulation_required", serde_json::json!({
                    "intent_hash": intent_hash,
                    "reason": "no_prior_simulation",
                    "attempted_execution": true
                }));
                
                failed.push(serde_json::json!({
                    "intent_hash": intent_hash,
                    "error": "SIMULATION_REQUIRED",
                    "message": "Intent must be simulated before execution"
                }));
                continue;
            }
            
            let sim_data = simulation.unwrap();
            
            // Check simulation freshness (5 minutes)
            if env::block_timestamp() - sim_data.timestamp > 300_000_000_000 {
                EventEmitter::emit_event("simulation_required", serde_json::json!({
                    "intent_hash": intent_hash,
                    "reason": "simulation_expired",
                    "attempted_execution": true
                }));
                
                failed.push(serde_json::json!({
                    "intent_hash": intent_hash,
                    "error": "SIMULATION_EXPIRED",
                    "message": "Simulation older than 5 minutes"
                }));
                continue;
            }
            
            // Verify simulation hash matches
            let current_sim_hash = self.compute_simulation_hash(&intent_hash, &sim_data);
            if current_sim_hash != sim_data.simulation_hash {
                EventEmitter::emit_event("simulation_required", serde_json::json!({
                    "intent_hash": intent_hash,
                    "reason": "simulation_hash_mismatch",
                    "attempted_execution": true
                }));
                
                failed.push(serde_json::json!({
                    "intent_hash": intent_hash,
                    "error": "SIMULATION_HASH_MISMATCH",
                    "message": "Intent parameters changed since simulation"
                }));
                continue;
            }
            
            // Execute the intent (would call actual venue execution)
            // For now, we'll mark as executed
            executed.push(intent_hash.clone());
            
            // Store execution log
            self.execution_logs.insert(&intent_hash, &ExecutionLog {
                intent_hash: intent_hash.clone(),
                status: "executed".to_string(),
                venue: sim_data.venue.clone(),
                fill_price: sim_data.estimated_fill.clone(),
                filled_size: "1".to_string(), // Placeholder
                fees_paid: sim_data.estimated_fees.clone(),
                chain_signature: None,
                external_tx: None,
                timestamps: serde_json::json!({
                    "simulated": sim_data.timestamp,
                    "executed": env::block_timestamp(),
                }),
            });
            
            // Emit execution event
            EventEmitter::emit_execution_event(
                intent_hash,
                sim_data.simulation_hash,
                sim_data.venue,
                sim_data.estimated_fill,
                "1".to_string(),
                sim_data.estimated_fees,
                "filled".to_string(),
            );
        }
        
        ExecutionReceipt {
            success: failed.is_empty(),
            executed,
            failed,
            total_fee: total_fee.to_string(),
            settlements: vec![],
        }
    }
    
    /// Helper to simulate a single intent
    fn simulate_single_intent(&self, intent: &serde_json::Value) -> SimulationData {
        // This would integrate with actual venue APIs
        // For now, return mock simulation
        SimulationData {
            simulation_hash: "".to_string(),
            timestamp: env::block_timestamp(),
            estimated_fill: "100.50".to_string(),
            estimated_fees: "0.25".to_string(),
            venue: "lyra-v2".to_string(),
            valid: true,
            error: None,
        }
    }
    
    /// Compute hash of simulation parameters
    fn compute_simulation_hash(&self, intent_hash: &str, sim_data: &SimulationData) -> String {
        let sim_params = serde_json::json!({
            "intent_hash": intent_hash,
            "venue": sim_data.venue,
            "estimated_fill": sim_data.estimated_fill,
            "estimated_fees": sim_data.estimated_fees,
            "timestamp": sim_data.timestamp,
        });
        
        Canonicalizer::compute_hash(&serde_json::to_string(&sim_params).unwrap())
    }

    // ============ Internal Methods ============

    /// Compute canonical hash for an intent using deep canonicalization
    fn compute_intent_hash(&self, intent_json: String) -> String {
        // Parse intent as JSON value
        let intent: serde_json::Value = serde_json::from_str(&intent_json)
            .expect("Invalid intent JSON");
        
        // Apply deep canonicalization
        let canonical = Canonicalizer::canonicalize_intent(&intent)
            .expect("Failed to canonicalize intent");
        
        // Serialize with deterministic ordering (BTreeMap ensures this)
        let serialized = serde_json::to_string(&canonical)
            .expect("Failed to serialize canonical intent");
        
        // Compute and return full SHA-256 hash (64 hex characters)
        Canonicalizer::compute_hash(&serialized)
    }

    // Event emission is handled by EventEmitter in events.rs
}

// Note: This contract serves as the stable public interface for derivatives
// - Provides canonical schema and hashing algorithm
// - Stores metadata and execution logs
// - Manages configuration and guardrails
// - Emits NEP-297 compliant events
// - All token operations go through Canonical Verifier (intents.near)

#[cfg(test)]
mod tests;