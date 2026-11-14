# Unit Agent Local & Chat Verification Record (L1–L7)

Template and automated-surface record for Section 10.7 / Task T44 laptop verification.

## Automated CI Coverage (Verified Across PR CI)

The non-interactive CLI mechanics behind `L1–L7` are verified automatically in `test/unit/local-commands.test.ts` across Windows and Linux:
- `local init-chat`: idempotence, YAML frontmatter without `mcp-servers`, `TEST RULES` verbatim match with `src/llm/prompts/system.md`, `{{nodeCommand}}` substitution, JSONC `tasks.json` comment-preserving merge & sample fallback.
- `local doctor`: passing & failing diagnostics (`node <20`, missing config, bad globs, broken preflight, missing coverage, stale chat markers), `toolVersions` reporting.
- `local detect`: `staged`, `worktree` (with untracked files), `branch` (`merge-base` + `origin/HEAD` -> `main` fallback), `files --symbols` & `Class.*`, `--include-covered`, CI `git-range` parity, mtime coverage reuse & `--skip-baseline`.
- `local validate` & `local apply` & `local status`: staging intake (`path_violation`, `draft_missing`), `copy` isolation, `inplace` `placed.json` crash recovery, dry-run, `--confirm`, tamper (`60`), `source_changed` (`50`), `target_exists`, `--stage` (0 commits), bounded `<= 8 KB` `/` `--json` outputs, zero network calls (`net`/`http`/`https`/`dns` blocked).

## Manual VS Code Copilot Chat Scenarios (`L1–L7` Template)

Record observations here on a developer workstation before team-wide rollout:

| ID | Scenario | OS / IDE Version | Outcome (`Pending` / `Pass` / `Fail`) | Notes |
|---|---|---|---|---|
| **L1** | Run `local init-chat` from extracted CLI zip in fresh JS/Python/Java repo | Pending manual laptop run | Pending | Confirm `.unit-agent/` git-ignored and `doctor` passes |
| **L2** | Select `unit-agent` in VS Code Chat dropdown and invoke `/unit-tests branch` | Pending manual laptop run | Pending | Verify `unit-agent.agent.md` discovered & no MCP needed |
| **L3** | Confirm terminal tool prompt and review `detect -> show -> draft -> validate` cycle | Pending manual laptop run | Pending | Confirm terminal approval prompt fires; drafts stay in `stagingDir` |
| **L4** | Trigger intentional draft failure and run `/unit-repair` up to `maxRepairIterations` | Pending manual laptop run | Pending | Confirm targeted fix and final-attempt pruning |
| **L5** | Confirm chat prompt before `local apply --confirm`; verify working tree clean + unstaged/uncommitted | Pending manual laptop run | Pending | Confirm zero git commits created |
| **L6** | Restrict chat terminal/edit tools and execute full cycle via `.vscode/tasks.json` manual mode | Pending manual laptop run | Pending | Confirm manual workflow works end-to-end |
| **L7** | Verify on Windows (`win32`) with CRLF files and backslash paths; check `status` crash cleanup | Pending manual laptop run | Pending | Confirm `/` JSON summaries and CRLF preservation |

