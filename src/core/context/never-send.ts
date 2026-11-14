import picomatch from "picomatch";

import { normalizeSlashes } from "../paths";

export const DEFAULT_NEVER_SEND_GLOBS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/secrets/**",
  "**/credentials*",
  "**/*credential*",
  "**/*secret*",
  "**/*token*",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.aws/**",
  "**/.ssh/**",
];

const CONTENT_SECRET_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "pem_private_key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { label: "github_pat", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { label: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: "openai_or_api_sk", pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  {
    label: "hardcoded_secret_assignment",
    pattern:
      /\b(?:api[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|password)\b\s*[:=]\s*["'][A-Za-z0-9/+_=-]{16,}["']/i,
  },
];

export function matchesNeverSendPath(repoRelPath: string, extraGlobs: readonly string[] = []): boolean {
  const norm = normalizeSlashes(repoRelPath).replace(/^\.\//, "");
  const patterns = [...DEFAULT_NEVER_SEND_GLOBS, ...extraGlobs];
  const matcher = picomatch(patterns, {
    dot: true,
    nocase: process.platform === "win32",
  });
  return matcher(norm);
}

export function detectSecretLikeContent(content: string): string | null {
  for (const { label, pattern } of CONTENT_SECRET_PATTERNS) {
    if (pattern.test(content)) {
      return label;
    }
  }
  return null;
}

export function checkNeverSend(
  repoRelPath: string,
  content: string,
  extraGlobs: readonly string[] = [],
): { blocked: true; reason: "never_send" | "secret_like_content"; detail: string } | { blocked: false } {
  if (matchesNeverSendPath(repoRelPath, extraGlobs)) {
    return {
      blocked: true,
      reason: "never_send",
      detail: `Path "${repoRelPath}" matches privacy.neverSend or built-in secret path filters.`,
    };
  }
  const secretHit = detectSecretLikeContent(content);
  if (secretHit) {
    return {
      blocked: true,
      reason: "secret_like_content",
      detail: `File "${repoRelPath}" matched secret-like pattern (${secretHit}).`,
    };
  }
  return { blocked: false };
}
