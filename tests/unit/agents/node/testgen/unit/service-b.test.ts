import { describe, expect, it } from "vitest";
import { processServiceB } from "../../../../../../agents/node/testgen/src/demo/service-b";

describe("processServiceB", () => {
  it("returns zero for zero or negative count", () => {
    expect(processServiceB(0)).toBe(0);
    expect(processServiceB(-5)).toBe(0);
  });

  it("multiplies count by 10", () => {
    expect(processServiceB(4)).toBe(40);
  });
});
