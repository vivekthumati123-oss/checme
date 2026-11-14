import { describe, expect, it } from "vitest";

import { runStaticPolicyCheck } from "../../src/core/policy";
import { EVAL_CORPUS } from "./corpus";

export interface EvalSummary {
  totalCases: number;
  byLanguage: Record<"javascript" | "python" | "java", { total: number; passed: number }>;
  passRate: number;
  securityEscapes: number;
}

describe("evaluation harness (30-function corpus)", () => {
  it("evaluates all 30 cases across JS/Python/Java and meets pilot gate thresholds", async () => {
    const byLanguage: EvalSummary["byLanguage"] = {
      javascript: { total: 0, passed: 0 },
      python: { total: 0, passed: 0 },
      java: { total: 0, passed: 0 },
    };
    let passedCount = 0;

    for (const item of EVAL_CORPUS) {
      byLanguage[item.language].total += 1;
      const check = await runStaticPolicyCheck({
        language: item.language,
        testPath: item.testPath,
        content: item.sampleTestContent,
        importHint: item.importHint,
        sourcePath: item.sourcePath,
        targetCount: 1,
        maxTestsPerSymbol: 6,
      });
      if (check.ok === item.expectedGatePass) {
        passedCount += 1;
        if (check.ok) {
          byLanguage[item.language].passed += 1;
        }
      }
    }

    const passRate = passedCount / EVAL_CORPUS.length;
    expect(EVAL_CORPUS).toHaveLength(30);
    expect(byLanguage.javascript.total).toBe(10);
    expect(byLanguage.python.total).toBe(10);
    expect(byLanguage.java.total).toBe(10);
    expect(passRate).toBeGreaterThanOrEqual(0.8);
  });
});
