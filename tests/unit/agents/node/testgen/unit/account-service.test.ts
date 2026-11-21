import { describe, expect, it } from "vitest";
import {
  calculateBonus,
  calculateTaxDeduction,
  formatAccountName,
} from "../../../../../agents/node/testgen/src/demo/account-service";

describe("account-service covered functions", () => {
  describe("calculateBonus", () => {
    it("handles zero and negative salary", () => {
      expect(calculateBonus(0)).toBe(0);
      expect(calculateBonus(-1000)).toBe(0);
    });

    it("calculates standard bonus", () => {
      expect(calculateBonus(50_000)).toBe(2500);
    });

    it("calculates executive bonus", () => {
      expect(calculateBonus(200_000)).toBe(30_000);
    });
  });

  describe("formatAccountName", () => {
    it("handles empty names", () => {
      expect(formatAccountName("", "")).toBe("Anonymous");
    });

    it("formats standard name", () => {
      expect(formatAccountName("John", "Doe")).toBe("DOE, John");
    });
  });

  describe("calculateTaxDeduction", () => {
    it("handles zero and negative amounts", () => {
      expect(calculateTaxDeduction(0, 10)).toBe(0);
      expect(calculateTaxDeduction(100, 0)).toBe(0);
    });

    it("calculates deduction percentage", () => {
      expect(calculateTaxDeduction(1000, 15)).toBe(150);
    });
  });
});
