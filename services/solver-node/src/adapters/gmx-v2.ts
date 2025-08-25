import { VenueAdapter, OrderRequest, ExecutionResult } from './base';
import { VenueQuote } from '@deltanear/proto';
import Decimal from 'decimal.js';
import crypto from 'crypto';

export class GMXv2Adapter extends VenueAdapter {
  name = 'gmx-v2';
  private mockPrices: Map<string, number> = new Map([
    ['ETH-USD', 3500],
    ['BTC-USD', 65000],
    ['ARB-USD', 1.2],
    ['SOL-USD', 140],
  ]);

  private pendingOrders: Map<string, any> = new Map();
  private seed: number;

  constructor() {
    super();
    this.seed = parseInt(crypto.randomBytes(4).toString('hex'), 16);
  }

  async quote(order: OrderRequest): Promise<VenueQuote> {
    const basePrice = this.mockPrices.get(order.symbol) || 100;
    const spread = basePrice * 0.0003;
    
    const randomFactor = this.seededRandom(0.995, 1.005);
    const adjustedPrice = basePrice * randomFactor;

    const bid = adjustedPrice - spread;
    const ask = adjustedPrice + spread;
    const mid = adjustedPrice;

    const fundingRate = this.calculateFundingRate(order);
    const openInterest = this.seededRandom(10000000, 50000000);
    const volume24h = this.seededRandom(50000000, 200000000);

    return {
      venue: this.name,
      bid: bid.toFixed(2),
      ask: ask.toFixed(2),
      mid: mid.toFixed(2),
      funding_rate_8h: fundingRate.toFixed(6),
      open_interest: openInterest.toFixed(0),
      volume_24h: volume24h.toFixed(0),
    };
  }

  async execute(order: OrderRequest, deadline: number): Promise<ExecutionResult> {
    await this.simulateLatency(50, 200);

    if (Date.now() > deadline) {
      throw new Error('Execution deadline exceeded');
    }

    const orderId = this.generateOrderId();
    const basePrice = this.mockPrices.get(order.symbol) || 100;
    
    const slippage = this.calculateSlippage(order);
    let fillPrice: number;
    
    if (order.side === 'long' || order.side === 'buy') {
      fillPrice = basePrice * (1 + slippage);
    } else {
      fillPrice = basePrice * (1 - slippage);
    }

    const size = new Decimal(order.size);
    const notional = size.mul(fillPrice);

    const execution: ExecutionResult = {
      order_id: orderId,
      fill_price: fillPrice.toFixed(2),
      filled_size: order.size,
      notional: notional.toFixed(2),
      timestamp: Date.now(),
      status: 'filled',
    };

    this.pendingOrders.set(orderId, {
      ...order,
      execution,
      entry_price: fillPrice,
    });

    return execution;
  }

  async settle(orderId: string, pnlDelta: string, fees: string): Promise<void> {
    const order = this.pendingOrders.get(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    await this.simulateLatency(100, 300);

    this.pendingOrders.delete(orderId);
  }

  private calculateFundingRate(order: OrderRequest): number {
    const baseFunding = 0.0001;
    const leverageFactor = order.leverage ? parseFloat(order.leverage) * 0.00002 : 0;
    const sizeFactor = parseFloat(order.size) * 0.000001;
    
    const jitter = this.seededRandom(-0.00005, 0.00005);
    
    return Math.max(0, baseFunding + leverageFactor + sizeFactor + jitter);
  }

  private calculateSlippage(order: OrderRequest): number {
    const baseSlippage = 0.0003;
    const sizeImpact = parseFloat(order.size) * 0.00001;
    const leverageImpact = order.leverage ? parseFloat(order.leverage) * 0.00002 : 0;
    
    const randomImpact = this.seededRandom(0, 0.0002);
    
    return baseSlippage + sizeImpact + leverageImpact + randomImpact;
  }

  private seededRandom(min: number, max: number): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    const rnd = this.seed / 233280;
    return min + rnd * (max - min);
  }

  private async simulateLatency(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs) + minMs);
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}