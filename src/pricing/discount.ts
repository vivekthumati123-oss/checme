export function applyDiscount(price: number, pct: number): number {
  if (pct < 0 || pct > 100) {
    throw new RangeError("pct out of range");
  }
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}
