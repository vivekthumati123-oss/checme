// unit-agent:generated
const { slugify, truncate } = require("../legacy");

describe("slugify", () => {
  it("should lowercase and replace whitespace and punctuation with hyphens", () => {
    expect(slugify("  Hello, World!  ")).toEqual("hello-world");
  });

  it("should trim separators and return an empty string when no alphanumeric characters remain", () => {
    expect(slugify("--- !!! ---")).toEqual("");
  });

  it("should reject non-string input", () => {
    expect(() => slugify(123)).toThrow(TypeError);
  });
});

describe("truncate", () => {
  it("should leave text unchanged when it fits within the maximum", () => {
    expect(truncate("hello", 5)).toEqual("hello");
  });

  it("should shorten text to max characters and end with an ellipsis", () => {
    expect(truncate("hello world", 5)).toEqual("hell…");
  });

  it("should reject a maximum below one", () => {
    expect(() => truncate("hello", 0)).toThrow(RangeError);
  });
});
