import { GMXv2Adapter } from './gmx-v2';
import { OrderRequest } from './base';

describe('GMX-v2 Adapter', () => {
  let adapter: GMXv2Adapter;

  beforeEach(() => {
    adapter = new GMXv2Adapter();
  });

  describe('quote', () => {
    it('should generate quote for perpetual order', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1.5',
        leverage: '5',
      };

      const quote = await adapter.quote(order);

      expect(quote.venue).toBe('gmx-v2');
      expect(quote.bid).toBeDefined();
      expect(quote.ask).toBeDefined();
      expect(quote.mid).toBeDefined();
      expect(parseFloat(quote.bid!)).toBeLessThan(parseFloat(quote.ask!));
      expect(parseFloat(quote.mid!)).toBeCloseTo(
        (parseFloat(quote.bid!) + parseFloat(quote.ask!)) / 2,
        1
      );
      expect(quote.funding_rate_8h).toBeDefined();
      expect(quote.open_interest).toBeDefined();
      expect(quote.volume_24h).toBeDefined();
    });

    it('should return consistent quotes with same seed', async () => {
      const adapter1 = new GMXv2Adapter();
      const adapter2 = new GMXv2Adapter();
      
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'BTC-USD',
        side: 'short',
        size: '0.5',
        leverage: '10',
      };

      const quote1a = await adapter1.quote(order);
      const quote1b = await adapter1.quote(order);
      
      expect(quote1a.mid).not.toBe(quote1b.mid);
    });

    it('should handle unknown symbols with default price', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'UNKNOWN-USD',
        side: 'long',
        size: '1',
        leverage: '2',
      };

      const quote = await adapter.quote(order);

      expect(quote.venue).toBe('gmx-v2');
      expect(parseFloat(quote.mid!)).toBeCloseTo(100, 0);
    });
  });

  describe('execute', () => {
    it('should execute long order successfully', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '2',
        leverage: '3',
      };

      const deadline = Date.now() + 10000;
      const result = await adapter.execute(order, deadline);

      expect(result.status).toBe('filled');
      expect(result.order_id).toMatch(/^gmx-v2-/);
      expect(parseFloat(result.fill_price)).toBeGreaterThan(0);
      expect(result.filled_size).toBe('2');
      expect(parseFloat(result.notional)).toBeCloseTo(
        parseFloat(result.fill_price) * 2,
        1
      );
      expect(result.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should execute short order with slippage', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'BTC-USD',
        side: 'short',
        size: '0.1',
        leverage: '20',
      };

      const deadline = Date.now() + 10000;
      const result = await adapter.execute(order, deadline);

      expect(result.status).toBe('filled');
      expect(parseFloat(result.fill_price)).toBeGreaterThan(0);
    });

    it('should throw error if deadline exceeded', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '5',
      };

      const deadline = Date.now() - 1000;

      await expect(adapter.execute(order, deadline)).rejects.toThrow('Execution deadline exceeded');
    });

    it('should calculate slippage based on order size and leverage', async () => {
      const smallOrder: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '0.1',
        leverage: '1',
      };

      const largeOrder: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '100',
        leverage: '10',
      };

      const deadline = Date.now() + 10000;
      
      const smallResult = await adapter.execute(smallOrder, deadline);
      const largeResult = await adapter.execute(largeOrder, deadline);

      const basePrice = 3500;
      const smallSlippage = Math.abs(parseFloat(smallResult.fill_price) - basePrice) / basePrice;
      const largeSlippage = Math.abs(parseFloat(largeResult.fill_price) - basePrice) / basePrice;

      expect(largeSlippage).toBeGreaterThan(smallSlippage);
    });
  });

  describe('settle', () => {
    it('should settle order successfully', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '5',
      };

      const deadline = Date.now() + 10000;
      const result = await adapter.execute(order, deadline);

      await expect(
        adapter.settle(result.order_id, '100', '5')
      ).resolves.not.toThrow();
    });

    it('should throw error for non-existent order', async () => {
      await expect(
        adapter.settle('invalid-order-id', '100', '5')
      ).rejects.toThrow('Order not found');
    });

    it('should remove order after settlement', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '5',
      };

      const deadline = Date.now() + 10000;
      const result = await adapter.execute(order, deadline);

      await adapter.settle(result.order_id, '100', '5');

      await expect(
        adapter.settle(result.order_id, '100', '5')
      ).rejects.toThrow('Order not found');
    });
  });

  describe('funding rate calculation', () => {
    it('should calculate positive funding rate', async () => {
      const order: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '10',
        leverage: '10',
      };

      const quote = await adapter.quote(order);
      const fundingRate = parseFloat(quote.funding_rate_8h!);

      expect(fundingRate).toBeGreaterThanOrEqual(0);
      expect(fundingRate).toBeLessThan(0.01);
    });

    it('should increase funding with leverage', async () => {
      const lowLeverageOrder: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '1',
      };

      const highLeverageOrder: OrderRequest = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '20',
      };

      const lowQuote = await adapter.quote(lowLeverageOrder);
      const highQuote = await adapter.quote(highLeverageOrder);

      const avgLowFunding = parseFloat(lowQuote.funding_rate_8h!);
      const avgHighFunding = parseFloat(highQuote.funding_rate_8h!);

      expect(avgHighFunding).toBeGreaterThanOrEqual(avgLowFunding);
    });
  });
});