# `.unit-agent.yml` Configuration Reference

`.unit-agent.yml` lives at the root of each consumer repository. Add the YAML language-server header on line 1 for editor autocompletion and validation against `schema/unit-agent.schema.json`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/your-org/unit-agent/v1/schema/unit-agent.schema.json
version: 1
mode: report
```

Validate any config before committing with:

```bash
node dist/cli.js config check --config .unit-agent.yml
```

## Top-Level Fields

| Field | Type / Enum | Default | Notes |
|---|---|---|---|
| `version` | `1` (literal) | required | Must be `1`. |
| `mode` | `"report" \| "propose"` | `"report"` | `report` posts comments only; `propose` gates human-approved commits behind `unit-agent-approval`. |
| `model` | `string` | optional | Optional Copilot SDK model identifier override. |
| `exclude` | `SafePath[]` | `["**/generated/**", "**/*.d.ts", "**/migrations/**", "**/node_modules/**", "**/vendor/**"]` | Glob exclusions; `..` traversal segments are rejected. |

## `limits`

| Field | Constraints | Default | Description |
|---|---|---|---|
| `maxSymbolsPerPr` | int `1..30` | `10` | Maximum ranked symbols selected per run. |
| `maxFilesPerPr` | int `1..15` | `6` | Maximum source files selected per run. |
| `maxTestsPerSymbol` | int `1..12` | `6` | Maximum tests per symbol hint passed in generation prompts. |
| `maxContextChars` | int `>=1000` | `60000` | Context character budget per file before trimming (`styleSample`, `classSkeleton`, then `maxTestsPerSymbol`). |
| `minExecutableLines` | int `>=0` | `2` | Minimum executable lines required for symbol eligibility. |
| `runTimeoutMinutes` | int `>=1` | `25` | Overall run budget in minutes. |
| `repairAttempts` | int `0..1` | `1` | Maximum CI repair iterations (set `0` to prune failing tests directly after attempt 1). |
| `flakeRuns` | int `1..5` | `3` | Consecutive test runner executions required for flake detection. |
| `perRunTestTimeoutSeconds` | int `>=1` | `180` | Per-invocation timeout for test commands inside validation. |
| `maxRequestsPerRun` | int `1..60` | `20` | Hard Copilot SDK request cap per run; excess files stop with `over_request_budget`. |

## `baseline`, `targets`, `policy`, `validate`

- **`baseline`**:
  - `mode`: `"run" | "skip"` (default `"run"`).
  - `timeoutMinutes`: int `1..60` (default `20`). Exceeding timeout kills the process tree and falls back cleanly to `no_coverage` mode.
- **`targets`**:
  - `patchCoverage`: number `0..100` (default `80`). Advisory patch coverage goal.
  - `symbolCoverageThreshold`: number `0..100` (default `60`). Symbols already at or above this coverage % are skipped unless `--include-covered` is passed locally.
- **`policy`**:
  - `extraBannedImports`: `Record<string, string[]>` (default `{}`). Extra disallowed module prefixes per language added on top of built-in security rules.
  - `dropZeroGainFiles`: `boolean` (default `true`). Rejects generated test files that add zero newly covered lines when coverage is enabled.
  - `provenanceHeader`: `boolean` (default `true`). Prepends `// unit-agent:generated` (JS/TS/Java) or `# unit-agent:generated` (Python) before hashing.
- **`validate`**:
  - `workspace`: `"copy" | "inplace"` (default `"copy"`). `"copy"` executes inside a disposable OS temp copy (`unit-agent-val-*`); `"inplace"` places files temporarily in the working tree with `placed.json` crash recovery.
  - `maxCopyMB`: int `50..5000` (default `500`). Size limit for disposable copies (`sandbox_copy_failed` if exceeded).

## `env`, `files`, `privacy`, `offline`, `commit`, `local`

- **`env`**: `pass` (`string[]`, default `[]`) explicit non-secret allowlisted variables forwarded to child processes; `passProxy` (`boolean`, default `true`) forwards `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`. Secret-shaped env names matching deny regexes are always stripped.
- **`files`**: `eol` (`"auto" | "lf" | "crlf"`, default `"auto"`). Normalized before snapshot SHA-256 computation.
- **`privacy`**: `neverSend` (`SafePath[]`, default `[]`). Additional sensitive globs skipped with `never_send` on top of `.env*`, credentials, and key files.
- **`offline`**: `strategy` (`"none" | "unshare"`, default `"none"`). Linux-only network namespace isolation (`unshare` is rejected with `languages.java.buildTool: gradle`).
- **`commit`**: `auth` (`"github_token" | "pat"`, default `"github_token"`). `"pat"` reads `COMMIT_PAT` (`UNIT_AGENT_COMMIT_PAT` secret).
- **`local`** (local/chat front end only):
  - `baseRef` (`string`, optional): overrides `refs/remotes/origin/HEAD` / `main` default branch detection.
  - `stagingDir` (`SafePath`, default `".unit-agent/chat/proposed"`).
  - `maxRepairIterations` (`0..3`, default `2`).
  - `reuseCoverage` (`boolean`, default `true`).
  - `confirmBeforeRun` (`boolean`, default `true`).
  - `stageApplied` (`boolean`, default `false`).
  - `nodeCommand` (`string`, default `"node"`).
  - `chatTools` (`string[]`, default `["read", "edit", "search", "execute"]`).

## `languages.<javascript | python | java>`

At least one language must be configured with `enabled: true`.

| Field | Applicable To | Description |
|---|---|---|
| `enabled` | all | Boolean (default `true`). |
| `framework` | all | `"auto" | "jest" | "vitest" | "pytest" | "junit5"`. Unsupported frameworks fail fast cleanly with `unsupported_framework`. |
| `workingDirectory` | all | `SafePath` (default `"."`). Subdirectory for monorepos (`packages/app`). Contracts stay repo-root-relative with `/` separators. |
| `toolchain` / `toolchainFile` | all | Optional explicit version or file path; if both are set, `toolchain` takes precedence and `config check` emits a warning. |
| `installCommand` | all | Argv-only command (no shell operators). |
| `testCommand` | all | Required argv-only command. |
| `coverageFile` | all | Required coverage output path (`SafePath`). |
| `coverageFormat` | all | Required `"lcov" | "cobertura" | "jacoco"`. |
| `sourceGlobs` | all | Required non-empty array of `SafePath` source globs. |
| `testPathPatterns` | all | Required non-empty array of `SafePath` path templates. |
| `generatedSuffix` | all | Suffix used when resolving filename collisions (default `".unit-agent"`). |
| `formatCommand` / `lintCommand` | all | Optional argv-only commands containing `{files}` placeholder. |
| `pythonPath` | python | Optional `SafePath[]` overrides for module root discovery. |
| `buildTool` | java | `"auto" | "maven" | "gradle"` (default `"auto"` -> fails with `ambiguous_build_tool` if both `pom.xml` and `build.gradle*` exist). |
| `toolPreference` | java | `("wrapper" | "system")[]` (default `["wrapper", "system"]`). |
| `strictWrapper` | java | `boolean` (default `false`); if `true`, unreachable wrapper fails with `wrapper_unavailable` instead of falling back visibly to system tool. |
| `distribution` | java | JDK distribution (default `"temurin"`). |
| `testResultsDir` | java | Optional Surefire/Gradle XML results directory override. |
| `coverage.mode` | java | `"auto" | "repo" | "inject" | "off"` (default `"auto"`). |
| `coverage.jacocoVersion` | java | Optional pinned JaCoCo version string when using `inject` or `auto` injection. |

## Path Template Placeholders

`testPathPatterns` supports:
- `{dir}`: source file directory relative to repo root (`src/orders`)
- `{name}`: source file stem without extension (`discount`)
- `{Name}`: Java primary class name or PascalCase file stem (`DiscountService`)
- `{package}`: Java package declared inside the source file converted to `/`-separated path (`com/acme/orders`)
- `{ext}`: source file extension without leading dot (`ts`)

On filename collisions with non-agent tests:
- JS/TS preserves `.test.<ext>` / `.spec.<ext>` (`discount.unit-agent.test.ts`).
- Python appends `_agent` (`test_discount_agent.py`) so pytest test collection remains valid.
- Java appends `AgentTest.java` (`DiscountServiceAgentTest.java`).
- Existing files starting with `// unit-agent:generated` or `# unit-agent:generated` skip duplicate generation (`already_has_agent_tests`).

## Argv Tokenizer Rules & Cross-Checks

All commands (`installCommand`, `testCommand`, `formatCommand`, `lintCommand`) are tokenized safely without a shell (`execa`, `shell: false`):
- Quotes (`"..."`, `'...'`) and Windows paths (`\` outside quote escapes when non-special) are preserved cleanly.
- Shell metacharacters/operators `&&`, `||`, `|`, `;`, `>`, `<`, `` ` ``, `$()` are rejected at load time.
- Cross-checks enforced at load:
  1. `offline.strategy: "unshare"` cannot be combined with `languages.java.buildTool: "gradle"`.
  2. At least one language under `languages` must be enabled.
  3. `formatCommand` and `lintCommand` must contain `{files}`.
  4. Paths with `..` traversal segments are rejected everywhere (`SafePath`).

