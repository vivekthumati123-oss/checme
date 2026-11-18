import { collectSensitiveEnvValues } from "./sanitize";

export function maskSecret(value: string | undefined, stdout: NodeJS.WriteStream = process.stdout): void {
  if (!value || value.length === 0) return;
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const rawLine of value.split(/\r?\n/)) {
      const variants = new Set([rawLine, rawLine.trim()]);
      for (const v of variants) {
        if (v.length >= 6) {
          stdout.write(`::add-mask::${v}\n`);
        } else if (v.length > 0 && rawLine === v) {
          stdout.write(`::add-mask::${v}\n`);
        }
      }
    }
  }
}

export function maskStartupSecrets(env: Record<string, string | undefined> = process.env): void {
  const seen = new Set<string>();
  for (const key of [
    "COPILOT_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "UA_COMMIT_TOKEN",
    "COMMIT_PAT",
    "UNIT_AGENT_COMMIT_PAT",
  ]) {
    const val = env[key];
    if (val) {
      seen.add(val);
      maskSecret(val);
    }
  }
  for (const val of collectSensitiveEnvValues(env)) {
    if (!seen.has(val)) {
      seen.add(val);
      maskSecret(val);
    }
  }
}
