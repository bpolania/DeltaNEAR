import Decimal from 'decimal.js';
import { DerivativeAction, VenueQuote } from '@deltanear/proto';

interface RiskCheck {
  allowed: boolean;
  reason?: string;
  metrics?: {
    current_exposure: string;
    max_exposure: string;
    margin_requirement: string;
    liquidation_price?: string;
  };
}

export class RiskManager {
  private maxExposure: Decimal;
  private currentExposure: Decimal = new Decimal(0);
  private positions: Map<string, Position> = new Map();

  constructor(maxExposure: string) {
    this.maxExposure = new Decimal(maxExposure);
  }

  checkConstraints(
    action: DerivativeAction,
    quote: VenueQuote,
    size: Decimal
  ): RiskCheck {
    const price = new Decimal(quote.mid || quote.ask || '0');
    const notional = price.mul(size);
    
    if (action.instrument === 'perp') {
      return this.checkPerpConstraints(action, quote, notional);
    } else {
      return this.checkOptionConstraints(action, quote, notional);
    }
  }

  private checkPerpConstraints(
    action: DerivativeAction,
    quote: VenueQuote,
    notional: Decimal
  ): RiskCheck {
    const leverage = action.leverage ? new Decimal(action.leverage) : new Decimal(1);
    const requiredMargin = notional.div(leverage);
    const maintenanceMargin = requiredMargin.mul(0.5);

    const newExposure = this.currentExposure.add(notional);
    if (newExposure.gt(this.maxExposure)) {
      return {
        allowed: false,
        reason: 'Exceeds maximum exposure limit',
        metrics: {
          current_exposure: this.currentExposure.toString(),
          max_exposure: this.maxExposure.toString(),
          margin_requirement: requiredMargin.toString(),
        },
      };
    }

    const fundingRate = parseFloat(quote.funding_rate_8h || '0');
    const maxFundingRate = action.max_funding_bps_8h / 10000;
    if (Math.abs(fundingRate) > maxFundingRate) {
      return {
        allowed: false,
        reason: 'Funding rate exceeds maximum allowed',
      };
    }

    const price = new Decimal(quote.mid || '0');
    const liquidationPrice = this.calculateLiquidationPrice(
      price,
      action.side as 'long' | 'short',
      leverage,
      maintenanceMargin,
      notional
    );

    return {
      allowed: true,
      metrics: {
        current_exposure: this.currentExposure.toString(),
        max_exposure: this.maxExposure.toString(),
        margin_requirement: requiredMargin.toString(),
        liquidation_price: liquidationPrice.toString(),
      },
    };
  }

  private checkOptionConstraints(
    action: DerivativeAction,
    quote: VenueQuote,
    notional: Decimal
  ): RiskCheck {
    const premium = notional;
    const newExposure = this.currentExposure.add(premium);

    if (newExposure.gt(this.maxExposure)) {
      return {
        allowed: false,
        reason: 'Exceeds maximum exposure limit',
        metrics: {
          current_exposure: this.currentExposure.toString(),
          max_exposure: this.maxExposure.toString(),
          margin_requirement: premium.toString(),
        },
      };
    }

    const iv = parseFloat(quote.iv || '0');
    if (iv > 2.0) {
      return {
        allowed: false,
        reason: 'Implied volatility too high',
      };
    }

    const delta = Math.abs(parseFloat(quote.delta || '0'));
    const totalDelta = this.calculateTotalDelta();
    if (totalDelta.add(delta).gt(100)) {
      return {
        allowed: false,
        reason: 'Delta exposure limit exceeded',
      };
    }

    return {
      allowed: true,
      metrics: {
        current_exposure: this.currentExposure.toString(),
        max_exposure: this.maxExposure.toString(),
        margin_requirement: premium.toString(),
      },
    };
  }

  private calculateLiquidationPrice(
    entryPrice: Decimal,
    side: 'long' | 'short',
    leverage: Decimal,
    maintenanceMargin: Decimal,
    notional: Decimal
  ): Decimal {
    const maintenanceRatio = maintenanceMargin.div(notional);
    
    if (side === 'long') {
      return entryPrice.mul(new Decimal(1).sub(new Decimal(1).div(leverage)).add(maintenanceRatio));
    } else {
      return entryPrice.mul(new Decimal(1).add(new Decimal(1).div(leverage)).sub(maintenanceRatio));
    }
  }

  private calculateTotalDelta(): Decimal {
    let totalDelta = new Decimal(0);
    for (const position of this.positions.values()) {
      if (position.delta) {
        totalDelta = totalDelta.add(position.delta);
      }
    }
    return totalDelta;
  }

  updatePosition(symbol: string, position: Position) {
    this.positions.set(symbol, position);
    this.recalculateExposure();
  }

  removePosition(symbol: string) {
    this.positions.delete(symbol);
    this.recalculateExposure();
  }

  private recalculateExposure() {
    this.currentExposure = new Decimal(0);
    for (const position of this.positions.values()) {
      this.currentExposure = this.currentExposure.add(position.notional);
    }
  }

  getMetrics(): any {
    const var95 = this.calculateVaR(0.95);
    const stressPnL = this.calculateStressPnL();

    return {
      max_exposure: this.maxExposure.toString(),
      current_exposure: this.currentExposure.toString(),
      utilization: this.currentExposure.div(this.maxExposure).mul(100).toFixed(2) + '%',
      position_count: this.positions.size,
      var_95: var95.toString(),
      stress_pnl: stressPnL.toString(),
    };
  }

  private calculateVaR(confidence: number): Decimal {
    const volatility = new Decimal(0.02);
    const zScore = 1.645;
    return this.currentExposure.mul(volatility).mul(zScore);
  }

  private calculateStressPnL(): Decimal {
    const stressMove = new Decimal(0.1);
    let stressPnL = new Decimal(0);
    
    for (const position of this.positions.values()) {
      const positionPnL = position.notional.mul(stressMove);
      if (position.side === 'short' || position.side === 'sell') {
        stressPnL = stressPnL.sub(positionPnL);
      } else {
        stressPnL = stressPnL.add(positionPnL);
      }
    }
    
    return stressPnL;
  }
}

interface Position {
  symbol: string;
  side: string;
  notional: Decimal;
  entryPrice: Decimal;
  delta?: Decimal;
  leverage?: Decimal;
}