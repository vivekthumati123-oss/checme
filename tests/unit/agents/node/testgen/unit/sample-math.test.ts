// unit-agent:generated
import { describe, it, expect } from "vitest";
import { multiply, divide } from "../../../../../../agents/node/testgen/src/sample-math";

describe("multiply", () => {
  it("should multiply positive numbers", () => {
    expect(multiply(6, 7)).toEqual(42);
  });

  it("should return zero when either operand is zero", () => {
    expect(multiply(0, 12)).toEqual(0);
    expect(multiply(-5, 0)).toEqual(0);
  });

  it("should multiply negative operands", () => {
    expect(multiply(-3, 4)).toEqual(-12);
    expect(multiply(-3, -4)).toEqual(12);
  });
});

describe("divide", () => {
  it("should divide one number by another", () => {
    expect(divide(12, 4)).toEqual(3);
  });

  it("should return a fractional quotient", () => {
    expect(divide(5, 2)).toEqual(2.5);
  });

  it("should return zero when the dividend is zero", () => {
    expect(divide(0, 7)).toEqual(0);
  });

  it("should throw when dividing by zero", () => {
    expect(() => divide(10, 0)).toThrow("Division by zero");
  });
});
