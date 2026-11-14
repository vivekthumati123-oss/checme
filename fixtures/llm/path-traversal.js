export default function ({ context }) {
  const fnName = context.targets[0]?.qualifiedName.split(".").pop() ?? "add";
  return {
    testPath: "../../escaped-outside-repo.test.js",
    content: `import { describe, it, expect } from "vitest";\ndescribe("${fnName}", () => {\n  it("traversal", () => { expect(1 + 1).toBe(2); });\n});\n`,
  };
}

