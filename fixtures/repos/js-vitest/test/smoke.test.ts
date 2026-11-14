import { describe, it, expect } from "vitest";
import { subtract } from "../src/math.js";

describe("subtract", () => {
  it("subtracts two numbers", () => {
    expect(subtract(5, 2)).toBe(3);
  });
});

