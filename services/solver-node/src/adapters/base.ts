import { VenueQuote } from '@deltanear/proto';

export interface OrderRequest {
  instrument: 'perp' | 'option';
  symbol: string;
  side: 'long' | 'short' | 'buy' | 'sell';
  size: string;
  leverage?: string;
  option?: {
    kind: 'call' | 'put';
    strike: string;
    expiry: string;
  };
}

export interface ExecutionResult {
  order_id: string;
  fill_price: string;
  filled_size: string;
  notional: string;
  timestamp: number;
  status: 'filled' | 'partial' | 'rejected';
}

export abstract class VenueAdapter {
  abstract name: string;

  abstract quote(order: OrderRequest): Promise<VenueQuote>;
  
  abstract execute(order: OrderRequest, deadline: number): Promise<ExecutionResult>;
  
  abstract settle(orderId: string, pnlDelta: string, fees: string): Promise<void>;

  protected generateOrderId(): string {
    return `${this.name}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}