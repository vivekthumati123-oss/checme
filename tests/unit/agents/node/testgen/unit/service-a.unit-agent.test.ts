// unit-agent:generated
import { describe, it, expect } from "vitest";
import { processServiceA } from "../../../../../../agents/node/testgen/src/demo/service-a";

describe("processServiceA", () => {
  it("should return empty for an empty string", () => {
    expect(processServiceA("")).toEqual("empty");
  });

  it("should normalize a regular input with a prefix", () => {
    expect(processServiceA("Hello World")).toEqual("service-a-hello world");
  });

  it("should trim surrounding whitespace before formatting", () => {
    expect(processServiceA("   Alpha   ")).toEqual("service-a-alpha");
  });

  it("should lowercase all letters in the input", () => {
    expect(processServiceA("MiXeD Case 123")).toEqual("service-a-mixed case 123");
  });

  it("should format whitespace-only input into an empty service value", () => {
    expect(processServiceA("   ")).toEqual("service-a-");
  });
});
