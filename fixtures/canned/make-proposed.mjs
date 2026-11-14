import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildCannedTestContent(mf) {
  const names = (mf.symbols ?? []).map((s) => s.qualifiedName).filter(Boolean);
  const firstSym = names[0] ?? "target";
  const shortSym = firstSym.includes(".") ? firstSym.split(".").pop() : firstSym;

  if (mf.language === "python") {
    const rawHint = mf.importHint ?? "sample";
    const pyMatch = /^from\s+([A-Za-z0-9_.]+)\s+import/.exec(rawHint.trim());
    const modHint = pyMatch?.[1] ?? rawHint;
    return [
      `from ${modHint} import ${shortSym}`,
      "",
      `def test_${shortSym}_canned():`,
      `    assert callable(${shortSym})`,
      "",
    ].join("\n");
  }

  if (mf.language === "java") {
    const clsName = mf.testClassName ?? path.posix.parse(mf.testPath).name;
    const rawHint = mf.importHint ?? "";
    const pkgMatch = /package\s+([A-Za-z0-9_.]+)\s*;/.exec(rawHint);
    const pkgName = pkgMatch?.[1] ?? (rawHint && !rawHint.includes(";") ? rawHint : "");
    const pkg = pkgName ? `package ${pkgName};\n\n` : "";
    return [
      pkg + `import org.junit.jupiter.api.Test;`,
      `import static org.junit.jupiter.api.Assertions.*;`,
      "",
      `public class ${clsName} {`,
      `    @Test`,
      `    void cannedSmokeTest() {`,
      `        assertNotNull("${shortSym}");`,
      `    }`,
      `}`,
      "",
    ].join("\n");
  }

  const rawHint = mf.importHint ?? "../../src/index";
  const jsMatch = /from\s+["']([^"']+)["']/.exec(rawHint);
  const importPath = jsMatch?.[1] ?? rawHint;
  return [
    `import { describe, it, expect } from "vitest";`,
    `import * as targetMod from "${importPath}";`,
    "",
    `describe("${shortSym}", () => {`,
    `  it("exposes expected export", () => {`,
    `    expect(targetMod).toBeDefined();`,
    `  });`,
    `});`,
    "",
  ].join("\n");
}

export function makeProposedFromManifest(manifest, opts = {}) {
  const files = (manifest.files ?? []).map((mf) => {
    const content = opts.contentOverride ? opts.contentOverride(mf) : buildCannedTestContent(mf);
    return {
      fileId: mf.fileId,
      testPath: mf.testPath,
      content,
      sha256: sha256(content),
      symbolIds: (mf.symbols ?? []).map((s) => s.symbolId),
      assumptions: ["Generated deterministically from fixtures/canned/make-proposed.mjs"],
      status: "ok",
    };
  });

  return {
    schemaVersion: 1,
    runId: manifest.runId ?? "canned-run",
    headSha: manifest.headSha ?? "0000000",
    model: null,
    files,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isMain) {
  const args = process.argv.slice(2);
  const manifestIdx = args.indexOf("--manifest");
  const outIdx = args.indexOf("--out");
  const manifestPath = manifestIdx >= 0 ? args[manifestIdx + 1] : ".unit-agent/prepare/manifest.json";
  const outPath = outIdx >= 0 ? args[outIdx + 1] : ".unit-agent/generate/proposed.json";
  if (!existsSync(manifestPath)) {
    process.stderr.write(`Manifest not found: ${manifestPath}\n`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const proposed = makeProposedFromManifest(manifest);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(proposed, null, 2)}\n`, "utf8");
}

