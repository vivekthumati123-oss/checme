// unit-agent:generated
import { bulkDiscount, PriceCalculator, loadRate } from "../discount";

describe("bulkDiscount", () => {
  it("should apply the quantity discount tiers at their boundaries", () => {
    expect(bulkDiscount(9, 10)).toEqual(90);
    expect(bulkDiscount(10, 10)).toEqual(95);
    expect(bulkDiscount(50, 10)).toEqual(450);
    expect(bulkDiscount(100, 10)).toEqual(800);
  });

  it("should round the discounted total to cents", () => {
    expect(bulkDiscount(3, 0.335)).toEqual(1.01);
  });

  it("should reject nonpositive quantities and negative unit prices", () => {
    expect(() => bulkDiscount(0, 10)).toThrow(RangeError);
    expect(() => bulkDiscount(1, -0.01)).toThrow(RangeError);
  });
});

describe("PriceCalculator.total", () => {
  it("should return zero for an empty item list", () => {
    expect(new PriceCalculator(0.2).total([])).toEqual(0);
  });

  it("should sum discounted line items and apply tax", () => {
    const calculator = new PriceCalculator(0.1);
    expect(
      calculator.total([
        { sku: "A", qty: 10, unitPrice: 10 },
        { sku: "B", qty: 1, unitPrice: 5 },
      ]),
    ).toEqual(110);
  });

  it("should propagate invalid line-item input", () => {
    expect(() => new PriceCalculator(0).total([{ sku: "A", qty: 0, unitPrice: 5 }])).toThrow(
      RangeError,
    );
  });
});

describe("PriceCalculator.withCoupon", () => {
  const calculator = new PriceCalculator(0.1);
  const items = [{ sku: "A", qty: 1, unitPrice: 100 }];

  it("should apply SAVE10 without regard to coupon-code casing", () => {
    expect(calculator.withCoupon(items, "save10")).toEqual(99);
  });

  it("should apply the SAVE20 coupon to the taxed total", () => {
    expect(calculator.withCoupon(items, "SAVE20")).toEqual(88);
  });

  it("should make the total zero with the FREE coupon", () => {
    expect(calculator.withCoupon(items, "FREE")).toEqual(0);
  });

  it("should reject an unknown coupon code", () => {
    expect(() => calculator.withCoupon(items, "NOPE")).toThrow("unknown coupon: NOPE");
  });
});

describe("loadRate", () => {
  it("should return a valid fetched rate and pass the region to the fetcher", async () => {
    const fetchRate = jest.fn().mockResolvedValue(0.35);

    await expect(loadRate(fetchRate, "north")).resolves.toEqual(0.35);
    expect(fetchRate).toHaveBeenCalledWith("north");
  });

  it("should use the default rate when the fetched rate is outside the valid range", async () => {
    const fetchRate = jest.fn().mockResolvedValue(1);

    await expect(loadRate(fetchRate, "south")).resolves.toEqual(0.2);
  });

  it("should use the default rate when fetching rejects", async () => {
    const fetchRate = jest.fn().mockRejectedValue(new Error("unavailable"));

    await expect(loadRate(fetchRate, "west")).resolves.toEqual(0.2);
  });
});
