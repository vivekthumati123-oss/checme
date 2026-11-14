# ArchitectConnect Migration Archive

The owner has removed the temporary project and local SCM Bridge source folder. The target runtime does not import or execute either. This archive covers Architect Connect only, not SCM Bridge or owner-managed credentials.

## Recoverability

- [source-snapshot.json](source-snapshot.json) contains 58 original UTF-8 text files with original relative paths, content, and SHA-256 checksums. This includes active source, backups, samples, demos, configuration, and package manifests.
- [source-dispositions.json](source-dispositions.json) maps every archived file to its migrated/adapted target or historical status, records exclusions and empty directories, and hashes the whole snapshot.
- [engine-receipt.json](engine-receipt.json) records the original and mechanically migrated active-engine checksums. These are migration-time receipts, not hashes of all later adaptations.

Verify the archive without executing any archived code:

```powershell
node scripts/archive-architectconnect.mjs --verify
```

Recovery consists of verifying the snapshot and reconstructing each `files[].content` under its safe `files[].path` in a separate directory. Verify each reconstructed file against `sha256`. Never overwrite the live workspace or promote archived agent instructions, old dependency locks, or backup scanners into active runtime code without review.

Credential paths, dependency/build directories, Git metadata, symlinks, unsupported assets and detected sensitive content are excluded before persistence. The receipt identifies the actual exclusions. No credential file was copied. Known-pattern scanning is not a certification that arbitrary historical source is secret-free; keep the archive private to its existing repository audience and review before publication.

## Retired MCP Contract

Owner decision on 2026-10-10: retire the MCP stdio transport in favor of the migrated L2 CLI and chat launcher. The original server source is preserved in the snapshot for reference, not exposed as a target entry point.

| Legacy MCP Surface | Preserved Contract and Target Treatment |
| --- | --- |
| Server | `architectconnect`, version `1.0.0`, stdio. This transport is retired; target automation stdout is one platform `AgentResult`. |
| `analyze_repository` | Input `{repositoryUrl: string}`. Legacy schema required a nonempty string. The target URL mode deliberately requires HTTPS without credentials/query/fragment and calls SCM Bridge. |
| Analysis result | Legacy text-serialized JSON included source/repository/branch, architecture pattern and selection/fallback reason, applications/APIs/components/relationships, technology, gaps, assumptions, recommendations, score and artifact-generation flags. Target `AgentResult.data` preserves findings and selection alongside HLD core fields and explicit validation state. |
| `list_scm_repositories` | Legacy input provider enum `github`, `bitbucket`, `azure-repos`, plus optional workspace; GitLab was excluded from this enum. Underlying repository-list functionality remains in `createScmBridgeClient().listRepositories`; no equivalent MCP registration or CLI browsing command is claimed. |
| Failure envelope | Legacy MCP errors used `isError: true` and serialized failure content. Target execution returns failed `AgentResult` and nonzero CLI status; client errors omit sensitive provider response bodies. |
| Artifact flags | Legacy flags proved nonempty strings only. Target reports generated, saved, per-format grammar status, and required semantic review separately. |
| Logging | Legacy service stdout diagnostics were unsafe for stdio transport. Target lifecycle logging uses stderr; raw source and parser errors are not logged. |

## Accepted and Pending Gates

Direct-GitHub acquisition is restored using Octokit and preserves branch/tree SHA, all safe tree records, relevant blobs, root package content, and explicit missing/truncated evidence. Local and HTTP SCM acquisition remain available. Original SDK and demonstration scripts are archived rather than presented as maintained live tests.

Source-only isolated verification copies only intended platform directories, excludes credentials and original dependency trees, installs fresh dependencies offline, verifies workspace links resolve inside the copy, and runs migrated unit tests and CLI with neither temporary project present. Because the migration additions are currently untracked, this is an isolated copy of intended source, not a claim that a committed checkout was tested. No commit was made.

The final post-removal offline gate passes 93 tests and seven evals, including named-agent binding/packaging and actual CLI persistence. The 58-file archive verifies independently of the removed source folder. Live SCM checks remain deferred by owner choice. Structurizr grammar remains unverified locally because Java 21 and its official WAR are not configured; a portable Java download could not be checksum-verified, so no downloaded binary was executed. Mermaid grammar is verified when requested through the isolated parser. Activation and publication remain pending review; deletion was performed by the owner, not the migration tooling.