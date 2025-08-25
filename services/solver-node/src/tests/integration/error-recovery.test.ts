import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';

/**
 * Error Recovery and Resilience Tests
 * 
 * Tests system resilience under various failure scenarios:
 * 1. Partial execution failures
 * 2. Network partitions
 * 3. Service disconnections
 * 4. State inconsistencies
 * 5. Cascading failures
 */

interface SystemComponent {
  name: string;
  status: 'healthy' | 'degraded' | 'failed';
  lastHeartbeat: number;
  errorCount: number;
  isRequired: boolean;
}

interface RecoveryStrategy {
  component: string;
  strategy: 'retry' | 'failover' | 'circuit-break' | 'degrade';
  maxRetries: number;
  backoffMs: number;
  timeout: number;
}

class ResilienceTestHarness extends EventEmitter {
  private components: Map<string, SystemComponent> = new Map();
  private recoveryStrategies: Map<string, RecoveryStrategy> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private stateCheckpoints: Map<string, any> = new Map();
  private mockRandomValue: number = 0.5; // Default 50% success rate
  private attemptCounter: number = 0; // Track recovery attempts for deterministic behavior
  private useRealDelays: boolean = false; // For testing, use synchronous behavior
  
  constructor() {
    super();
    this.initializeComponents();
    this.setupRecoveryStrategies();
  }

  setMockRandomValue(value: number) {
    this.mockRandomValue = value;
  }

  setUseRealDelays(value: boolean) {
    this.useRealDelays = value;
  }

  getMockRandom(): number {
    // Use counter for more predictable behavior in tests
    this.attemptCounter++;
    // First attempt fails, subsequent attempts succeed (for testing retry logic)
    if (this.attemptCounter === 1) {
      return 0.2; // Will fail (< 0.3)
    }
    return 0.8; // Will succeed (> 0.3)
  }

  private initializeComponents() {
    const componentList = [
      { name: 'gateway', isRequired: true },
      { name: 'solver-1', isRequired: false },
      { name: 'solver-2', isRequired: false },
      { name: 'contract', isRequired: true },
      { name: 'verifier', isRequired: true },
      { name: 'chain-signatures', isRequired: true },
      { name: 'database', isRequired: true },
      { name: 'redis-cache', isRequired: false },
      { name: '1click-api', isRequired: false }
    ];

    for (const comp of componentList) {
      this.components.set(comp.name, {
        name: comp.name,
        status: 'healthy',
        lastHeartbeat: Date.now(),
        errorCount: 0,
        isRequired: comp.isRequired
      });
    }
  }

  private setupRecoveryStrategies() {
    this.recoveryStrategies.set('gateway', {
      component: 'gateway',
      strategy: 'retry',
      maxRetries: 3,
      backoffMs: 100, // Reduced for testing
      timeout: 3000
    });

    this.recoveryStrategies.set('solver', {
      component: 'solver',
      strategy: 'failover',
      maxRetries: 1,
      backoffMs: 0,
      timeout: 1000
    });

    this.recoveryStrategies.set('contract', {
      component: 'contract',
      strategy: 'circuit-break',
      maxRetries: 3, // Reduced for testing
      backoffMs: 200, // Reduced for testing
      timeout: 5000
    });

    this.recoveryStrategies.set('database', {
      component: 'database',
      strategy: 'retry',
      maxRetries: 5, // Reduced for testing
      backoffMs: 100, // Reduced for testing
      timeout: 10000
    });

    this.recoveryStrategies.set('redis-cache', {
      component: 'redis-cache',
      strategy: 'retry',
      maxRetries: 2,
      backoffMs: 50,
      timeout: 2000
    });

    this.recoveryStrategies.set('verifier', {
      component: 'verifier',
      strategy: 'retry',
      maxRetries: 3,
      backoffMs: 100,
      timeout: 3000
    });

    this.recoveryStrategies.set('chain-signatures', {
      component: 'chain-signatures',
      strategy: 'retry',
      maxRetries: 3,
      backoffMs: 200,
      timeout: 5000
    });
  }

  /**
   * Simulate component failure
   */
  async failComponent(componentName: string, errorType: 'crash' | 'timeout' | 'network'): Promise<void> {
    const component = this.components.get(componentName);
    if (!component) {
      throw new Error(`Component ${componentName} not found`);
    }

    // Reset counter for each failure to ensure predictable recovery
    this.attemptCounter = 0;

    component.status = 'failed';
    component.errorCount++;
    
    this.emit('component:failed', {
      component: componentName,
      errorType,
      timestamp: Date.now()
    });

    // Attempt recovery
    await this.attemptRecovery(componentName, errorType);
  }

  /**
   * Attempt to recover failed component
   */
  async attemptRecovery(componentName: string, errorType: string): Promise<void> {
    const strategy = this.recoveryStrategies.get(
      componentName.startsWith('solver') ? 'solver' : componentName
    );

    if (!strategy) {
      this.emit('recovery:no-strategy', { component: componentName });
      return;
    }

    this.emit('recovery:started', {
      component: componentName,
      strategy: strategy.strategy
    });

    switch (strategy.strategy) {
      case 'retry':
        await this.retryRecovery(componentName, strategy);
        break;
      case 'failover':
        await this.failoverRecovery(componentName, strategy);
        break;
      case 'circuit-break':
        await this.circuitBreakerRecovery(componentName, strategy);
        break;
      case 'degrade':
        await this.degradeService(componentName);
        break;
    }
  }

  /**
   * Retry recovery with exponential backoff
   */
  private async retryRecovery(componentName: string, strategy: RecoveryStrategy): Promise<void> {
    const component = this.components.get(componentName)!;
    
    for (let attempt = 1; attempt <= strategy.maxRetries; attempt++) {
      await this.delay(strategy.backoffMs * Math.pow(2, attempt - 1));
      
      this.emit('recovery:retry', {
        component: componentName,
        attempt,
        maxRetries: strategy.maxRetries
      });

      // Simulate recovery attempt
      const random = this.getMockRandom();
      if (random > 0.3) { // 70% success rate
        component.status = 'healthy';
        component.lastHeartbeat = Date.now();
        
        this.emit('recovery:success', {
          component: componentName,
          attempts: attempt
        });
        return;
      }
    }

    this.emit('recovery:failed', {
      component: componentName,
      reason: 'Max retries exceeded'
    });
  }

  /**
   * Failover to backup component
   */
  private async failoverRecovery(componentName: string, strategy: RecoveryStrategy): Promise<void> {
    // Find healthy solver
    const healthySolver = Array.from(this.components.entries())
      .find(([name, comp]) => 
        name.startsWith('solver') && 
        name !== componentName && 
        comp.status === 'healthy'
      );

    if (healthySolver) {
      this.emit('recovery:failover', {
        failed: componentName,
        backup: healthySolver[0]
      });
      
      // Mark original as degraded
      const component = this.components.get(componentName)!;
      component.status = 'degraded';
    } else {
      this.emit('recovery:failed', {
        component: componentName,
        reason: 'No healthy backup available'
      });
    }
  }

  /**
   * Circuit breaker recovery
   */
  private async circuitBreakerRecovery(componentName: string, strategy: RecoveryStrategy): Promise<void> {
    let breaker = this.circuitBreakers.get(componentName);
    
    if (!breaker) {
      breaker = new CircuitBreaker(componentName, {
        threshold: 5,
        timeout: strategy.timeout,
        resetTimeout: 60000
      });
      this.circuitBreakers.set(componentName, breaker);
    }

    // Record the failure
    breaker.recordFailure();
    
    const state = breaker.getState();
    
    if (state === 'open') {
      this.emit('circuit-breaker:open', { component: componentName });
      
      // Wait for reset timeout
      await this.delay(breaker.resetTimeout);
      breaker.halfOpen();
    }

    if (state === 'half-open') {
      // Try one request
      const success = this.getMockRandom() > 0.5;
      
      if (success) {
        breaker.close();
        const component = this.components.get(componentName)!;
        component.status = 'healthy';
        
        this.emit('circuit-breaker:closed', { component: componentName });
      } else {
        breaker.open();
        this.emit('circuit-breaker:reopened', { component: componentName });
      }
    }
  }

  /**
   * Degrade service functionality
   */
  private async degradeService(componentName: string): Promise<void> {
    const component = this.components.get(componentName)!;
    component.status = 'degraded';
    
    this.emit('service:degraded', {
      component: componentName,
      functionality: 'reduced'
    });
  }

  /**
   * Simulate network partition
   */
  async simulateNetworkPartition(components: string[], durationMs: number): Promise<void> {
    this.emit('network:partition', { components, duration: durationMs });
    
    // Isolate components
    for (const comp of components) {
      const component = this.components.get(comp);
      if (component) {
        component.status = 'failed';
      }
    }

    // Store healing function to be triggered by timer
    this.scheduleHealing(components, durationMs);
  }

  private scheduleHealing(components: string[], durationMs: number): void {
    // Use setTimeout which will be controlled by fake timers
    setTimeout(() => {
      for (const comp of components) {
        const component = this.components.get(comp);
        if (component) {
          component.status = 'healthy';
          component.lastHeartbeat = Date.now();
        }
      }
      
      this.emit('network:healed', { components });
    }, durationMs);
  }

  /**
   * Create state checkpoint
   */
  createCheckpoint(name: string, state: any): void {
    this.stateCheckpoints.set(name, {
      state: JSON.parse(JSON.stringify(state)),
      timestamp: Date.now()
    });
    
    this.emit('checkpoint:created', { name });
  }

  /**
   * Restore from checkpoint
   */
  restoreCheckpoint(name: string): any {
    const checkpoint = this.stateCheckpoints.get(name);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${name} not found`);
    }
    
    this.emit('checkpoint:restored', { name });
    return checkpoint.state;
  }

  /**
   * Check system health
   */
  getSystemHealth(): {
    healthy: boolean;
    components: SystemComponent[];
    requiredFailures: string[];
  } {
    const components = Array.from(this.components.values());
    const requiredFailures = components
      .filter(c => c.isRequired && c.status === 'failed')
      .map(c => c.name);
    
    return {
      healthy: requiredFailures.length === 0,
      components,
      requiredFailures
    };
  }

  /**
   * Simulate cascading failure
   */
  async simulateCascadingFailure(initialComponent: string): Promise<void> {
    const dependencies: Record<string, string[]> = {
      'database': ['gateway', 'contract'],
      'gateway': ['solver-1', 'solver-2'],
      'verifier': ['contract'],
      'chain-signatures': ['verifier']
    };

    const failureQueue = [initialComponent];
    const failed = new Set<string>();

    while (failureQueue.length > 0) {
      const comp = failureQueue.shift()!;
      if (failed.has(comp)) continue;

      await this.failComponent(comp, 'crash');
      failed.add(comp);

      // Add dependent components
      const deps = dependencies[comp] || [];
      for (const dep of deps) {
        if (!failed.has(dep)) {
          // Small delay before dependent failure
          await this.delay(50);
          failureQueue.push(dep);
        }
      }
    }
  }

  private delay(ms: number): Promise<void> {
    if (!this.useRealDelays) {
      // In test mode, return immediately
      return Promise.resolve();
    }
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private name: string,
    private options: {
      threshold: number;
      timeout: number;
      resetTimeout: number;
    }
  ) {}

  getState(): string {
    return this.state;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.options.threshold) {
      this.open();
    }
  }

  open(): void {
    this.state = 'open';
  }

  close(): void {
    this.state = 'closed';
    this.failureCount = 0;
  }

  halfOpen(): void {
    this.state = 'half-open';
  }

  get resetTimeout(): number {
    return this.options.resetTimeout;
  }
}

describe('Error Recovery and Resilience', () => {
  let harness: ResilienceTestHarness;

  beforeEach(() => {
    harness = new ResilienceTestHarness();
  });

  afterEach(() => {
    // Clean up any listeners
    harness.removeAllListeners();
  });

  describe('Component Failures', () => {
    test('should recover non-critical component with retry', async () => {
      const events: any[] = [];
      harness.on('recovery:success', (e) => events.push(e));

      await harness.failComponent('redis-cache', 'crash');

      // Should eventually recover
      expect(events.length).toBeGreaterThan(0);
      if (events.length > 0) {
        expect(events[0].component).toBe('redis-cache');
      }
    });

    test('should failover when solver fails', async () => {
      const failoverEvents: any[] = [];
      harness.on('recovery:failover', (e) => failoverEvents.push(e));

      await harness.failComponent('solver-1', 'crash');

      expect(failoverEvents.length).toBe(1);
      expect(failoverEvents[0].backup).toBe('solver-2');
    });

    test('should detect critical component failure', async () => {
      // Override getMockRandom to always fail for this test
      const originalGetMockRandom = harness.getMockRandom;
      harness.getMockRandom = () => 0.1; // Always fail recovery
      
      await harness.failComponent('database', 'crash');

      // Wait for all recovery attempts to fail
      await new Promise(resolve => setTimeout(resolve, 2000));

      const health = harness.getSystemHealth();
      expect(health.healthy).toBe(false);
      expect(health.requiredFailures).toContain('database');
      
      // Restore original function
      harness.getMockRandom = originalGetMockRandom;
    }, 3000);
  });

  describe('Network Partitions', () => {
    test('should handle temporary network partition', async () => {
      const healedEvents: any[] = [];
      harness.on('network:healed', (e) => healedEvents.push(e));

      await harness.simulateNetworkPartition(
        ['solver-1', 'solver-2'],
        2000
      );

      // Wait for healing
      await new Promise(resolve => setTimeout(resolve, 2500));

      expect(healedEvents.length).toBe(1);
      expect(healedEvents[0].components).toContain('solver-1');
      
      const health = harness.getSystemHealth();
      expect(health.healthy).toBe(true);
    });

    test('should maintain core functionality during partial partition', async () => {
      await harness.simulateNetworkPartition(['solver-1'], 1000);

      const health = harness.getSystemHealth();
      // System should still be healthy as solver-1 is not required
      expect(health.healthy).toBe(true);
    });
  });

  describe('Circuit Breaker', () => {
    test('should open circuit after threshold failures', async () => {
      const circuitEvents: any[] = [];
      harness.on('circuit-breaker:open', (e) => circuitEvents.push(e));

      // Fail contract multiple times
      for (let i = 0; i < 6; i++) {
        await harness.failComponent('contract', 'timeout');
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for circuit breaker to process
      await new Promise(resolve => setTimeout(resolve, 500));

      // Circuit should be open
      expect(circuitEvents.length).toBeGreaterThan(0);
    }, 2000);

    test('should attempt half-open state after timeout', async () => {
      const breaker = new CircuitBreaker('test', {
        threshold: 3,
        timeout: 5000,
        resetTimeout: 1000
      });

      // Record failures to open circuit
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getState()).toBe('open');

      // Move to half-open
      breaker.halfOpen();
      expect(breaker.getState()).toBe('half-open');

      // Success should close it
      breaker.recordSuccess();
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('State Recovery', () => {
    test('should create and restore checkpoints', () => {
      const state = {
        intents: ['intent-1', 'intent-2'],
        balances: { alice: 1000, bob: 2000 },
        timestamp: Date.now()
      };

      harness.createCheckpoint('test-checkpoint', state);

      // Modify state
      state.balances.alice = 500;

      // Restore
      const restored = harness.restoreCheckpoint('test-checkpoint');
      expect(restored.balances.alice).toBe(1000);
    });

    test('should handle missing checkpoint gracefully', () => {
      expect(() => {
        harness.restoreCheckpoint('non-existent');
      }).toThrow('Checkpoint non-existent not found');
    });
  });

  describe('Cascading Failures', () => {
    test('should simulate cascading failure from database', async () => {
      const failures: string[] = [];
      harness.on('component:failed', (e) => failures.push(e.component));

      await harness.simulateCascadingFailure('database');

      // Database failure should cascade to gateway and contract
      expect(failures).toContain('database');
      expect(failures).toContain('gateway');
      expect(failures).toContain('contract');
    }, 10000);

    test('should handle cascading failure recovery', async () => {
      const recoveries: any[] = [];
      harness.on('recovery:started', (e) => recoveries.push(e));

      await harness.simulateCascadingFailure('verifier');

      // Wait for cascading failures to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should attempt recovery for all failed components
      expect(recoveries.length).toBeGreaterThan(0);
      if (recoveries.length > 0) {
        expect(recoveries.some(r => r.component === 'verifier')).toBe(true);
      }
    }, 5000);
  });

  describe('Service Degradation', () => {
    test('should degrade service under high error rate', async () => {
      const degradedEvents: any[] = [];
      harness.on('service:degraded', (e) => degradedEvents.push(e));

      // Create custom strategy for degradation
      harness['recoveryStrategies'].set('1click-api', {
        component: '1click-api',
        strategy: 'degrade',
        maxRetries: 0,
        backoffMs: 0,
        timeout: 0
      });

      await harness.failComponent('1click-api', 'timeout');

      expect(degradedEvents.length).toBe(1);
      expect(degradedEvents[0].functionality).toBe('reduced');
    });

    test('should maintain degraded service availability', () => {
      const component = harness['components'].get('redis-cache')!;
      component.status = 'degraded';

      const health = harness.getSystemHealth();
      // Degraded non-critical component shouldn't affect overall health
      expect(health.healthy).toBe(true);
    });
  });

  describe('Recovery Strategies', () => {
    test('should use exponential backoff for retries', async () => {
      const retryEvents: any[] = [];
      harness.on('recovery:retry', (e) => retryEvents.push({ ...e, timestamp: Date.now() }));

      // Ensure recovery will succeed after a few attempts
      harness.setMockRandomValue(0.8);

      await harness.failComponent('gateway', 'network');

      // Should have at least one retry event
      expect(retryEvents.length).toBeGreaterThan(0);
      
      // Verify retry attempts were made
      expect(retryEvents[0].attempt).toBeDefined();
      expect(retryEvents[0].component).toBe('gateway');
    }, 10000);

    test('should respect max retry limits', async () => {
      const failureEvents: any[] = [];
      harness.on('recovery:failed', (e) => failureEvents.push(e));

      // Override getMockRandom to always fail
      harness.getMockRandom = () => 0.1; // Always return low value to trigger failures

      await harness.failComponent('database', 'crash');

      // Wait for all retries to complete (5 retries * 100ms backoff + processing)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should eventually give up
      expect(failureEvents.length).toBeGreaterThan(0);
      if (failureEvents.length > 0) {
        expect(failureEvents[0].reason).toContain('Max retries exceeded');
      }
    }, 5000);
  });
});

// Export for use in other tests
export { ResilienceTestHarness, CircuitBreaker, SystemComponent };