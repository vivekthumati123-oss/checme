import type { LanguageKey } from "../../contracts";
import { sha256Hex } from "../context";
import { formatGeneratedTestContent } from "../text/eol";
import { pruneFailingTests } from "./prune";

export interface DerivedFinalTest {
  content: string;
  sha256: string;
  keptCount: number;
  droppedCount: number;
  prunedNames: string[];
  empty: boolean;
}

/**
 * Single deterministic derivation of final validated test content (D25).
 * Both validate and local apply rely on this function so content and sha256 never diverge.
 */
export async function deriveFinalContent(params: {
  language: LanguageKey;
  testPath: string;
  content: string;
  failingTestNames: readonly string[];
  repoRoot: string;
  configEol: "auto" | "lf" | "crlf";
  provenanceHeader: boolean;
  referenceSourceContent?: string;
  wasmDir?: string;
}): Promise<DerivedFinalTest> {
  const pruned = await pruneFailingTests({
    language: params.language,
    testPath: params.testPath,
    content: params.content,
    failingTestNames: params.failingTestNames,
    wasmDir: params.wasmDir,
  });

  const formatted = formatGeneratedTestContent({
    content: pruned.prunedContent,
    language: params.language,
    repoRoot: params.repoRoot,
    targetPath: params.testPath,
    configEol: params.configEol,
    provenanceHeader: params.provenanceHeader,
    referenceSourceContent: params.referenceSourceContent,
  });

  return {
    content: formatted,
    sha256: sha256Hex(formatted),
    keptCount: pruned.keptCount,
    droppedCount: pruned.droppedCount,
    prunedNames: pruned.prunedNames,
    empty: pruned.empty,
  };
}
