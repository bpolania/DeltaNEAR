/**
 * 1Click API Client for DeltaNEAR
 * 
 * Handles real integration with the production 1Click API at https://1click.chaindefuser.com
 * This client manages intent submission, metadata preservation, and solver routing.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';

interface OneClickConfig {
  apiUrl: string;
  apiKey?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

interface DerivativesIntent {
  version: string;
  intent_type: string;
  derivatives: any;
  signer_id: string;
  deadline: string;
  nonce: string;
  metadata?: any;
}

interface OneClickSubmitRequest {
  intent: DerivativesIntent;
  metadata_checksum: string;
  solver_preferences?: string[];
  exclusivity_window_ms?: number;
}

interface OneClickSubmitResponse {
  intent_id: string;
  status: 'submitted' | 'rejected' | 'pending';
  metadata_checksum_received: string;
  solver_assigned?: string;
  estimated_execution_ms?: number;
  rejection_reason?: string;
}

interface OneClickStatusResponse {
  intent_id: string;
  status: 'pending' | 'simulated' | 'executed' | 'failed' | 'expired';
  solver_id?: string;
  execution_receipt?: any;
  metadata_checksum?: string;
  events?: any[];
}

export class OneClickClient extends EventEmitter {
  private client: AxiosInstance;
  private config: OneClickConfig;
  private intentCache: Map<string, { intent: DerivativesIntent; checksum: string }> = new Map();

  constructor(config: OneClickConfig) {
    super();
    this.config = {
      ...config,
      apiUrl: config.apiUrl || 'https://1click.chaindefuser.com',
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000
    };

    this.client = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DeltaNEAR-Solver/1.0.0',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {})
      }
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[1Click] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[1Click] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[1Click] Response: ${response.status} ${response.statusText}`);
        return response;
      },
      async (error: AxiosError) => {
        if (error.response) {
          console.error(`[1Click] Error: ${error.response.status} ${error.response.statusText}`);
          console.error('[1Click] Error data:', error.response.data);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Submit a derivatives intent to 1Click
   */
  async submitIntent(request: OneClickSubmitRequest): Promise<OneClickSubmitResponse> {
    const intentHash = this.computeIntentHash(request.intent);
    
    // Store intent and checksum for later verification
    this.intentCache.set(intentHash, {
      intent: request.intent,
      checksum: request.metadata_checksum
    });

    // Emit pre-submission audit event
    this.emit('metadata_audit', {
      intent_hash: intentHash,
      stage: 'pre_1click',
      checksum: request.metadata_checksum,
      preserved: true
    });

    try {
      const response = await this.retryRequest(async () => {
        return await this.client.post<OneClickSubmitResponse>('/v1/intents', request);
      });

      // Verify metadata checksum was received correctly
      if (response.data.metadata_checksum_received !== request.metadata_checksum) {
        console.error('[1Click] Metadata checksum mismatch!');
        console.error(`  Sent: ${request.metadata_checksum}`);
        console.error(`  Received: ${response.data.metadata_checksum_received}`);
        
        this.emit('metadata_audit', {
          intent_hash: intentHash,
          stage: 'solver_received',
          checksum: response.data.metadata_checksum_received,
          preserved: false,
          original_checksum: request.metadata_checksum
        });
      } else {
        this.emit('metadata_audit', {
          intent_hash: intentHash,
          stage: 'solver_received',
          checksum: response.data.metadata_checksum_received,
          preserved: true,
          original_checksum: request.metadata_checksum
        });
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        // Handle specific 1Click API errors
        const errorData = error.response.data as any;
        throw new Error(`1Click API error: ${errorData.message || error.response.statusText}`);
      }
      throw error;
    }
  }

  /**
   * Get status of a submitted intent
   */
  async getIntentStatus(intentId: string): Promise<OneClickStatusResponse> {
    try {
      const response = await this.retryRequest(async () => {
        return await this.client.get<OneClickStatusResponse>(`/v1/intents/${intentId}`);
      });

      // If executed, verify metadata preservation
      if (response.data.status === 'executed' && response.data.metadata_checksum) {
        const intentHash = this.findIntentHashById(intentId);
        if (intentHash) {
          const cached = this.intentCache.get(intentHash);
          if (cached) {
            this.emit('metadata_audit', {
              intent_hash: intentHash,
              stage: 'post_execution',
              checksum: response.data.metadata_checksum,
              preserved: response.data.metadata_checksum === cached.checksum,
              original_checksum: cached.checksum
            });
          }
        }
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`Intent ${intentId} not found`);
      }
      throw error;
    }
  }

  /**
   * Wait for intent execution with polling
   */
  async waitForExecution(
    intentId: string,
    options: { timeout?: number; pollInterval?: number } = {}
  ): Promise<OneClickStatusResponse> {
    const timeout = options.timeout || 60000;
    const pollInterval = options.pollInterval || 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getIntentStatus(intentId);
      
      if (['executed', 'failed', 'expired'].includes(status.status)) {
        return status;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout waiting for intent ${intentId} execution`);
  }

  /**
   * Compute deterministic hash of intent
   */
  private computeIntentHash(intent: DerivativesIntent): string {
    const canonical = this.canonicalizeIntent(intent);
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Canonicalize intent using RFC 8785
   */
  private canonicalizeIntent(intent: any): string {
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
   * Find intent hash by intent ID
   */
  private findIntentHashById(intentId: string): string | undefined {
    // In production, this would query a database
    // For now, we'll emit an event to track this
    for (const [hash, cached] of this.intentCache.entries()) {
      // This is a simplified lookup - in production would use proper mapping
      if (hash.startsWith(intentId.slice(0, 8))) {
        return hash;
      }
    }
    return undefined;
  }

  /**
   * Retry request with exponential backoff
   */
  private async retryRequest<T>(
    fn: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= (this.config.retryAttempts || 3)) {
        throw error;
      }

      const delay = (this.config.retryDelay || 1000) * Math.pow(2, attempt - 1);
      console.log(`[1Click] Retrying request (attempt ${attempt + 1}) after ${delay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retryRequest(fn, attempt + 1);
    }
  }

  /**
   * Health check for 1Click API
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      console.error('[1Click] Health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance for production use
export const oneClickClient = new OneClickClient({
  apiUrl: process.env.ONE_CLICK_API || 'https://1click.chaindefuser.com',
  apiKey: process.env.ONE_CLICK_API_KEY,
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000
});