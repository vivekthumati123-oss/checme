export interface VersionSupportMatrix {
  testedMajors: readonly number[];
  bestEffortMajors: readonly number[];
  minSupportedMajor: number;
}

export const NODE_SUPPORT: VersionSupportMatrix = {
  testedMajors: [20, 22, 24],
  bestEffortMajors: [21, 23, 25, 26],
  minSupportedMajor: 20,
};

export const JEST_SUPPORT: VersionSupportMatrix = {
  testedMajors: [29, 30],
  bestEffortMajors: [27, 28],
  minSupportedMajor: 27,
};

export const VITEST_SUPPORT: VersionSupportMatrix = {
  testedMajors: [1, 2, 3, 4],
  bestEffortMajors: [0],
  minSupportedMajor: 1,
};

export const JS_TOOLCHAIN_MISMATCH_PATTERNS: readonly RegExp[] = [
  /requires a node version/i,
  /Unsupported engine/i,
  /The engine "node" is incompatible with this module/i,
  /ERR_REQUIRE_ESM[^\r\n]*node_modules|node_modules[^\r\n]*ERR_REQUIRE_ESM/,
  /NODE_MODULE_VERSION\s+\d+/i,
  /node_modules[/\\].*SyntaxError: Unexpected token/i,
];

export function extractMajorVersion(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^v/i, "");
  const m = /(\d+)/.exec(cleaned);
  if (!m?.[1]) return null;
  const major = Number.parseInt(m[1], 10);
  return Number.isFinite(major) ? major : null;
}

export function classifyVersionTier(
  rawVersion: string | null | undefined,
  matrix: VersionSupportMatrix,
): { tier: "tested" | "best-effort"; supported: boolean; reason?: string } {
  const major = extractMajorVersion(rawVersion);
  if (major === null) {
    return { tier: "best-effort", supported: true };
  }
  if (major < matrix.minSupportedMajor) {
    return {
      tier: "best-effort",
      supported: false,
      reason: `Version "${rawVersion}" (major ${major}) is below minimum supported major ${matrix.minSupportedMajor}.`,
    };
  }
  if (matrix.testedMajors.includes(major)) {
    return { tier: "tested", supported: true };
  }
  return { tier: "best-effort", supported: true };
}
