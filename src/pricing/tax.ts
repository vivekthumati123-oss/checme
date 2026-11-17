const CENTS = 100;

export function addTax(amount: number, rate: number): number {
  if (amount < 0) {
    throw new RangeError("amount must be >= 0");
  }
  return Math.round(amount * (1 + rate) * CENTS) / CENTS;
}
