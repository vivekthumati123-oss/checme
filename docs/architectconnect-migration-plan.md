# Architect Connect Migration and Adaptation Plan

Date: 2026-10-10. Status: offline migration implemented; draft retained for final owner review.

## Implementation Progress

- Phase 1: baseline recorded (44/46 original tests passed). Recoverable snapshot of 58 text files, active-engine checksums, per-file dispositions and exclusions are verified. Credentials/generated metadata are not copied; the original folder was subsequently removed by the owner.
- Phase 2: 29 active engine modules inventoried and migrated. Offline comparison against the legacy engine passed for empty, Express, FastAPI and worker fixtures, including findings, HLD/DSL strings and ADR arrays.
- Phase 3: draft workspace, binding/policy, local/HTTP SCM/direct-GitHub acquisition, guarded persistence, existing HLD agent, chat skill and CLI implemented. The standalone CLI uses shared request/context/lifecycle APIs with explicit platform binding lookup rather than the GitHub-event-only `runAgent` helper. MCP retirement is approved and its contract archived. No agent instructions are copied into runtime strings.
- Phase 4: final post-removal `npm run check` passes all 93 tests and seven evals, including 43 ArchitectConnect tests and four archive-tool tests. Named-agent discovery/packaging, real Mermaid parsing and strict persistence gates are verified; Windows hook failures were repaired with owner approval, retaining assertions. Structurizr remains unverified: Java/WAR are unavailable, and a temporary official Java download could not be checksum-verified, so no downloaded runtime was executed. Live SCM checks are explicitly deferred.
- Phase 5: the owner removed both legacy project folders. Final offline validation passed with those folders absent, including actual CLI persistence, packaged-launcher execution and source-only isolated verification with fresh offline dependencies and no original workspace links. The 58-file archive verifies after removal. Because migration files are untracked, this verifies intended source rather than a committed checkout. The named ArchitectConnect agent is bound and packaged; activation and publication have not occurred.

Usage, limitations and migration evidence: [ArchitectConnect guide](architectconnect.md). Proposed ADR candidates are persisted as JSON arrays; native generator contracts are unchanged.

## Objective and Scope

Migrate the deterministic architecture engine out of the temporary `Architect Connect/` folder into the existing L2 platform. Preserve the repository's top-level structure and existing agents. Delete the temporary folder only after capability preservation, legacy-independent execution, and owner acceptance are demonstrated.

The original handoff was used for planning and was subsequently removed by the owner. The retained source inventory and contract record are in [the migration archive](migration-archive/architectconnect/README.md).

Included: scanner, complete analyzer dependency graph, architecture selection, repository loading, HLD/Structurizr/proposed ADR generation, L2 execution, chat invocation, guarded persistence, tests, and packaging integration.

Not included: migrating or deleting `scm-bridge-clone/`, changing SCM provider interfaces, adding provider writes or automatic webhook reanalysis, deploying services, or rewriting unrelated agents. SCM Bridge remains an independently configured HTTP dependency. Its SDK metadata agent is not Architect Connect.

## Verified Target Constraints

- [Root manifest](../package.json) already declares `agents/node/*` and `packages/node/*` workspaces and ESM. No monorepo restructuring is needed.
- At planning time, the [ArchitectConnect binding](../l2/architectconnect.json) was `planned` and referenced an absent entry point. It is now `draft` with a migrated implementation; the [runtime runner](../packages/node/agent-runtime/src/run-agent.js) rejects planned bindings.
- The binding initially reused `hld-agent`. At the owner's request it now uses the discoverable [architectconnect agent](../.github/agents/architectconnect.agent.md), preserving `{path, content, summary}` and selected-model Mermaid reporting. The original HLD agent is retained.
- [Default policy](../configurations/policies/default.yaml) denies file writes. Activation needs an explicit output policy; inheriting this policy will not make report persistence work.
- [CodeConnect](../agents/node/codeconnect/src/codeconnect-agent.js) demonstrates `BaseAgent.validate`, `perform`, `createAgentResult`, policy evaluation, and hook checks. Reuse the actual APIs, not a new agent framework.
- [Bundles](../bundles.json) already include `hld-agent` in draft `sdlc-design`. [Packaging](../scripts/package.js) copies customizations, not Node workspace implementations, and excludes draft bundles by default.
- `runtime.package` is optional in the current schema and validator. Declare it for workspace consistency, but do not describe its absence as an existing schema failure.
- The temporary projects and handoff were untracked before the owner removed them. The verified Architect Connect snapshot provides recovery for archived non-secret files; it does not establish recoverability of SCM Bridge or credentials.

## Recommended Destination

Add one agent workspace, retaining the engine's internal relative layout to minimize migration risk:

```text
agents/node/architectconnect/
  package.json                       @l2/agent-architectconnect; type: module
  src/
    index.js                         runAgent CLI adapter
    architectconnect-agent.js        BaseAgent validation/orchestration
    artifact-writer.js               policy/hook-checked persistence
    engine/
      repositoryScanner.js
      hldGenerator.js
      structurizrGenerator.js
      adrGenerator.js
      services/
      models/
      analyzers/                     dependencies, discovery, node, python
.github/skills/architectconnect/
  SKILL.md                           short chat execution procedure
  scripts/run.mjs                    launcher for configured L2 checkout
configurations/policies/architectconnect.yaml
tests/unit/agents/node/architectconnect/  mirrors migrated source modules
tests/node/architectconnect.integration.test.js
evals/architectconnect/
docs/architectconnect.md
docs/migration-archive/architectconnect/  selected non-secret historical material
```

This target layout is now implemented beneath the existing directories. Archive material is stored as verified source-snapshot/disposition JSON, not executable legacy modules. Keep the engine private to this workspace; introduce a shared `packages/node/` engine only if another real consumer needs it.

## Source-to-Target Mapping

| Temporary source | Target and treatment |
| --- | --- |
| `repositoryScanner.js`, HLD/DSL/ADR generators | Copy into `src/engine/`; convert CommonJS imports/exports to ESM without changing analysis semantics. |
| Complete active `analyzers/` and `models/` trees | Copy into matching `src/engine/` subdirectories, preserving the dependency graph; exclude historical backup files from runtime exports. |
| `services/architectConnectService.js` | Adapt in `src/engine/services/`; preserve selected findings for all generators; inject acquisition/config/logger rather than loading a nested credential file. |
| `services/scmBridgeClient.js`, loader, file selector | Adapt together in `src/engine/services/`; preserve HTTP names/envelopes, default branch, selected paths, file normalization, and root-package handling. |
| `reportGenerator.js` | Replace with guarded `artifact-writer.js`; preserve nonempty-output checks but remove implicit current-directory writes. |
| Nested agent and Copilot instructions | Merge evidence, fallback, reporting, and execution requirements into root `hld-agent` and the new skill. Do not copy `target`, model pins, or agent prose into JavaScript. |
| `testService.js` | Rewrite as the L2 CLI entry point accepting a full repository URL; remove owner/repository argument ambiguity. |
| `githubConnector.js`, `localConnector.js` | Preserve direct-GitHub and local acquisition through injectable adapters where required; replace fixed repository choices and machine-specific paths with explicit input. |
| `architectConnectMcpServer.js` | Preserve tool-result mapping in archive documentation; replace chat execution with the L2 launcher. MCP transport retirement is an explicit acceptance item, not a silent compatibility claim. |
| SDK smoke script, integration/demo runners | Keep relevant examples under `examples/local/` and convert useful cases into offline maintained tests. Archive redundant demonstrations with prerequisites recorded. |
| Backups and existing HLD/DSL/ADR samples | Archive only selected non-secret material with original path, checksum, and historical/generated status. Never overwrite them with fresh outputs. |
| Nested package/lockfile, editor settings, `.git`, `src/` | Do not transplant wholesale. Reconcile dependencies into the new workspace/root lockfile; document useful editor configuration; empty `src/` has no engine to migrate. |
| Credential files, dependency directories, caches | Never copy or commit. The owner retains any needed local secrets outside the temporary folder before deletion, without exposing their values. |

## Contracts and Deliberate Adaptations

1. **Deterministic authority:** preserve `analyzeRepositoryContents(contents, packageContent, metadata)`. Analysis and report generation must not depend on an LLM inventing a model. Optional narrative enhancement must remain visibly proposed and separately validated.
2. **Architecture selection:** preserve dynamic validation, legacy fallback, `source`, `fallbackUsed`, `reason`, evidence, gaps, assumptions, recommendations, and score. Empty APIs alone must not invalidate a valid model. HLD, DSL, and ADRs must all receive the same selected findings.
3. **Output compatibility:** retain the existing HLD automation `{path, content, summary}` core fields. Define optional artifact/selection metadata explicitly in the agent contract. Wrap execution in the platform result envelope via `createAgentResult`; distinguish that envelope from the HLD document payload. Chat writes requested outputs and summarizes actual validation.
4. **Diagram reconciliation:** preserve native Structurizr generation. Satisfy the existing Mermaid HLD requirement with a small renderer over the same selected architecture, with identifier escaping and fixture tests. Do not silently replace Structurizr or invent relationships. Report per-format generation and validation separately.
5. **Acquisition:** authorize `repository.read` before loading. Retain the HTTP SCM path; keep direct/local adapters explicit and test their normalization. Existing `context.scm` is not evidence of four-provider parity and must not silently replace SCM Bridge. Label source/ref and surface missing files rather than declaring complete coverage.
6. **Configuration:** pass `SCM_BRIDGE_URL` explicitly when constructing the client, after platform environment loading. Do not capture it at import time. Keep provider tokens in the bridge for HTTP mode; avoid logging credentials, raw private source, or request headers. Direct mode uses platform-configured credentials without transporting legacy credential files.
7. **Writes:** use an explicit application workspace and output directory, not the platform checkout or process cwd by accident. Validate normalized relative paths, traversal, credential paths, and symlink escape. Respect policy denial and required approval, invoke hooks before every write, and implement dry-run with no report writes. No commits, PRs, or work-item writes by default.
8. **Logging and validation:** replace source stdout debugging with redacted logger diagnostics. Automation stdout must remain one JSON result. Generated strings, successfully saved files, grammar-valid DSL, and semantically reviewed architecture are distinct states.
9. **Dependencies:** declare only retained dependencies in the workspace manifest. Drop MCP/SDK packages from this agent if their entry points are retired; retain Octokit only for direct GitHub acquisition. Declare any new Mermaid/Structurizr validation dependency and verify supported Node versions. Do not inherit the temporary manifest's dependency versions without resolving them.

## Phased Execution and Acceptance Gates

### Phase 1: Baseline and Recoverability

- Record the current `npm run check` result and existing unrelated failures before implementation.
- Inventory active module imports and classify every temporary file as migrated, adapted, archived, or explicitly retired. Record a non-secret, recoverable source snapshot and checksums; do not archive credential files or nested Git internals.
- Create in-memory Node/Express, Python/FastAPI, no-HTTP-API, and fallback fixtures. Capture old-engine findings and generated strings through `analyzeRepositoryContents`, without live services or overwriting samples.
- Agree on MCP retirement, direct/local acquisition retention, output paths, overwrite behavior, and preservation of unique historical artifacts before destructive cleanup.

Gate: an executable baseline covers selection and all three generators, and every source group has a disposition. No folder deletion.

### Phase 2: Engine Migration

- Add the workspace package and copy active engine groups in small increments; convert ESM boundaries and explicit `.js` imports locally.
- Separate acquisition, environment loading, logging, and persistence from deterministic analysis. Remove the stale DSL-input comment while retaining actual selected-model behavior.
- Run each focused parity test immediately after migrating its slice. Compare normalized semantic findings and output content, allowing only documented formatting/configuration changes.

Gate: offline fixture parity passes for dynamic selection, no-API validity, legacy fallback, evidence, and HLD/DSL/proposed ADRs. No imports reach back into the temporary folder.

### Phase 3: L2 and Chat Integration

- Implement the `BaseAgent` adapter, CLI input validation, platform result contract, optional Mermaid rendering, and guarded writer. Reuse suitable existing helpers only after checking their path and approval behavior.
- Update `l2/architectconnect.json` with workspace package, explicit outputs/config, policy, skill, and eval references. Keep it planned until implementation exists; use draft for validation, then active only after acceptance gates pass.
- Adapt the existing `hld-agent` instructions and add the execution skill with least-privilege tools. A packaged launcher locates a configured platform checkout and caller workspace; it must not auto-download code or assume the plugin contains the runtime.
- Add the root `agent:architectconnect` command and update the existing draft `sdlc-design` bundle's skill list. Do not publish the bundle merely to test it.

Gate: local fixture CLI and chat launcher work from a different cwd, dry-run produces no reports, denial/approval/hook cases are enforced, and automation output parses as one JSON value.

### Phase 4: Verification and Distribution

- Add focused offline tests under the existing Node test suite: HTTP response envelopes and default branch, normalization and root package, selection parity, missing-file/error behavior, output path safety, denied writes, secret redaction, and legacy-independent subprocess execution.
- Add eval cases for unsupported evidence, prompt injection in repository content, fallback reporting, and distinguishing generated from validated artifacts. Follow repository testing conventions when implementing these files.
- Run the focused tests, `npm run validate`, and `npm run check`. Run catalog/build checks when their inputs change. Inspect draft packaging with `--include-drafts` in a dedicated disposable output location; the packaging script removes its output directory, so never point it at source or user artifacts.
- Validate Structurizr with an agreed parser/tool before claiming grammar validity; otherwise report it as generated but unvalidated. Record semantic review separately.
- Run authorized live SCM analysis against a known repository only when bridge connectivity and credentials are available. Validate each provider claimed; offline fixtures do not certify live provider parity. No Copilot SDK session is required by the deterministic CLI.

Gate: required checks pass without weakening tests, packaged customization resolves the configured runtime, and remaining live/platform limitations are explicitly accepted. Add an Actions workflow only if remote automation is required, using existing workflow conventions.

### Phase 5: Cutover and Temporary-Folder Removal

- Document configuration, CLI/chat usage, source modes, artifact paths, dependency changes, migration receipts, rollback, and unverified integrations in `docs/architectconnect.md`.
- Audit runtime imports, launch commands, tests, configuration, and packaged launchers for temporary-folder dependencies. Historical references in migration documents are allowed; executable references are not.
- Demonstrate the migrated tests and CLI with the legacy path unavailable using an isolated checkout containing only migrated tracked files. Do not rename or remove the user's original folder merely to probe independence.
- Obtain owner acceptance of capability changes, unique-file dispositions, retained local configuration, and the final removal. Delete only `Architect Connect/`, never `scm-bridge-clone/` or unrelated paths.
- Rerun focused CLI/tests and `npm run check` after removal. Preserve the migration receipt and recoverable non-secret snapshot until the cutover is accepted.

Gate: the temporary folder is absent, no executable dependency remains, and the retained project structure runs independently. If any gate fails, keep the legacy folder and repair the migrated slice; do not reset unrelated user changes.

## Completion Definition

Completion means the existing L2 platform hosts ArchitectConnect, its deterministic capabilities and selected-model contracts are preserved, chat and CLI execute the migrated implementation, writes are guarded, output validation is accurately reported, and the temporary folder can be removed without loss of unique non-secret source. SCM Bridge remains separate and unchanged. Planning or sample artifacts alone do not satisfy completion.

Offline migration, recoverability, native acquisition tests, Mermaid parsing, source-only isolated verification and disposable draft packaging have been performed. MCP retirement is approved; live SCM is deferred. Final post-removal validation passes 93 tests and seven evals. Structurizr grammar and activation review remain open; no Copilot session, publication or activation has been performed.