use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json};
use near_sdk::{log, AccountId};

/// NEP-297 Event Standard Implementation for DeltaNEAR Derivatives v1.0.0
/// 
/// IMMUTABLE SPECIFICATION - ANY CHANGE BREAKS COMPATIBILITY
/// 
/// Event format MUST be:
/// EVENT_JSON:{"standard":"deltanear_derivatives","version":"1.0.0","event":"<event_name>","data":[{...}]}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Nep297Event {
    /// MUST be "deltanear_derivatives"
    pub standard: &'static str,
    /// MUST be "1.0.0"
    pub version: &'static str,
    /// Event name from the defined set
    pub event: &'static str,
    /// Array of event data objects (NEP-297 requirement)
    pub data: Vec<serde_json::Value>,
}

/// Event data for intent_submitted
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct IntentSubmittedData {
    pub intent_hash: String,
    pub signer_id: AccountId,
    pub instrument: String,
    pub symbol: String,
    pub side: String,
    pub size: String,
    /// Timestamp in nanoseconds since Unix epoch
    pub timestamp_ns: u64,
}

/// Event data for execution_logged
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ExecutionLoggedData {
    pub intent_hash: String,
    pub solver_id: AccountId,
    pub venue: String,
    pub fill_price: String,
    /// Notional value as string to avoid precision loss
    pub notional: String,
    pub status: String,
    /// Timestamp in nanoseconds since Unix epoch
    pub timestamp_ns: u64,
}

/// Event data for solver_assigned
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SolverAssignedData {
    pub intent_hash: String,
    pub solver_id: AccountId,
    /// Timestamp in nanoseconds since Unix epoch
    pub timestamp_ns: u64,
}

/// Event data for simulation_completed
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SimulationCompletedData {
    pub intent_hash: String,
    pub simulation_hash: String,
    pub success: bool,
    pub error_message: Option<String>,
    /// Timestamp in nanoseconds since Unix epoch
    pub timestamp_ns: u64,
}

/// Event data for settlement_initiated
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SettlementInitiatedData {
    pub intent_hash: String,
    /// TokenDiff object as JSON
    pub token_diff: serde_json::Value,
    /// Timestamp in nanoseconds since Unix epoch
    pub timestamp_ns: u64,
}

/// Event data for settlement_completed
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SettlementCompletedData {
    pub intent_hash: String,
    pub tx_hash: String,
    /// Timestamp in nanoseconds since Unix epoch
    pub timestamp_ns: u64,
}

pub struct EventEmitter;

impl EventEmitter {
    const STANDARD: &'static str = "deltanear_derivatives";
    const VERSION: &'static str = "1.0.0";

    /// Emit intent_submitted event
    pub fn emit_intent_submitted(
        intent_hash: String,
        signer_id: AccountId,
        instrument: String,
        symbol: String,
        side: String,
        size: String,
    ) {
        let data = IntentSubmittedData {
            intent_hash,
            signer_id,
            instrument,
            symbol,
            side,
            size,
            timestamp_ns: near_sdk::env::block_timestamp(),
        };

        Self::emit_event("intent_submitted", vec![json!(data)]);
    }

    /// Emit execution_logged event
    pub fn emit_execution_logged(
        intent_hash: String,
        solver_id: AccountId,
        venue: String,
        fill_price: String,
        notional: String,
        status: String,
    ) {
        let data = ExecutionLoggedData {
            intent_hash,
            solver_id,
            venue,
            fill_price,
            notional,
            status,
            timestamp_ns: near_sdk::env::block_timestamp(),
        };

        Self::emit_event("execution_logged", vec![json!(data)]);
    }

    /// Emit solver_assigned event
    pub fn emit_solver_assigned(
        intent_hash: String,
        solver_id: AccountId,
    ) {
        let data = SolverAssignedData {
            intent_hash,
            solver_id,
            timestamp_ns: near_sdk::env::block_timestamp(),
        };

        Self::emit_event("solver_assigned", vec![json!(data)]);
    }

    /// Emit simulation_completed event
    pub fn emit_simulation_completed(
        intent_hash: String,
        simulation_hash: String,
        success: bool,
        error_message: Option<String>,
    ) {
        let data = SimulationCompletedData {
            intent_hash,
            simulation_hash,
            success,
            error_message,
            timestamp_ns: near_sdk::env::block_timestamp(),
        };

        Self::emit_event("simulation_completed", vec![json!(data)]);
    }

    /// Emit settlement_initiated event
    pub fn emit_settlement_initiated(
        intent_hash: String,
        token_diff: serde_json::Value,
    ) {
        let data = SettlementInitiatedData {
            intent_hash,
            token_diff,
            timestamp_ns: near_sdk::env::block_timestamp(),
        };

        Self::emit_event("settlement_initiated", vec![json!(data)]);
    }

    /// Emit settlement_completed event
    pub fn emit_settlement_completed(
        intent_hash: String,
        tx_hash: String,
    ) {
        let data = SettlementCompletedData {
            intent_hash,
            tx_hash,
            timestamp_ns: near_sdk::env::block_timestamp(),
        };

        Self::emit_event("settlement_completed", vec![json!(data)]);
    }

    /// Internal method to emit events in exact NEP-297 format
    fn emit_event(event_name: &'static str, data: Vec<serde_json::Value>) {
        let event = Nep297Event {
            standard: Self::STANDARD,
            version: Self::VERSION,
            event: event_name,
            data,
        };

        let event_json = serde_json::to_string(&event)
            .expect("Failed to serialize event");

        // Emit in exact NEP-297 format
        log!("EVENT_JSON:{}", event_json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_format() {
        // Test that events serialize to correct format
        let event = Nep297Event {
            standard: "deltanear_derivatives",
            version: "1.0.0",
            event: "test_event",
            data: vec![json!({"key": "value"})],
        };

        let serialized = serde_json::to_string(&event).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&serialized).unwrap();

        assert_eq!(parsed["standard"], "deltanear_derivatives");
        assert_eq!(parsed["version"], "1.0.0");
        assert_eq!(parsed["event"], "test_event");
        assert!(parsed["data"].is_array());
        assert_eq!(parsed["data"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_timestamp_format() {
        let data = IntentSubmittedData {
            intent_hash: "test".to_string(),
            signer_id: "alice.near".parse().unwrap(),
            instrument: "perp".to_string(),
            symbol: "ETH-USD".to_string(),
            side: "long".to_string(),
            size: "1.5".to_string(),
            timestamp_ns: 1_000_000_000_000_000, // 1 second in nanoseconds
        };

        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["timestamp_ns"], 1_000_000_000_000_000u64);
    }
}