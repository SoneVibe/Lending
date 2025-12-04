import Decimal from 'decimal.js';

export function toHuman(amount: bigint, decimals: number): string {
  const d = new Decimal(amount.toString()).div(new Decimal(10).pow(decimals));
  return d.toFixed(decimals > 6 ? 6 : decimals);
}

export function mantissaToPercent(m: bigint, precision = 2): string {
  // m scaled 1e18
  const pct = new Decimal(m.toString()).div(1e16); // (m/1e18)*100 => m/1e16
  return pct.toFixed(precision) + '%';
}

export function annualFromPerBlock(perBlock: bigint): Decimal {
  return new Decimal(perBlock.toString()).mul(15_768_000).div(1e18);
}

export function apyString(perBlock: bigint): string {
  const apy = annualFromPerBlock(perBlock).mul(100); // convert to %
  return apy.lt(0.01) ? '<0.01%' : apy.toFixed(2) + '%';
}