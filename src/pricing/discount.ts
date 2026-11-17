export function applyDiscount(price: number, pct: number): number {
  if (pct < 0 || pct > 100) {
    throw new RangeError("pct out of range");
  }
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

export function bulkDiscount(quantity: number, unitPrice: number): number {
  if (quantity <= 0 || unitPrice < 0) {
    throw new RangeError("invalid input");
  }
  let pct = 0;
  if (quantity >= 100) {
    pct = 20;
  } else if (quantity >= 50) {
    pct = 10;
  } else if (quantity >= 10) {
    pct = 5;
  }
  return roundCents(quantity * unitPrice * (1 - pct / 100));
}

export const clampPct = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);

// Not exported: must not be a test target.
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface LineItem {
  sku: string;
  qty: number;
  unitPrice: number;
}

export class PriceCalculator {
  private readonly taxRate: number;

  // Only assigns a field: must be skipped.
  constructor(taxRate: number) {
    this.taxRate = taxRate;
  }

  total(items: LineItem[]): number {
    if (items.length === 0) {
      return 0;
    }
    const subtotal = items.reduce((sum, i) => sum + bulkDiscount(i.qty, i.unitPrice), 0);
    return roundCents(subtotal * (1 + this.taxRate));
  }

  withCoupon(items: LineItem[], code: string): number {
    const base = this.total(items);
    switch (code.toUpperCase()) {
      case "SAVE10":
        return roundCents(base * 0.9);
      case "SAVE20":
        return roundCents(base * 0.8);
      case "FREE":
        return 0;
      default:
        throw new Error(`unknown coupon: ${code}`);
    }
  }
}

export async function loadRate(
  fetchRate: (region: string) => Promise<number>,
  region: string,
): Promise<number> {
  try {
    const rate = await fetchRate(region);
    return rate > 0 && rate < 1 ? rate : 0.2;
  } catch {
    return 0.2;
  }
}
