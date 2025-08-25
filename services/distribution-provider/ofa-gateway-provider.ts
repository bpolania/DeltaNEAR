/**
 * OFA Gateway Distribution Provider
 * 
 * Implements DistributionProvider using our custom OFA gateway
 * This is the current implementation that can be swapped out later
 */

import { DistributionProvider, IntentQuote, IntentStatus, ProviderConfig } from './interface';
import { DerivativesIntent, QuoteResponse, SignedIntent } from '@deltanear/proto';
import axios from 'axios';
import WebSocket from 'ws';

export class OFAGatewayProvider implements DistributionProvider {
  private httpClient;
  private wsConnection?: WebSocket;
  private subscriptions = new Map<string, Set<(status: IntentStatus) => void>>();

  constructor(private config: ProviderConfig) {
    this.httpClient = axios.create({
      baseURL: config.endpoint,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
      }
    });

    if (config.wsEndpoint) {
      this.connectWebSocket();
    }
  }

  private connectWebSocket() {
    if (!this.config.wsEndpoint) return;

    this.wsConnection = new WebSocket(this.config.wsEndpoint);
    
    this.wsConnection.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'status_update' && message.intent_hash) {
          const callbacks = this.subscriptions.get(message.intent_hash);
          if (callbacks) {
            callbacks.forEach(cb => cb(message.status));
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    this.wsConnection.on('error', (error) => {
      console.error('WebSocket error:', error);
      // Implement reconnection logic
      setTimeout(() => this.connectWebSocket(), 5000);
    });
  }

  async publishIntent(intent: SignedIntent): Promise<{ intent_hash: string }> {
    const response = await this.httpClient.post('/intents', intent);
    return response.data;
  }

  async requestQuotes(intent_hash: string): Promise<void> {
    await this.httpClient.post('/quotes', { intent_hash });
  }

  async getQuotes(intent_hash: string): Promise<IntentQuote[]> {
    const response = await this.httpClient.get(`/quotes/${intent_hash}`);
    return response.data.quotes || [];
  }

  async acceptQuote(intent_hash: string, solver_id: string): Promise<void> {
    await this.httpClient.post('/accept', { intent_hash, solver_id });
  }

  async getStatus(intent_hash: string): Promise<IntentStatus> {
    const response = await this.httpClient.get(`/status/${intent_hash}`);
    return response.data;
  }

  subscribeToUpdates(intent_hash: string, callback: (status: IntentStatus) => void): () => void {
    if (!this.subscriptions.has(intent_hash)) {
      this.subscriptions.set(intent_hash, new Set());
    }
    
    this.subscriptions.get(intent_hash)!.add(callback);

    // Send subscription message if WebSocket is connected
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify({
        type: 'subscribe',
        intent_hash
      }));
    }

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(intent_hash);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(intent_hash);
          // Send unsubscribe message
          if (this.wsConnection?.readyState === WebSocket.OPEN) {
            this.wsConnection.send(JSON.stringify({
              type: 'unsubscribe',
              intent_hash
            }));
          }
        }
      }
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  disconnect() {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = undefined;
    }
    this.subscriptions.clear();
  }
}