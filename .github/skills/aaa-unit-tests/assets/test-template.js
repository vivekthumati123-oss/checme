import { subject } from "../../../src/path/to/subject.js";

describe("subject", () => {
  it("does the expected thing for a typical input", () => {
    // Arrange
    const input = 1;

    // Act
    const result = subject(input);

    // Assert
    expect(result).toBe(1);
  });
});
