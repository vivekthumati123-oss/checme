// Sample JavaScript / TypeScript fixture for AST symbol extraction

export function formatCurrency(amount: number, currency = "USD"): string {
  if (!Number.isFinite(amount)) {
    throw new Error("Invalid amount");
  }
  const rounded = Math.round(amount * 100) / 100;
  return `${currency} ${rounded.toFixed(2)}`;
}

export const clampPercent = (value: number): number => {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
};

export class OrderCalculator {
  constructor(private readonly taxRate: number) {}

  subtotal(prices: number[]): number {
    let total = 0;
    for (const p of prices) {
      total += p;
    }
    return total;
  }

  totalWithTax(prices: number[]): number {
    const sub = this.subtotal(prices);
    return Math.round(sub * (1 + this.taxRate) * 100) / 100;
  }
}

