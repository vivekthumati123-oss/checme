export const JAVA_TESTED_MAJORS = [17, 21] as const;
export const JAVA_MIN_SUPPORTED_MAJOR = 11;

export const GRADLE_TESTED_MAJORS = [7, 8, 9] as const;
export const GRADLE_MIN_SUPPORTED_MAJOR = 7;

export const MAVEN_MIN_SUPPORTED = { major: 3, minor: 8 } as const;

export const JAVA_TOOLCHAIN_MISMATCH_PATTERNS: readonly RegExp[] = [
  /class file has wrong version/i,
  /Unsupported class file major version/i,
  /UnsupportedClassVersionError/i,
  /Minimum supported Gradle version is/i,
  /Could not open init generic class cache/i,
  /invalid target release:/i,
  /source value \d+ is obsolete/i,
  /Fatal error compiling: error: release version \d+ not supported/i,
];

export function extractJavaMajor(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  const oneEight = /^1\.(\d+)/.exec(cleaned);
  if (oneEight?.[1]) {
    return Number.parseInt(oneEight[1], 10);
  }
  const m = /(\d+)/.exec(cleaned);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function classifyJavaSupport(rawVersion: string | null | undefined): {
  tier: "tested" | "best-effort";
  supported: boolean;
  reason?: string;
} {
  const major = extractJavaMajor(rawVersion);
  if (major === null) return { tier: "best-effort", supported: true };
  if (major < JAVA_MIN_SUPPORTED_MAJOR) {
    return {
      tier: "best-effort",
      supported: false,
      reason: `JDK ${rawVersion} is below minimum supported JDK ${JAVA_MIN_SUPPORTED_MAJOR}.`,
    };
  }
  if ((JAVA_TESTED_MAJORS as readonly number[]).includes(major)) {
    return { tier: "tested", supported: true };
  }
  return { tier: "best-effort", supported: true };
}
