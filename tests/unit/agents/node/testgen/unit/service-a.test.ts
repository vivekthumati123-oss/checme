import { describe, expect, it } from "vitest";
import { processServiceA } from "../../../../../../agents/node/testgen/src/demo/service-a";

describe("processServiceA", () => {
  it("returns empty for falsy input", () => {
    expect(processServiceA("")).toBe("empty");
  });

  it("formats input properly", () => {
    expect(processServiceA(" HeLLo ")).toBe("service-a-hello");
  });
});
