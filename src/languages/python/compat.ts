export const PYTHON_TESTED_MINORS = ["3.11", "3.12", "3.13"] as const;
export const PYTHON_MIN_SUPPORTED = { major: 3, minor: 9 } as const;

export const PYTEST_SUPPORT_MIN_MAJOR = 7;

export const PYTHON_TOOLCHAIN_MISMATCH_PATTERNS: readonly RegExp[] = [
  /Requires-Python/i,
  /requires Python\s*>=/i,
  /Ignored the following versions that require a different python/i,
  /No module named pytest/i,
  /No module named coverage/i,
  /site-packages[/\\].*SyntaxError: invalid syntax/,
];

export function parseMajorMinor(raw: string | null | undefined): { major: number; minor: number } | null {
  if (!raw) return null;
  const m = /(\d+)\.(\d+)/.exec(raw);
  if (!m?.[1] || !m[2]) return null;
  return {
    major: Number.parseInt(m[1], 10),
    minor: Number.parseInt(m[2], 10),
  };
}

export function classifyPythonSupport(rawVersion: string | null | undefined): {
  tier: "tested" | "best-effort";
  supported: boolean;
  reason?: string;
} {
  const mm = parseMajorMinor(rawVersion);
  if (!mm) return { tier: "best-effort", supported: true };
  if (
    mm.major < PYTHON_MIN_SUPPORTED.major ||
    (mm.major === PYTHON_MIN_SUPPORTED.major && mm.minor < PYTHON_MIN_SUPPORTED.minor)
  ) {
    return {
      tier: "best-effort",
      supported: false,
      reason: `Python ${rawVersion} is below minimum supported Python ${PYTHON_MIN_SUPPORTED.major}.${PYTHON_MIN_SUPPORTED.minor}.`,
    };
  }
  const key = `${mm.major}.${mm.minor}`;
  if ((PYTHON_TESTED_MINORS as readonly string[]).includes(key)) {
    return { tier: "tested", supported: true };
  }
  return { tier: "best-effort", supported: true };
}
