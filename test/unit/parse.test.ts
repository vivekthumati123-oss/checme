import { describe, expect, it } from "vitest";

import { parseSourceFile } from "../../src/core/parse";

describe("AST parsers (web-tree-sitter)", () => {
  it("parses exported TypeScript functions, classes, and field arrows while skipping private/trivial", async () => {
    const code = `
import { tax } from "./tax";

export class InvoiceService {
  private secret = 1;
  #internal = 2;

  constructor(rate: number) {
    this.secret = rate;
  }

  get total() {
    return this.secret;
  }

  private helper(x: number) {
    if (x > 0) return x;
    return 0;
  }

  public calculate(amount: number, rush: boolean): number {
    if (amount <= 0) {
      throw new Error("bad amount");
    }
    return rush ? amount * 2 : amount + tax(amount);
  }

  handle = (v: number): number => {
    if (v > 10) return v - 1;
    return v;
  };
}

function unexported(n: number) {
  if (n > 0) return n;
  return 0;
}

export function applyDiscount(price: number, code?: string): number {
  if (code === "VIP" || price > 100) {
    return price * 0.8;
  }
  return price;
}
`;
    const res = await parseSourceFile({
      filePath: "src/billing/invoice.ts",
      content: code,
      minExecutableLines: 2,
    });

    expect(res.language).toBe("javascript");
    expect(res.hasErrors).toBe(false);
    expect(res.primaryClassName).toBe("InvoiceService");
    expect(res.imports).toEqual(["./tax"]);

    const eligibleNames = res.eligibleSymbols.map((s) => s.qualifiedName);
    expect(eligibleNames).toContain("InvoiceService.calculate");
    expect(eligibleNames).toContain("InvoiceService.handle");
    expect(eligibleNames).toContain("applyDiscount");
    expect(eligibleNames).not.toContain("InvoiceService.constructor");
    expect(eligibleNames).not.toContain("InvoiceService.total");
    expect(eligibleNames).not.toContain("InvoiceService.helper");
    expect(eligibleNames).not.toContain("unexported");

    const calcSym = res.eligibleSymbols.find((s) => s.qualifiedName === "InvoiceService.calculate");
    expect(calcSym?.complexity).toBeGreaterThanOrEqual(3);
  });

  it("parses Python functions and classes, skipping _private helpers and @abstractmethod", async () => {
    const code = `
from decimal import Decimal

def _helper(x: int) -> int:
    if x > 0:
        return x
    return 0

def calculate_fee(amount: Decimal, tier: str) -> Decimal:
    match tier:
        case "vip":
            return Decimal("0")
        case _:
            return amount * Decimal("0.05") if amount > 0 else Decimal("0")

class Ledger:
    def _internal(self) -> None:
        a = 1
        b = 2

    def post_entry(self, debit: float, credit: float) -> float:
        if debit < 0 or credit < 0:
            raise ValueError("negative")
        return credit - debit
`;
    const res = await parseSourceFile({
      filePath: "src/ledger.py",
      content: code,
      minExecutableLines: 2,
    });

    expect(res.language).toBe("python");
    expect(res.hasErrors).toBe(false);
    expect(res.primaryClassName).toBe("Ledger");
    expect(res.imports).toEqual(["decimal"]);
    const names = res.eligibleSymbols.map((s) => s.qualifiedName);
    expect(names).toEqual(["calculate_fee", "Ledger.post_entry"]);
    expect(res.eligibleSymbols[0]?.complexity).toBeGreaterThanOrEqual(3);
  });

  it("parses Java classes, packages, overloaded methods, and skips private/interfaces", async () => {
    const code = `
package com.acme.payments;

import java.math.BigDecimal;

public class PricingEngine {
    private final int scale;

    public PricingEngine(int scale) {
        this.scale = scale;
    }

    public int getScale() {
        return this.scale;
    }

    private int hidden(int x) {
        if (x > 0) return x;
        return 0;
    }

    public int compute(int value) {
        if (value < 0) {
            throw new IllegalArgumentException("neg");
        }
        return value * 2;
    }

    public BigDecimal compute(BigDecimal value, boolean discount) {
        if (discount && value.signum() > 0) {
            return value.multiply(BigDecimal.valueOf(0.9));
        }
        return value;
    }
}
`;
    const res = await parseSourceFile({
      filePath: "src/main/java/com/acme/payments/PricingEngine.java",
      content: code,
      minExecutableLines: 2,
    });

    expect(res.language).toBe("java");
    expect(res.packageName).toBe("com.acme.payments");
    expect(res.primaryClassName).toBe("PricingEngine");
    expect(res.hasErrors).toBe(false);
    const ids = res.eligibleSymbols.map((s) => s.symbolId);
    expect(ids).toEqual([
      "com.acme.payments.PricingEngine#compute(int)",
      "com.acme.payments.PricingEngine#compute(BigDecimal,boolean)",
    ]);
  });

  it("skips test files and generated headers", async () => {
    const testRes = await parseSourceFile({
      filePath: "src/math.test.ts",
      content: "export function testHelper() { return 1 + 2; }",
    });
    expect(testRes.isTestFile).toBe(true);
    expect(testRes.eligibleSymbols).toEqual([]);

    const genRes = await parseSourceFile({
      filePath: "src/api_client.ts",
      content: "// @generated DO NOT EDIT\nexport function callApi() {\n  const a = 1;\n  return a;\n}\n",
    });
    expect(genRes.isGeneratedFile).toBe(true);
    expect(genRes.eligibleSymbols).toEqual([]);
  });
});
