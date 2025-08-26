import Decimal from 'decimal.js';
import { RiskManager } from './risk-manager';
import { DerivativeAction, VenueQuote } from '@deltanear/proto';

describe('RiskManager', () => {
  let riskManager: RiskManager;

  beforeEach(() => {
    riskManager = new RiskManager('1000000');
  });

  describe('Perpetual Risk Checks', () => {
    it('should allow perp within exposure limits', () => {
      const action: DerivativeAction = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '10',
        leverage: '5',
        constraints: {
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'arbitrum',
        },
      };

      const quote: VenueQuote = {
        venue: 'gmx-v2',
        mid: '3500',
        funding_rate_8h: '0.001',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('10')
      );

      expect(result.allowed).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(result.metrics!.current_exposure).toBe('0');
      expect(result.metrics!.max_exposure).toBe('1000000');
      expect(result.metrics!.margin_requirement).toBeDefined();
      expect(result.metrics!.liquidation_price).toBeDefined();
    });

    it('should reject perp exceeding exposure limits', () => {
      const action: DerivativeAction = {
        instrument: 'perp',
        symbol: 'BTC-USD',
        side: 'long',
        size: '100',
        leverage: '10',
        constraints: {
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'arbitrum',
        },
      };

      const quote: VenueQuote = {
        venue: 'gmx-v2',
        mid: '65000',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('100')
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Exceeds maximum exposure');
    });

    it('should reject high funding rate', () => {
      const action: DerivativeAction = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '10',
        leverage: '5',
        constraints: {
          max_slippage_bps: 10,
          max_funding_bps_8h: 10,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'arbitrum',
        },
      };

      const quote: VenueQuote = {
        venue: 'gmx-v2',
        mid: '3500',
        funding_rate_8h: '0.002',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('10')
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Funding rate exceeds maximum');
    });

    it('should calculate liquidation price for long', () => {
      const action: DerivativeAction = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '10',
        constraints: {
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'arbitrum',
        },
      };

      const quote: VenueQuote = {
        venue: 'gmx-v2',
        mid: '3500',
        funding_rate_8h: '0.001',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('1')
      );

      expect(result.allowed).toBe(true);
      const liquidationPrice = parseFloat(result.metrics!.liquidation_price!);
      expect(liquidationPrice).toBeLessThan(3500);
      expect(liquidationPrice).toBeGreaterThan(3100);
    });

    it('should calculate liquidation price for short', () => {
      const action: DerivativeAction = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'short',
        size: '1',
        leverage: '10',
        constraints: {
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'arbitrum',
        },
      };

      const quote: VenueQuote = {
        venue: 'gmx-v2',
        mid: '3500',
        funding_rate_8h: '0.001',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('1')
      );

      expect(result.allowed).toBe(true);
      const liquidationPrice = parseFloat(result.metrics!.liquidation_price!);
      expect(liquidationPrice).toBeGreaterThan(3500);
      expect(liquidationPrice).toBeLessThan(3900);
    });
  });

  describe('Option Risk Checks', () => {
    it('should allow option within exposure limits', () => {
      const action: DerivativeAction = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '10',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
        constraints: {
          max_slippage_bps: 50,
          max_funding_bps_8h: 0,
          max_fee_bps: 10,
          venue_allowlist: ['lyra-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'base',
        },
      };

      const quote: VenueQuote = {
        venue: 'lyra-v2',
        mid: '150',
        iv: '0.65',
        delta: '0.45',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('10')
      );

      expect(result.allowed).toBe(true);
      expect(result.metrics).toBeDefined();
    });

    it('should reject option exceeding exposure', () => {
      const action: DerivativeAction = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '10000',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
        constraints: {
          max_slippage_bps: 50,
          max_funding_bps_8h: 0,
          max_fee_bps: 10,
          venue_allowlist: ['lyra-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'base',
        },
      };

      const quote: VenueQuote = {
        venue: 'lyra-v2',
        mid: '150',
        iv: '0.65',
        delta: '0.45',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('10000')
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Exceeds maximum exposure');
    });

    it('should reject high implied volatility', () => {
      const action: DerivativeAction = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '10',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
        constraints: {
          max_slippage_bps: 50,
          max_funding_bps_8h: 0,
          max_fee_bps: 10,
          venue_allowlist: ['lyra-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'base',
        },
      };

      const quote: VenueQuote = {
        venue: 'lyra-v2',
        mid: '150',
        iv: '2.5',
        delta: '0.45',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('10')
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Implied volatility too high');
    });

    it('should check delta exposure limits', () => {
      const riskManager = new RiskManager('1000000');
      
      riskManager.updatePosition('ETH-1', {
        symbol: 'ETH-USD',
        side: 'buy',
        notional: new Decimal('10000'),
        entryPrice: new Decimal('3500'),
        delta: new Decimal('50'),
      });

      const action: DerivativeAction = {
        instrument: 'option',
        symbol: 'ETH-USD',
        side: 'buy',
        size: '100',
        option: {
          kind: 'call',
          strike: '4000',
          expiry: '2024-12-31T00:00:00Z',
        },
        constraints: {
          max_slippage_bps: 50,
          max_funding_bps_8h: 0,
          max_fee_bps: 10,
          venue_allowlist: ['lyra-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'base',
        },
      };

      const quote: VenueQuote = {
        venue: 'lyra-v2',
        mid: '150',
        iv: '0.65',
        delta: '51',  // This will push total delta over 100
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('100')
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Delta exposure limit exceeded');
    });
  });

  describe('Position Management', () => {
    it('should update positions correctly', () => {
      const position = {
        symbol: 'ETH-USD',
        side: 'long',
        notional: new Decimal('35000'),
        entryPrice: new Decimal('3500'),
        leverage: new Decimal('5'),
      };

      riskManager.updatePosition('pos-1', position);
      
      const metrics = riskManager.getMetrics();
      expect(metrics.current_exposure).toBe('35000');
      expect(metrics.position_count).toBe(1);
    });

    it('should remove positions correctly', () => {
      const position = {
        symbol: 'ETH-USD',
        side: 'long',
        notional: new Decimal('35000'),
        entryPrice: new Decimal('3500'),
      };

      riskManager.updatePosition('pos-1', position);
      riskManager.removePosition('pos-1');
      
      const metrics = riskManager.getMetrics();
      expect(metrics.current_exposure).toBe('0');
      expect(metrics.position_count).toBe(0);
    });

    it('should recalculate exposure on position changes', () => {
      const position1 = {
        symbol: 'ETH-USD',
        side: 'long',
        notional: new Decimal('10000'),
        entryPrice: new Decimal('3500'),
      };

      const position2 = {
        symbol: 'BTC-USD',
        side: 'short',
        notional: new Decimal('20000'),
        entryPrice: new Decimal('65000'),
      };

      riskManager.updatePosition('pos-1', position1);
      riskManager.updatePosition('pos-2', position2);
      
      const metrics = riskManager.getMetrics();
      expect(metrics.current_exposure).toBe('30000');
      expect(metrics.position_count).toBe(2);
    });
  });

  describe('Risk Metrics', () => {
    it('should calculate VaR correctly', () => {
      const position = {
        symbol: 'ETH-USD',
        side: 'long',
        notional: new Decimal('100000'),
        entryPrice: new Decimal('3500'),
      };

      riskManager.updatePosition('pos-1', position);
      
      const metrics = riskManager.getMetrics();
      const var95 = parseFloat(metrics.var_95);
      
      expect(var95).toBeGreaterThan(0);
      expect(var95).toBeLessThan(10000);
    });

    it('should calculate stress PnL', () => {
      const longPosition = {
        symbol: 'ETH-USD',
        side: 'long',
        notional: new Decimal('50000'),
        entryPrice: new Decimal('3500'),
      };

      const shortPosition = {
        symbol: 'BTC-USD',
        side: 'short',
        notional: new Decimal('50000'),
        entryPrice: new Decimal('65000'),
      };

      riskManager.updatePosition('pos-1', longPosition);
      riskManager.updatePosition('pos-2', shortPosition);
      
      const metrics = riskManager.getMetrics();
      const stressPnL = parseFloat(metrics.stress_pnl);
      
      expect(stressPnL).toBeDefined();
      expect(Math.abs(stressPnL)).toBeLessThan(20000);
    });

    it('should calculate utilization correctly', () => {
      const position = {
        symbol: 'ETH-USD',
        side: 'long',
        notional: new Decimal('250000'),
        entryPrice: new Decimal('3500'),
      };

      riskManager.updatePosition('pos-1', position);
      
      const metrics = riskManager.getMetrics();
      expect(metrics.utilization).toBe('25.00%');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero leverage', () => {
      const action: DerivativeAction = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        constraints: {
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'arbitrum',
        },
      };

      const quote: VenueQuote = {
        venue: 'gmx-v2',
        mid: '3500',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('1')
      );

      expect(result.allowed).toBe(true);
      expect(result.metrics!.margin_requirement).toBe('3500');
    });

    it('should handle missing quote fields', () => {
      const action: DerivativeAction = {
        instrument: 'perp',
        symbol: 'ETH-USD',
        side: 'long',
        size: '1',
        leverage: '5',
        constraints: {
          max_slippage_bps: 10,
          max_funding_bps_8h: 20,
          max_fee_bps: 5,
          venue_allowlist: ['gmx-v2'],
        },
        collateral: {
          token: 'USDC',
          chain: 'arbitrum',
        },
      };

      const quote: VenueQuote = {
        venue: 'gmx-v2',
        ask: '3500',
      };

      const result = riskManager.checkConstraints(
        action,
        quote,
        new Decimal('1')
      );

      expect(result.allowed).toBe(true);
    });
  });
});