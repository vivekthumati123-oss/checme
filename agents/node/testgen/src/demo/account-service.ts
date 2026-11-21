/**
 * Account service with 4 functions: 3 covered, 1 untested.
 */

export function calculateBonus(salary: number): number {
  if (salary <= 0) return 0;
  if (salary > 100_000) return salary * 0.15;
  return salary * 0.05;
}

export function formatAccountName(first: string, last: string): string {
  const f = first.trim();
  const l = last.trim();
  if (!f && !l) return "Anonymous";
  if (!f) return l;
  if (!l) return f;
  return `${l.toUpperCase()}, ${f}`;
}

export function calculateTaxDeduction(amount: number, rate: number): number {
  if (amount <= 0 || rate <= 0) return 0;
  return Math.round(amount * (rate / 100));
}

// THIS FUNCTION HAS ZERO COVERAGE / ZERO TESTS:
export function untestedWithdrawalPenalty(amount: number, tier: string): number {
  if (amount <= 0) return 0;
  if (tier === "platinum") return 0;
  if (tier === "gold") return amount * 0.01;
  if (tier === "silver") return amount * 0.03;
  return amount * 0.05;
}
