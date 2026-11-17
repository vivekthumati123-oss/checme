import { applyDiscount } from "../discount";

describe("applyDiscount", () => {
  it("applies a percentage", () => {
    expect(applyDiscount(200, 25)).toBe(150);
  });

  it("returns the price for 0 percent", () => {
    expect(applyDiscount(80, 0)).toBe(80);
  });

  it("rejects out-of-range percentages", () => {
    expect(() => applyDiscount(10, 101)).toThrow(RangeError);
    expect(() => applyDiscount(10, -1)).toThrow(RangeError);
  });
});
