import { VenueAdapter, OrderRequest, ExecutionResult } from './base';
import { VenueQuote } from '@deltanear/proto';
import Decimal from 'decimal.js';
import crypto from 'crypto';

export class LyraV2Adapter extends VenueAdapter {
  name = 'lyra-v2';
  private mockPrices: Map<string, number> = new Map([
    ['ETH-USD', 3500],
    ['BTC-USD', 65000],
    ['ARB-USD', 1.2],
    ['SOL-USD', 140],
  ]);

  private impliedVolatility: Map<string, number> = new Map([
    ['ETH-USD', 0.65],
    ['BTC-USD', 0.55],
    ['ARB-USD', 0.85],
    ['SOL-USD', 0.75],
  ]);

  private pendingOrders: Map<string, any> = new Map();
  private seed: number;

  constructor() {
    super();
    this.seed = parseInt(crypto.randomBytes(4).toString('hex'), 16);
  }

  async quote(order: OrderRequest): Promise<VenueQuote> {
    const basePrice = this.mockPrices.get(order.symbol) || 100;
    
    if (order.instrument === 'option' && order.option) {
      return this.quoteOption(order, basePrice);
    } else {
      return this.quotePerp(order, basePrice);
    }
  }

  private async quoteOption(order: OrderRequest, spotPrice: number): Promise<VenueQuote> {
    const { option } = order;
    if (!option) throw new Error('Option details required');

    const strike = parseFloat(option.strike);
    const iv = this.impliedVolatility.get(order.symbol) || 0.6;
    const timeToExpiry = this.calculateTimeToExpiry(option.expiry);
    
    const optionPrice = this.blackScholes(
      spotPrice,
      strike,
      timeToExpiry,
      0.05,
      iv,
      option.kind
    );

    const greeks = this.calculateGreeks(
      spotPrice,
      strike,
      timeToExpiry,
      0.05,
      iv,
      option.kind
    );

    // Ensure minimum spread for very small prices
    const spread = Math.max(0.01, optionPrice * 0.02);
    const bid = Math.max(0.01, optionPrice - spread);
    const ask = optionPrice + spread;

    return {
      venue: this.name,
      bid: bid.toFixed(2),
      ask: ask.toFixed(2),
      mid: optionPrice.toFixed(2),
      iv: iv.toFixed(4),
      delta: greeks.delta.toFixed(4),
      gamma: greeks.gamma.toFixed(6),
      theta: greeks.theta.toFixed(4),
      vega: greeks.vega.toFixed(4),
      open_interest: this.seededRandom(1000, 10000).toFixed(0),
      volume_24h: this.seededRandom(5000, 50000).toFixed(0),
    };
  }

  private async quotePerp(order: OrderRequest, basePrice: number): Promise<VenueQuote> {
    const spread = basePrice * 0.0004;
    const randomFactor = this.seededRandom(0.994, 1.006);
    const adjustedPrice = basePrice * randomFactor;

    return {
      venue: this.name,
      bid: (adjustedPrice - spread).toFixed(2),
      ask: (adjustedPrice + spread).toFixed(2),
      mid: adjustedPrice.toFixed(2),
      funding_rate_8h: this.seededRandom(-0.0003, 0.0003).toFixed(6),
      open_interest: this.seededRandom(5000000, 25000000).toFixed(0),
      volume_24h: this.seededRandom(25000000, 100000000).toFixed(0),
    };
  }

  async execute(order: OrderRequest, deadline: number): Promise<ExecutionResult> {
    await this.simulateLatency(75, 250);

    if (Date.now() > deadline) {
      throw new Error('Execution deadline exceeded');
    }

    const orderId = this.generateOrderId();
    const basePrice = this.mockPrices.get(order.symbol) || 100;
    
    let fillPrice: number;
    
    if (order.instrument === 'option' && order.option) {
      const strike = parseFloat(order.option.strike);
      const iv = this.impliedVolatility.get(order.symbol) || 0.6;
      const timeToExpiry = this.calculateTimeToExpiry(order.option.expiry);
      
      fillPrice = this.blackScholes(
        basePrice,
        strike,
        timeToExpiry,
        0.05,
        iv,
        order.option.kind
      );
      
      const slippage = this.calculateOptionSlippage(order);
      // For very small prices, use additive slippage instead of multiplicative
      if (fillPrice < 1) {
        fillPrice = order.side === 'buy' 
          ? fillPrice + (slippage * 10)  // Add slippage directly for small prices
          : Math.max(0.01, fillPrice - (slippage * 10));
      } else {
        fillPrice *= (order.side === 'buy' ? (1 + slippage) : (1 - slippage));
      }
    } else {
      const slippage = this.calculatePerpSlippage(order);
      fillPrice = basePrice * (order.side === 'long' || order.side === 'buy' 
        ? (1 + slippage) 
        : (1 - slippage));
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

    await this.simulateLatency(150, 400);
    this.pendingOrders.delete(orderId);
  }

  private blackScholes(
    S: number,
    K: number, 
    T: number,
    r: number,
    sigma: number,
    type: 'call' | 'put'
  ): number {
    // Handle edge cases
    if (T <= 0) T = 0.001; // Minimum time to expiry
    if (sigma <= 0) sigma = 0.01; // Minimum volatility
    if (S <= 0 || K <= 0) return 0;
    
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    
    let price: number;
    if (type === 'call') {
      price = S * this.normalCDF(d1) - K * Math.exp(-r * T) * this.normalCDF(d2);
    } else {
      price = K * Math.exp(-r * T) * this.normalCDF(-d2) - S * this.normalCDF(-d1);
    }
    
    // Ensure price is positive and reasonable
    return Math.max(0.01, Math.min(price, S));
  }

  private calculateGreeks(
    S: number,
    K: number,
    T: number,
    r: number,
    sigma: number,
    type: 'call' | 'put'
  ) {
    // Handle edge cases
    if (T <= 0) T = 0.001;
    if (sigma <= 0) sigma = 0.01;
    if (S <= 0 || K <= 0) {
      return { delta: 0, gamma: 0, theta: 0, vega: 0 };
    }
    
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    
    const delta = type === 'call' ? this.normalCDF(d1) : this.normalCDF(d1) - 1;
    const gamma = this.normalPDF(d1) / (S * sigma * Math.sqrt(T));
    const theta = type === 'call'
      ? -(S * this.normalPDF(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * this.normalCDF(d2)
      : -(S * this.normalPDF(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * this.normalCDF(-d2);
    const vega = S * this.normalPDF(d1) * Math.sqrt(T);

    return { delta, gamma, theta: theta / 365, vega: vega / 100 };
  }

  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2.0);
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return 0.5 * (1.0 + sign * y);
  }

  private normalPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  private calculateTimeToExpiry(expiry: string): number {
    const expiryDate = new Date(expiry);
    const now = new Date();
    const msPerYear = 365 * 24 * 60 * 60 * 1000;
    return Math.max(0.001, (expiryDate.getTime() - now.getTime()) / msPerYear);
  }

  private calculateOptionSlippage(order: OrderRequest): number {
    const baseSlippage = 0.01;
    const size = parseFloat(order.size);
    // More aggressive size impact for options
    const sizeImpact = size > 10 ? (size - 10) * 0.002 : size * 0.001;
    return baseSlippage + sizeImpact + this.seededRandom(0, 0.005);
  }

  private calculatePerpSlippage(order: OrderRequest): number {
    const baseSlippage = 0.0004;
    const sizeImpact = parseFloat(order.size) * 0.00001;
    const leverageImpact = order.leverage ? parseFloat(order.leverage) * 0.00003 : 0;
    return baseSlippage + sizeImpact + leverageImpact + this.seededRandom(0, 0.0003);
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