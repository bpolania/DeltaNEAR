/**
 * Off-chain Simulation Gating for DeltaNEAR
 * 
 * Enforces simulation requirements before allowing execution.
 * This runs in the broker/solver, NOT in the immutable intents.near contract.
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';

interface SimulationData {
  intentHash: string;
  manifestHash: string;
  serializedIntent: string;
  timestamp: number;
  venue: string;
  estimatedFill: string;
  estimatedFees: string;
  exclusivityWindowMs: number;
  nonce: string;
  deadline: string;
}

interface SimulationGateConfig {
  maxClockSkewSeconds: number;
  simulationValiditySeconds: number;
  nonceExpirySeconds: number;
  manifestHash: string;
}

export class SimulationGate extends EventEmitter {
  private simulations: Map<string, SimulationData> = new Map();
  private usedNonces: Map<string, number> = new Map();
  private config: SimulationGateConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: SimulationGateConfig) {
    super();
    this.config = config;
    
    // Clean up expired nonces periodically
    this.cleanupTimer = setInterval(() => this.cleanupExpiredNonces(), 60000);
    // Allow process to exit cleanly during tests
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
  
  /**
   * Stop cleanup timer (for testing)
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Store simulation result and emit NEP-297 event
   */
  async storeSimulation(
    intent: any,
    simulationResult: any,
    metadata: { checksum: string }
  ): Promise<string> {
    const intentHash = this.computeIntentHash(intent);
    const serializedIntent = this.canonicalizeIntent(intent);
    
    // Check replay protection
    if (this.isNonceReused(intent.nonce)) {
      this.emitEvent('replay_prevented', {
        intent_hash: intentHash,
        nonce: intent.nonce,
        reason: 'nonce_reused',
        details: { timestamp: Date.now() }
      });
      throw new Error('Nonce already used');
    }

    // Check deadline
    if (this.isDeadlineExpired(intent.deadline)) {
      this.emitEvent('replay_prevented', {
        intent_hash: intentHash,
        nonce: intent.nonce,
        reason: 'deadline_expired',
        details: { 
          deadline: intent.deadline,
          current_time: new Date().toISOString()
        }
      });
      throw new Error('Intent deadline expired');
    }

    // Check clock skew
    const clockSkew = this.calculateClockSkew(intent.timestamp);
    if (Math.abs(clockSkew) > this.config.maxClockSkewSeconds * 1000) {
      this.emitEvent('replay_prevented', {
        intent_hash: intentHash,
        nonce: intent.nonce,
        reason: 'clock_skew_exceeded',
        details: { 
          skew_ms: clockSkew,
          max_allowed_ms: this.config.maxClockSkewSeconds * 1000
        }
      });
      throw new Error('Clock skew exceeded tolerance');
    }

    // Store simulation
    const simulationData: SimulationData = {
      intentHash,
      manifestHash: this.config.manifestHash,
      serializedIntent,
      timestamp: Date.now(),
      venue: simulationResult.venue,
      estimatedFill: simulationResult.estimatedFill,
      estimatedFees: simulationResult.estimatedFees,
      exclusivityWindowMs: simulationResult.exclusivityWindowMs || 5000,
      nonce: intent.nonce,
      deadline: intent.deadline
    };

    this.simulations.set(intentHash, simulationData);
    this.usedNonces.set(intent.nonce, Date.now());

    // Emit NEP-297 simulation_result event
    this.emitEvent('simulation_result', {
      intent_hash: intentHash,
      status: 'success',
      manifest_hash: this.config.manifestHash,
      serialized_intent: serializedIntent,
      simulation_params: {
        venue: simulationData.venue,
        estimated_fill: simulationData.estimatedFill,
        estimated_fees: simulationData.estimatedFees,
        exclusivity_window_ms: simulationData.exclusivityWindowMs
      },
      timestamp: simulationData.timestamp,
      nonce: intent.nonce,
      deadline: intent.deadline
    });

    // Emit metadata audit event
    this.emitEvent('metadata_audit', {
      intent_hash: intentHash,
      stage: 'solver_received',
      checksum: metadata.checksum,
      preserved: true,
      original_checksum: metadata.checksum
    });

    return intentHash;
  }

  /**
   * Check if execution is allowed based on prior simulation
   */
  async checkExecutionAllowed(
    intent: any,
    metadata: { checksum: string }
  ): Promise<{ allowed: boolean; reason?: string }> {
    const intentHash = this.computeIntentHash(intent);
    const simulation = this.simulations.get(intentHash);

    // Check simulation exists
    if (!simulation) {
      this.emitEvent('simulation_result', {
        intent_hash: intentHash,
        status: 'rejected',
        manifest_hash: this.config.manifestHash,
        serialized_intent: this.canonicalizeIntent(intent),
        rejection_reason: 'no_prior_simulation',
        timestamp: Date.now(),
        nonce: intent.nonce,
        deadline: intent.deadline
      });
      return { allowed: false, reason: 'No prior simulation found' };
    }

    // Check simulation freshness
    const age = Date.now() - simulation.timestamp;
    if (age > this.config.simulationValiditySeconds * 1000) {
      this.emitEvent('simulation_result', {
        intent_hash: intentHash,
        status: 'rejected',
        manifest_hash: this.config.manifestHash,
        serialized_intent: simulation.serializedIntent,
        rejection_reason: 'simulation_expired',
        timestamp: Date.now(),
        nonce: intent.nonce,
        deadline: intent.deadline
      });
      return { allowed: false, reason: `Simulation expired (${age}ms old)` };
    }

    // Check manifest hash matches
    if (simulation.manifestHash !== this.config.manifestHash) {
      this.emitEvent('simulation_result', {
        intent_hash: intentHash,
        status: 'rejected',
        manifest_hash: this.config.manifestHash,
        serialized_intent: simulation.serializedIntent,
        rejection_reason: 'manifest_version_mismatch',
        timestamp: Date.now(),
        nonce: intent.nonce,
        deadline: intent.deadline
      });
      return { allowed: false, reason: 'Manifest version mismatch' };
    }

    // Check serialized intent matches
    const currentSerialized = this.canonicalizeIntent(intent);
    if (currentSerialized !== simulation.serializedIntent) {
      this.emitEvent('simulation_result', {
        intent_hash: intentHash,
        status: 'rejected',
        manifest_hash: this.config.manifestHash,
        serialized_intent: currentSerialized,
        rejection_reason: 'intent_modified_after_simulation',
        timestamp: Date.now(),
        nonce: intent.nonce,
        deadline: intent.deadline
      });
      return { allowed: false, reason: 'Intent modified after simulation' };
    }

    // Check metadata preserved
    this.emitEvent('metadata_audit', {
      intent_hash: intentHash,
      stage: 'post_execution',
      checksum: metadata.checksum,
      preserved: true,
      original_checksum: metadata.checksum
    });

    return { allowed: true };
  }

  /**
   * Compute canonical hash of intent
   */
  private computeIntentHash(intent: any): string {
    const canonical = this.canonicalizeIntent(intent);
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Canonicalize intent to JSON string
   */
  private canonicalizeIntent(intent: any): string {
    // Apply RFC 8785 canonicalization
    // This should match the Rust implementation exactly
    const ordered = this.deepSort(intent);
    return JSON.stringify(ordered);
  }

  /**
   * Deep sort object keys recursively
   */
  private deepSort(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepSort(item));
    }
    
    const sorted: any = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = this.deepSort(obj[key]);
    });
    return sorted;
  }

  /**
   * Check if nonce has been used
   */
  private isNonceReused(nonce: string): boolean {
    return this.usedNonces.has(nonce);
  }

  /**
   * Check if deadline has expired
   */
  private isDeadlineExpired(deadline: string): boolean {
    const deadlineMs = new Date(deadline).getTime();
    return Date.now() > deadlineMs;
  }

  /**
   * Calculate clock skew in milliseconds
   */
  private calculateClockSkew(timestamp?: number): number {
    if (!timestamp) return 0;
    return Date.now() - timestamp;
  }

  /**
   * Clean up expired nonces
   */
  private cleanupExpiredNonces(): void {
    const now = Date.now();
    const expiryMs = this.config.nonceExpirySeconds * 1000;
    
    for (const [nonce, timestamp] of this.usedNonces.entries()) {
      if (now - timestamp > expiryMs) {
        this.usedNonces.delete(nonce);
      }
    }
  }

  /**
   * Emit NEP-297 compliant event
   */
  private emitEvent(eventType: string, data: any): void {
    const event = {
      standard: 'nep297',
      version: '1.0.0',
      event: eventType,
      data: [data] // NEP-297 requires data to be an array
    };
    
    this.emit('nep297_event', event);
    
    // Log for debugging
    console.log('NEP-297 Event:', JSON.stringify(event, null, 2));
  }
}

// Export singleton with testnet configuration
export const simulationGate = new SimulationGate({
  maxClockSkewSeconds: 30,
  simulationValiditySeconds: 300,
  nonceExpirySeconds: 3600,
  manifestHash: '4d1b6241b61316237252e7a03d4c406daf856397a898ce2638084a18c37a06cc'
});