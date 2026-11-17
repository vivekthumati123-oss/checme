import { addTax } from "../tax";

describe("addTax", () => {
  it("adds tax and rounds to cents", () => {
    expect(addTax(100, 0.2)).toBe(120);
    expect(addTax(19.99, 0.075)).toBe(21.49);
  });

  it("rejects negative amounts", () => {
    expect(() => addTax(-1, 0.2)).toThrow(RangeError);
  });
});
