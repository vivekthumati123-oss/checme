/**
 * Dependency-free classification of Copilot SDK / HTTP failures.
 * Only genuine credential problems count as auth errors; rate limits, quota,
 * and unrelated messages that merely mention "token" must not become exit 40.
 */
const RATE_LIMIT_RE = /\b(rate[\s_-]?limit(?:ed)?|too many requests|429|quota|secondary rate)\b/i;

const AUTH_RES: readonly RegExp[] = [
  /\b401\b/,
  /\bunauthori[sz]ed\b/i,
  /\bbad credentials\b/i,
  /\bauthori[sz]ation (?:error|failed|required)\b/i,
  /\bauthentication (?:error|failed|required)\b/i,
  /\b(?:invalid|expired|revoked)\b[^.\n]{0,40}\b(?:token|credentials?)\b/i,
  /\b(?:token|credentials?)\b[^.\n]{0,40}\b(?:invalid|expired|revoked)\b/i,
  /\b403\b[^.\n]{0,60}\b(?:forbidden|not authori[sz]ed|resource not accessible)\b/i,
];

export function isAuthErrorMessage(msg: string): boolean {
  if (RATE_LIMIT_RE.test(msg)) return false;
  return AUTH_RES.some((re) => re.test(msg));
}
