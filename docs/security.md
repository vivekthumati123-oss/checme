# Unit Agent Security Architecture & Known Limits

Unit Agent is designed around explicit trust boundaries separating untrusted code execution, Copilot SDK credentials, and repository write permissions.

## CI Multi-Job Trust Boundaries

| Job | Secrets Access | Repo Checkout | Network | Writes |
|---|---|---|---|---|
| `prepare` (`guard`, `plan`, `install`, `baseline`, `detect`, `notice`) | `GITHUB_TOKEN` (read-only + notices) | Yes (`persist-credentials: false`) | Runner/install only | None to git |
| `generate` / `repair` | `COPILOT_GITHUB_TOKEN` only | **None (zero checkout)** | Copilot SDK only | Draft JSON artifacts only |
| `validate` / `validate2` | **None (`secrets.*` absent)** | Yes (`persist-credentials: false`) | Optional `offline.strategy: unshare` on Linux | Disposable temp copy; pre-execution snapshots only |
| `publish` | `GITHUB_TOKEN` (`pull-requests: write`) | Minimal artifact/finalizer | GitHub API only | Sticky PR comment + `final.json` |
| `commit` | `GITHUB_TOKEN` or optional `COMMIT_PAT` | **None** | GitHub GraphQL/REST API only | Pushes validated snapshot after human `unit-agent-approval` |

## Key Controls

1. **Prompt Injection Defense:**
   - The Copilot SDK runs in isolated `generate`/`repair` jobs with no repository checkout and only the schema-validated `submit_tests` tool enabled (`excludedTools`/permission denials block shell, filesystem, and network tools).
   - Source files and sanitized failure excerpts are delimited as untrusted data blocks.

2. **Pre-Execution Snapshot Integrity & Deterministic Pruning (D25):**
   - Generated tests pass Path Safety (Gate 1) and AST Policy Gates (Gate 2) and optional formatting before ANY test runner executes.
   - Bytes are normalized for EOL (`files.eol`), stamped with provenance headers, hashed (SHA-256), and uploaded to `ua-snapshotN` **before** running a single generated test.
   - If failing tests are pruned after execution, `publish` and `commit` deterministically re-derive final bytes from the pre-execution snapshot via `deriveFinalContent(snapshot, prunedTests)` and verify `finalSha256`. A hostile test modifying its own file or `.unit-agent/` during execution cannot alter committed bytes (tampering exits `60`).

3. **Process Execution & Env Allowlist (`src/exec/exec.ts`):**
   - All subprocesses run via `execa` with `shell: false` and `extendEnv: false`. Shell metacharacters in config commands or file paths are rejected at load/gate time.
   - Environment variables pass an explicit non-secret allowlist (`PATH`, `SystemRoot`, `PATHEXT` on Windows, `LANG`/`LC_ALL`, optional proxy variables when `env.passProxy: true`, explicit `env.pass`), stripped by deny regexes matching `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `CREDENTIAL`, `AUTH`, `PAT`, `COOKIE`.
   - Timeouts terminate the entire descendant process tree cleanly on Windows (`taskkill /T /F`) and POSIX (`-pid` process group kill).

4. **Privacy, Secret Redaction & Comment Sanitization:**
   - `.env*`, credential/private-key files, and `privacy.neverSend` globs are skipped (`never_send`) before context assembly; high-entropy or PEM secret patterns skip with `secret_like_content`.
   - Logs, prompts, failure excerpts, and PR comments pass the sanitizer stripping tokens, runner absolute paths (`<REPO>`), ANSI sequences, env-like lines, `@mentions`, raw HTML tags (`<script>`), and raw external links.

5. **Fail-Closed Approval Gate:**
   - `publish` checks the `approval-environment` (`unit-agent-approval` by default) protection rules via GitHub API and sets `has_tests=false` with a warning whenever the Environment does not exist, has no required reviewers, or cannot be verified.

## Known Security Limits (Explicit Residual Risks)

Operators and developers must understand and accept these boundaries:

1. **Tests can read other files on the runner and the developer laptop:** Test runners execute with the OS user permissions of the CI runner (in `validate*` jobs) or the developer laptop (in `local validate`). Do not place host-level secrets in runner workspace files or run `local validate` on untrusted PR branches.
2. **The disposable project copy is not a security boundary:** `validate.workspace: copy` prevents accidental mutations to the checkout directory and `.unit-agent/` artifacts, but does NOT provide OS containerization or filesystem chroot isolation.
3. **Chat-mode instructions are not a sandbox:** Custom agent instructions in `.github/agents/unit-agent.agent.md` guide Copilot Chat behavior cleanly on trusted code, but a prompt-injected repository could still influence an interactive chat session holding terminal/edit tools. Always leave VS Code terminal approval prompts enabled and run CI (never `local` chat mode) on untrusted or external branches.
4. **The human reviewer reads the diff:** Automated gates eliminate known risky patterns, while semantic correctness, assertion quality, and mocking boundaries depend on human review before approval.

