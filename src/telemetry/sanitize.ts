import os from "node:os";

// eslint-disable-next-line no-control-regex
const OSC_RE = /(?:\u001b\]|\u009d)[\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const STRING_CTRL_RE = /(?:\u001b[PX^_]|[\u0090\u0098\u009e\u009f])[\s\S]*?(?:\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const CSI_RE = /(?:\u001b\[|\u009b)[\u0030-\u003f]*[\u0020-\u002f]*[\u0040-\u007e]/g;
// eslint-disable-next-line no-control-regex
const ESC_SEQ_RE = /\u001b[\u0020-\u002f]*[\u0030-\u007e]/g;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
// eslint-disable-next-line no-control-regex
const DISALLOWED_CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const BIDI_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Strip terminal escape sequences (OSC, DCS/PM/APC, CSI, charset/2-byte ESC),
 * carriage returns, disallowed C0/C1 control characters (preserving \n and \t),
 * and Unicode Bidi override/isolate characters.
 */
export function stripTerminalEscapesAndControls(input: string): string {
  return input
    .replace(OSC_RE, "")
    .replace(STRING_CTRL_RE, "")
    .replace(CSI_RE, "")
    .replace(ESC_SEQ_RE, "")
    .replace(ANSI_RE, "")
    .replace(/\r\n/g, "\n")
    .replace(DISALLOWED_CONTROL_RE, "")
    .replace(BIDI_RE, "");
}

export const SECRET_ENV_KEY_RE =
  /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|API_?KEY|ACCESS_?KEY_?ID|PRIVATE|(?:^|_)(?:AUTH|PAT|COOKIE)(?:$|_)|(?:^|_)KEY(?:$|_))/i;

export const EXPLICIT_FORBIDDEN_ENV_KEYS = new Set([
  "COPILOT_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "UA_COMMIT_TOKEN",
  "COMMIT_PAT",
]);

const EXPLICIT_FORBIDDEN_UPPER = new Set([...EXPLICIT_FORBIDDEN_ENV_KEYS].map((k) => k.toUpperCase()));

interface SecretPatternRule {
  pattern: RegExp;
  replacement: string;
}

const SECRET_VALUE_PATTERNS: readonly SecretPatternRule[] = [
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: "[REDACTED]" },
  {
    pattern:
      /-----BEGIN (?:[A-Z0-9 ]+ )?(?:PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?(?:PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g,
    replacement: "[REDACTED]",
  },
  { pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?(?:PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g, replacement: "[REDACTED]" },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: "[REDACTED]" },
  { pattern: /\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]{12,}\b/gi, replacement: "$1$2[REDACTED]" },
  { pattern: /((?:https?|ssh|ftp):\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, replacement: "$1[REDACTED]$3" },
  { pattern: /AccountKey=[A-Za-z0-9+/=]{20,}/g, replacement: "[REDACTED]" },
  { pattern: /\bATATT3[A-Za-z0-9_\-=]{20,}/g, replacement: "[REDACTED]" },
];

const ENV_LINE_RE = /^[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]{2,}=.+$/gm;

export interface SanitizeOptions {
  repoRoot?: string;
  workspaceRoot?: string;
  homeDir?: string;
  tmpDir?: string;
  extraSecrets?: readonly string[];
  parentEnv?: Record<string, string | undefined>;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacePathVariants(text: string, rawPath: string | undefined, placeholder: string): string {
  if (!rawPath || rawPath.length < 3) return text;
  const normalizedSlash = rawPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedBackslash = rawPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const flags = process.platform === "win32" ? "gi" : "g";
  let result = text;
  for (const variant of new Set([rawPath, normalizedSlash, normalizedBackslash])) {
    if (variant.length >= 3) {
      result = result.replace(new RegExp(escapeRegExp(variant), flags), placeholder);
    }
  }
  return result;
}

export function collectSensitiveEnvValues(env: Record<string, string | undefined> = process.env): string[] {
  const values = new Set<string>();
  for (const [key, val] of Object.entries(env)) {
    if (!val || val.trim().length < 6) continue;
    if (EXPLICIT_FORBIDDEN_UPPER.has(key.toUpperCase()) || SECRET_ENV_KEY_RE.test(key)) {
      if (val.length >= 6) values.add(val);
      const trimmed = val.trim();
      if (trimmed.length >= 6) values.add(trimmed);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function sanitizeOutput(input: string, opts: SanitizeOptions = {}): string {
  let out = stripTerminalEscapesAndControls(input);

  // Replace known runner / checkout / workspace / home / tmp directories (longest match first).
  const pathReplacements: Array<{ raw: string | undefined; placeholder: string; order: number; normLen: number }> = [
    { raw: opts.workspaceRoot, placeholder: "<WORKSPACE>", order: 0, normLen: 0 },
    { raw: opts.repoRoot, placeholder: "<REPO>", order: 1, normLen: 0 },
    { raw: opts.homeDir ?? os.homedir(), placeholder: "<HOME>", order: 2, normLen: 0 },
    { raw: opts.tmpDir ?? os.tmpdir(), placeholder: "<TMP>", order: 3, normLen: 0 },
  ].map((entry) => ({
    ...entry,
    normLen: entry.raw ? entry.raw.replace(/[/\\]+$/, "").length : 0,
  }));
  pathReplacements.sort((a, b) => b.normLen - a.normLen || a.order - b.order);
  for (const entry of pathReplacements) {
    out = replacePathVariants(out, entry.raw, entry.placeholder);
  }

  // Replace generic user home directories in paths we might not have explicitly named.
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/gi, "<HOME>");
  out = out.replace(/\/(?:home|Users)\/[^/\s"'`]+/g, "<HOME>");

  // Redact explicit and ambient secret values before dropping env lines.
  const secretValues = new Set<string>([
    ...collectSensitiveEnvValues(opts.parentEnv ?? process.env),
    ...(opts.extraSecrets ?? []).filter((s) => s.length >= 6),
  ]);
  for (const secret of [...secretValues].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]");
  }

  for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }

  // Remove env-looking KEY=VALUE lines (commonly emitted if a test dumps env).
  out = out.replace(ENV_LINE_RE, "[ENV_REDACTED]");

  return out;
}

export function capLastLines(text: string, maxLines = 200): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(-maxLines).join("\n");
}

export function capChars(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 20) return text.slice(0, maxChars);
  return `...[truncated]\n${text.slice(-(maxChars - 16))}`;
}

export function sanitizeLogTail(text: string, opts: SanitizeOptions = {}, maxLines = 200): string {
  return capLastLines(sanitizeOutput(text, opts), maxLines);
}

export function sanitizeFailureOutput(text: string, opts: SanitizeOptions = {}, maxChars = 4000): string {
  return capChars(sanitizeOutput(text, opts), maxChars);
}

/**
 * Neutralize markdown control chars, @mentions, issue references (#123), links and HTML
 * on model-originated strings before placing them in PR comments or step summaries.
 */
export function sanitizeForMarkdown(text: string, maxChars = 400, opts: SanitizeOptions = {}): string {
  let clean = sanitizeOutput(text, opts);
  // Collapse newlines into single spaces for inline table/bullet safety.
  clean = clean.replace(/[\r\n]+/g, " ").trim();
  // Iteratively convert nested markdown links `[label](url)` into plain text labels.
  let prev = "";
  for (let i = 0; i < 8 && clean !== prev; i += 1) {
    prev = clean;
    clean = clean.replace(/\[([^\]]*)\]\((?:[^()]+|\([^()]*\))*\)/g, "$1");
  }
  // Strip raw HTML tags iteratively while keeping sanitizeOutput path placeholders intact.
  prev = "";
  for (let i = 0; i < 8 && clean !== prev; i += 1) {
    prev = clean;
    clean = clean.replace(/<(?!REPO>|WORKSPACE>|HOME>|TMP>)[^>]*>/g, "");
  }
  // Defang remaining bare http(s):// URLs so GitHub does not auto-link them.
  clean = clean.replace(/\b(https?):\/\//gi, "$1:\u200B//");
  // Neutralize @mentions and issue #123 references with zero-width space.
  clean = clean.replace(/@/g, "@\u200B");
  clean = clean.replace(/#(\d+)/g, "#\u200B$1");
  // Escape remaining markdown formatting delimiters.
  clean = clean.replace(/([\\`*_[\]|<>])/g, "\\$1");
  if (clean.length > maxChars) {
    const budget = Math.max(0, maxChars - 3);
    clean = `${clean.slice(0, budget).replace(/\\+$/, "")}...`;
  }
  return clean;
}
