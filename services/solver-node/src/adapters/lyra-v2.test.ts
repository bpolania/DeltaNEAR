import { LyraV2Adapter } from './lyra-v2';
import { OrderRequest } from './base';

describe('Lyra-v2 Adapter', () => {
  let adapter: LyraV2Adapter;

  beforeEach(() => {
    adapter = new LyraV2Adapter();
  });

  describe('option quote', () => {
    it('should generate quote for call option', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '10',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const quote = await adapter.quote(order);

      expect(quote.venue).toBe('lyra-v2');
      expect(quote.bid).toBeDefined();
      expect(quote.ask).toBeDefined();
      expect(quote.mid).toBeDefined();
      expect(parseFloat(quote.bid!)).toBeLessThan(parseFloat(quote.ask!));
      
      expect(quote.iv).toBeDefined();
      expect(parseFloat(quote.iv!)).toBeGreaterThan(0);
      expect(parseFloat(quote.iv!)).toBeLessThan(2);
      
      expect(quote.delta).toBeDefined();
      expect(quote.gamma).toBeDefined();
      expect(quote.theta).toBeDefined();
      expect(quote.vega).toBeDefined();
    });

    it('should generate quote for put option', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'BTC-USD',
        side: 'sell',
        size: '5',
        option: {
          kind: 'put',
          strike: '60000',
          expiry: '2024-06-30T00:00:00Z',
        },
      };

      const quote = await adapter.quote(order);

      expect(quote.venue).toBe('lyra-v2');
      expect(quote.delta).toBeDefined();
      expect(parseFloat(quote.delta!)).toBeLessThanOrEqual(0);
    });

    it('should price ITM call correctly', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '3000',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const quote = await adapter.quote(order);
      const spotPrice = 3500;
      const intrinsicValue = spotPrice - 3000;
      const optionPrice = parseFloat(quote.mid!);

      expect(optionPrice).toBeGreaterThan(intrinsicValue);
    });

    it('should price OTM put correctly', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'put',
          strike: '3000',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const quote = await adapter.quote(order);
      const optionPrice = parseFloat(quote.mid!);

      expect(optionPrice).toBeGreaterThan(0);
      expect(optionPrice).toBeLessThan(500);
    });
  });

  describe('perpetual quote', () => {
    it('should generate quote for perpetual', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'SOL-USD',
        side: 'long',
        size: '10',
        leverage: '3',
      };

      const quote = await adapter.quote(order);

      expect(quote.venue).toBe('lyra-v2');
      expect(quote.funding_rate_8h).toBeDefined();
      expect(quote.open_interest).toBeDefined();
      expect(quote.volume_24h).toBeDefined();
      
      expect(quote.iv).toBeUndefined();
      expect(quote.delta).toBeUndefined();
    });
  });

  describe('option execution', () => {
    it('should execute option buy order', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '5',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const deadline = Date.now() + 10000;
      const result = await adapter.execute(order, deadline);

      expect(result.status).toBe('filled');
      expect(result.order_id).toMatch(/^lyra-v2-/);
      expect(parseFloat(result.fill_price)).toBeGreaterThan(0);
      expect(result.filled_size).toBe('5');
    });

    it('should apply option slippage', async () => {
      const smallOrder: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const largeOrder: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '100',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const deadline = Date.now() + 10000;
      
      const smallResult = await adapter.execute(smallOrder, deadline);
      const largeResult = await adapter.execute(largeOrder, deadline);

      const smallPrice = parseFloat(smallResult.fill_price);
      const largePrice = parseFloat(largeResult.fill_price);

      expect(largePrice).toBeGreaterThan(smallPrice);
    });
  });

  describe('Black-Scholes implementation', () => {
    it('should calculate call option price correctly', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '3500',
          expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      };

      const quote = await adapter.quote(order);
      const optionPrice = parseFloat(quote.mid!);

      expect(optionPrice).toBeGreaterThan(100);
      expect(optionPrice).toBeLessThan(1000);
    });

    it('should calculate put option price correctly', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'put',
          strike: '3500',
          expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      };

      const quote = await adapter.quote(order);
      const optionPrice = parseFloat(quote.mid!);

      expect(optionPrice).toBeGreaterThan(50);
      expect(optionPrice).toBeLessThan(1000); // ATM put with 1yr expiry can be expensive
    });

    it('should handle near-expiry options', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '3500',
          expiry: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
      };

      const quote = await adapter.quote(order);
      const optionPrice = parseFloat(quote.mid!);
      const theta = parseFloat(quote.theta!);

      expect(optionPrice).toBeGreaterThan(0);
      expect(Math.abs(theta)).toBeGreaterThan(0);
    });
  });

  describe('Greeks calculation', () => {
    it('should calculate delta correctly', async () => {
      const callOrder: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '3500',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const putOrder: OrderRequest = {
        ...callOrder,
        option: {
          ...callOrder.option!,
          kind: 'put',
        },
      };

      const callQuote = await adapter.quote(callOrder);
      const putQuote = await adapter.quote(putOrder);

      const callDelta = parseFloat(callQuote.delta!);
      const putDelta = parseFloat(putQuote.delta!);

      expect(callDelta).toBeGreaterThan(0);
      expect(callDelta).toBeLessThanOrEqual(1);
      expect(putDelta).toBeLessThan(0);
      expect(putDelta).toBeGreaterThanOrEqual(-1);
    });

    it('should calculate gamma correctly', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '3500',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const quote = await adapter.quote(order);
      const gamma = parseFloat(quote.gamma!);

      expect(gamma).toBeGreaterThanOrEqual(0);
      expect(gamma).toBeLessThan(0.01);
    });

    it('should calculate vega correctly', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '3500',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const quote = await adapter.quote(order);
      const vega = parseFloat(quote.vega!);

      expect(vega).toBeGreaterThan(0);
      expect(vega).toBeLessThan(100);
    });

    it('should calculate theta correctly', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '1',
        option: {
          kind: 'call',
          strike: '3500',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const quote = await adapter.quote(order);
      const theta = parseFloat(quote.theta!);

      expect(theta).toBeLessThan(0);
      expect(Math.abs(theta)).toBeLessThan(50); // Daily theta can be high for ATM options
    });
  });

  describe('settle', () => {
    it('should settle option order', async () => {
      const order: OrderRequest = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '5',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
      };

      const deadline = Date.now() + 10000;
      const result = await adapter.execute(order, deadline);

      await expect(
        adapter.settle(result.order_id, '500', '10')
      ).resolves.not.toThrow();
    });
  });
});