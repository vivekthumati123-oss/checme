// unit-agent:generated
import { describe, it, expect } from "vitest";
import {
  calculateBonus,
  formatAccountName,
  calculateTaxDeduction,
  untestedWithdrawalPenalty,
} from "../../../../../../agents/node/testgen/src/demo/account-service";

describe("calculateBonus", () => {
  it("should return zero for a non-positive salary", () => {
    expect(calculateBonus(0)).toEqual(0);
    expect(calculateBonus(-500)).toEqual(0);
  });

  it("should calculate the standard bonus at the 100000 boundary", () => {
    expect(calculateBonus(100_000)).toEqual(5_000);
  });

  it("should calculate the higher bonus above 100000", () => {
    expect(calculateBonus(120_000)).toEqual(18_000);
  });
});

describe("formatAccountName", () => {
  it("should format a complete name with the last name uppercased", () => {
    expect(formatAccountName("Ada", "Lovelace")).toEqual("LOVELACE, Ada");
  });

  it("should trim whitespace and use the last name alone when first is empty", () => {
    expect(formatAccountName("   ", "  Lovelace ")).toEqual("Lovelace");
  });

  it("should trim whitespace and use the first name alone when last is empty", () => {
    expect(formatAccountName(" Ada ", "   ")).toEqual("Ada");
  });

  it("should return Anonymous when both names are empty", () => {
    expect(formatAccountName("  ", " ")).toEqual("Anonymous");
  });
});

describe("calculateTaxDeduction", () => {
  it("should return zero for a non-positive amount", () => {
    expect(calculateTaxDeduction(0, 20)).toEqual(0);
    expect(calculateTaxDeduction(-100, 20)).toEqual(0);
  });

  it("should return zero for a non-positive rate", () => {
    expect(calculateTaxDeduction(100, 0)).toEqual(0);
    expect(calculateTaxDeduction(100, -5)).toEqual(0);
  });

  it("should round the calculated deduction to the nearest integer", () => {
    expect(calculateTaxDeduction(100, 17.5)).toEqual(18);
  });

  it("should calculate an exact deduction", () => {
    expect(calculateTaxDeduction(240, 25)).toEqual(60);
  });
});

describe("untestedWithdrawalPenalty", () => {
  it("should return zero for a non-positive withdrawal amount", () => {
    expect(untestedWithdrawalPenalty(0, "platinum")).toEqual(0);
    expect(untestedWithdrawalPenalty(-50, "gold")).toEqual(0);
  });

  it("should apply no penalty for a platinum account", () => {
    expect(untestedWithdrawalPenalty(500, "platinum")).toEqual(0);
  });

  it("should apply one percent for a gold account", () => {
    expect(untestedWithdrawalPenalty(500, "gold")).toEqual(5);
  });

  it("should apply three percent for a silver account", () => {
    expect(untestedWithdrawalPenalty(500, "silver")).toEqual(15);
  });

  it("should apply the default five percent for any other tier", () => {
    expect(untestedWithdrawalPenalty(500, "bronze")).toEqual(25);
  });
});
