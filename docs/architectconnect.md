# ArchitectConnect

ArchitectConnect is a draft L2 agent backed by the migrated deterministic architecture engine. It supports local folders, normalized in-memory source records, HTTP SCM Bridge acquisition, and direct GitHub acquisition. No model call is required for analysis or generation. The owner has removed both legacy project folders; draft status remains pending activation review.

## Local Execution

From the platform checkout, run a dry run against an existing local source folder:

```powershell
npm run agent:architectconnect -- --local agents/node/codeconnect
```

The CLI resolves its platform binding from its installed location, not the caller's working directory. Local source paths are resolved from the caller's directory. Report writes require an explicit application workspace and `--apply`:

```powershell
npm run agent:architectconnect -- --local "D:\repos\application" --workspace "D:\repos\application" --output docs/hld/review-001 --apply
```

Use a new output directory for each accepted run. Existing reports are never overwritten. `AGENT_DRY_RUN=true` prevents writes even with `--apply`. `APPLICATION_WORKSPACE` can supply the application workspace instead of `--workspace`.

## SCM Execution

SCM Bridge remains an independently deployed HTTP dependency; its former local source folder has been removed by the owner. Configure its provider credentials in the bridge process, not in the architecture request. HTTP mode still requires a reachable bridge; local and direct-GitHub modes do not. The migrated CLI accepts a full HTTPS repository URL without embedded credentials, query parameters, or fragments:

```powershell
$env:SCM_BRIDGE_URL = "http://localhost:3000"
npm run agent:architectconnect -- "https://github.com/OWNER/REPOSITORY" --workspace "D:\repos\application"
```

`--bridge-url` overrides the environment setting. Configuration is resolved after platform environment loading; the client does not capture environment values at import time. HTTP errors retain status but exclude response bodies. Missing content is reported as incomplete acquisition. No live SCM provider has been validated in this migration slice.

## Direct GitHub

```powershell
npm run agent:architectconnect -- --github OWNER/REPOSITORY --workspace "D:\repos\application"
```

This mode uses Octokit directly and does not require the HTTP bridge. Configure `GITHUB_TOKEN` through the platform environment; never put a token in an argument. Default branch, tree SHA, safe tree entries, relevant blobs and root package content are preserved. Truncated trees and missing blobs are reported as incomplete evidence. Live provider validation is deferred by owner choice; maintained tests use injected clients.

## Chat and Distribution

Select the custom agent defined in [architectconnect.agent.md](../.github/agents/architectconnect.agent.md), which uses the `architectconnect` skill. VS Code discovers `.agent.md` files, not a plain `architectconnect.md` file. The L2 binding and draft design bundle reference this named agent directly; the existing `hld-agent` remains available. Configure `L2_PLATFORM_ROOT` to the platform checkout. The skill launcher invokes the installed engine and uses the caller workspace unless explicitly supplied otherwise.

The existing draft `sdlc-design` bundle includes this skill. Marketplace packaging ships customizations and the launcher, not the Node engine. The receiving machine must have a configured platform checkout and its workspace dependencies. No runtime is downloaded automatically, and the bundle has not been published by this migration.

## Artifacts and Safety

Each accepted run prepares three artifacts under `docs/hld/<run-name>/`:

- `ArchitectureReport.md`: native HLD plus a Mermaid rendering of the same selected architecture.
- `architecture.dsl`: native Structurizr output.
- `ArchitectureDecisions.json`: the generator's proposed ADR candidate array, preserving its fields rather than inventing historical rationale.

The platform result contains HLD-compatible `path`, `content`, and `summary` fields in `data`, plus findings, selection/fallback metadata, source, acquisition warnings, and validation state. Stdout is one JSON result; structured lifecycle diagnostics go to stderr. The serialized data is guard-checked before it can be emitted.

File policy and hooks apply in both dry-run preflight and persistence. Writes fail closed on denial, required approval, missing hooks, or hook execution errors. Paths must remain under `docs/hld/`; traversal, credential paths, symlinked workspaces/parents, duplicate paths, empty artifacts, and existing output files are rejected. File creation uses exclusive mode. Commits, PRs, and work-item writes are denied.

Use a stable, trusted local checkout: symlink checks do not establish protection against an adversary concurrently changing filesystem ancestors. Persistence is not a transaction across all three artifacts; a filesystem failure can leave earlier files saved. Inspect the directory after a failed apply and choose a fresh output directory for recovery rather than overwriting.

Local acquisition omits credential files, dependency/build directories, and symlinks, and enforces file-count and individual-file-size limits. Analyzer support remains heuristic and unchanged; collecting Java/Gradle files does not establish Java analysis support.

Generated is not the same as saved, grammar-valid, or semantically reviewed. By default both grammars remain unverified. `--validate` runs local parsers; `--require-validated` rejects the run before persistence unless both pass. The Mermaid parser is isolated in a strict-mode process with a deadline and without provider credentials. Structurizr requires Java 21 and a trusted official WAR configured through `STRUCTURIZR_WAR`; `JAVA_EXECUTABLE` selects a non-default Java executable. Its Java-backed command compatibility and actual DSL validation have not been exercised on this machine. Temporary parser input is guard-checked and removed after use.

The current machine verifies Mermaid grammar, but leaves Structurizr unverified because Java/WAR are unavailable. An official portable Java download could not be checksum-verified; no downloaded runtime was extracted or executed, and system PATH was not changed. Parser success does not replace semantic review. Mermaid omits ambiguous or unresolved endpoints and reports their count; the original relationships remain in findings and native DSL.

## Verification and Migration State

```powershell
npm run test:architectconnect
node scripts/eval.js --agent architectconnect
npm run validate
npm run check
```

Current migration evidence:

- 29 active engine modules inventoried; 28 mechanically converted to ESM, with the selector adapted and tested separately. The source/converted checksums are in [the engine receipt](migration-archive/architectconnect/engine-receipt.json).
- Legacy-versus-migrated comparison passed for empty, Express, FastAPI, and worker fixtures: scanner findings, HLD/DSL strings, and ADR arrays matched.
- 37 runtime unit tests and six discovery/integration tests pass, including named-agent binding and packaging, caller-cwd separation, guarded persistence, overwrite refusal, strict validation, and a source-only isolated platform with fresh offline dependencies and no original workspace links. Four archive-tool tests also pass.
- Three architecture evals pass: fallback/validation reporting, Python evidence, and source-instruction isolation.
- Final post-removal `npm run check` passes: 93/93 tests and 7/7 eval cases, with zero validation errors and three existing warnings about other active agents lacking eval declarations. The named agent, packaged launcher, real CLI writes and isolated dependency installation are verified with both legacy folders absent. The two baseline Windows failures were repaired with owner approval; denial assertions were retained and native-shell execution is checked.
- Added runtime dependency `@octokit/rest` and optional parser dependencies `mermaid` (pinned to patched `11.17.2`) and `jsdom` (`26.1.0`), with the root lockfile updated. No browser or system Java runtime was installed. npm audit reports two low-severity findings in the optional Mermaid/KaTeX chain and no moderate/high/critical findings; no forced major upgrade was applied.

The binding remains draft. MCP retirement was approved; original source and its transport contract are preserved in [the migration archive](migration-archive/architectconnect/README.md). A recoverable Architect Connect snapshot of 58 text files and per-file dispositions is verified after removal. The owner removed `Architect Connect/`, `scm-bridge-clone/` and the old handoff; final offline validation passed against the remaining workspace. The Architect Connect archive does not claim to back up SCM Bridge or owner-managed credentials. Structurizr grammar, live provider validation, final owner acceptance and activation remain open.

The [migration plan](architectconnect-migration-plan.md) controls activation and removal. Before deleting the temporary folder, retain a recoverable non-secret source snapshot and account for unique backups, examples, reports, and local configuration. Do not rely on Git to recover currently untracked sources. Migration tooling deliberately references the temporary source; runtime modules and launchers do not import or execute it.