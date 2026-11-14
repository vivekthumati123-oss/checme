export function maskSecret(value: string | undefined, stdout: NodeJS.WriteStream = process.stdout): void {
  if (!value || value.length === 0) return;
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const line of value.split(/\r?\n/)) {
      if (line.length > 0) {
        stdout.write(`::add-mask::${line}\n`);
      }
    }
  }
}

export function maskStartupSecrets(env: Record<string, string | undefined> = process.env): void {
  for (const key of [
    "COPILOT_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "UA_COMMIT_TOKEN",
    "COMMIT_PAT",
    "UNIT_AGENT_COMMIT_PAT",
  ]) {
    maskSecret(env[key]);
  }
}
