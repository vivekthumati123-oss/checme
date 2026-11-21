# Unit Agent Approver Guide

When a repository configures `mode: propose`, generated unit tests never reach the pull request branch automatically. A designated reviewer in the `unit-agent-approval` GitHub Actions Environment (or custom `approval-environment` input) must inspect the proposal and approve the paused `commit` deployment job.

## What to Check Before Approving

1. **Read the sticky PR comment carefully:**
   - Review every file listed under accepted / accepted-pruned tests.
   - Check the **Assumptions** column for each file: verify whether mocked dependencies, error assumptions, or boundary cases reflect intended business behavior rather than encoding an existing bug.
   - Inspect the **Tool Versions** footer and any warnings (for example, `no_coverage` mode, baseline timeout fallback, or `untested version` notices).

2. **Understand Coverage Numbers (Important Caveat):**
   - Patch coverage numbers shown in the PR comment are **projections** from the agent's validation run inside its disposable workspace copy and **are not an authoritative benchmark or release proof**.
   - Your repository's normal CI coverage run after the commit lands remains the source of truth.

3. **Review the Proposed Code Diff & Content:**
   - Confirm test names, imports, formatting, and test assertions match team style.
   - Verify no sensitive fixtures, hardcoded credentials, network calls, or production-code changes slipped in (static policy gates reject these automatically, and human review is the final gate).

## Approving or Rejecting

- **To approve:** Open the workflow run linked in the PR comment, review the paused `commit` deployment waiting on `unit-agent-approval`, and click **Approve and deploy**.
  - Before writing a single byte, `commit` verifies:
    - PR head SHA still matches the snapshot's `headSha` (otherwise exits `50` `stale_head` and posts notice).
    - Every `validated/` file matches the SHA-256 recorded in `snapshot.json` and `final.json` (re-deriving pruned files deterministically via `deriveFinalContent`, otherwise exits `60` `hash_mismatch`).
    - Static policy gates (path safety + AST rules) pass on the exact bytes to be committed.
- **To reject:** Click **Reject** on the deployment review. Zero commits are created and the PR comment stays intact.

## Handling Common Outcomes

- **Stale Head (`PR changed; a new run will start`):** New commits landed while approval was pending. Concurrency cancels superseded runs cleanly; wait for the updated proposal on the new head SHA.
- **Branch Protection Fallback:** If branch protection blocks automated pushes to the PR branch, `commit` soft-fails cleanly and `publish` / run output provides a collapsed `patch.diff` that you can apply locally (`git apply`) and push manually.
- **Required Checks Pending after Bot Commit:** Commits pushed with default `GITHUB_TOKEN` do not trigger `pull_request` workflows automatically. Re-run workflows or push an empty commit after approving (unless the repository configured `commit.auth: pat`).

