// Fails CI when a tracked file looks like it contains a GitHub token or a private key,
// or when an env file other than .env.example is tracked.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const TOKEN_RE = /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/;
const KEY_RE = /-----BEGIN (?:[A-Z0-9 ]+ )?(?:PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/;
const ALLOW = [/^fixtures\/logs\//, /^evals\//, /^test\//];
const problems = [];
for (const f of files) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example")) problems.push(`${f}: env file is tracked`);
  if (ALLOW.some((re) => re.test(f))) continue;
  if (/\.(png|jpg|wasm|bin|zip|lock|map)$/i.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (TOKEN_RE.test(text)) problems.push(`${f}: looks like a GitHub token`);
  if (KEY_RE.test(text)) problems.push(`${f}: contains a private key`);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`check-secrets: ${files.length} tracked files clean`);
