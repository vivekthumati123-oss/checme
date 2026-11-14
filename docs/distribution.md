# Distribution

`npm run package` turns `bundles.json` into `dist/marketplace` (awesome-copilot layout:
`.github/plugin/marketplace.json` and `plugins/<bundle>/.github/plugin/plugin.json`), org workflow templates
pinned to the release tag, and a SHA-256 report. `publish-marketplace.yml` pushes it on every `v*.*.*` tag.

Publishing targets `techm-cto-caio/axon-ghcp-L2-marketplace`, configured in
`bundles.json` under `marketplace.repository`. The marketplace ID remains `axon-sdlc-l2-agents`;
it is independent of the GitHub repository name. Generated workflow templates reference
the source repository, `techm-cto-caio/axon-ghcp-L2-agents`.

Users: `copilot plugin marketplace add techm-cto-caio/axon-ghcp-L2-marketplace` then `copilot plugin install sdlc-delivery@axon-sdlc-l2-agents`.
The `sdlc-delivery` plugin includes the `work-items` skill with `wi.mjs`; users put credentials in `.env.local`
at their repository root.

## First Deployment

1. Initialize `techm-cto-caio/axon-ghcp-L2-marketplace` with a README and a default
	branch (normally `main`). This gives the publishing checkout an existing branch.
	Treat this repository as generated output: publishing replaces its tracked contents,
	including the README. Do not keep hand-maintained files there. Ensure repository
	rules allow the publishing identity to push directly to the default branch and create tags.
2. Create a fine-grained GitHub personal access token with resource owner `techm-cto-caio`,
	access only to `axon-ghcp-L2-marketplace`, and **Contents: Read and write** permission.
	Obtain any required organization approval or SSO authorization. Never put the token
	in Git or a command.
3. In the **source** repository, `axon-ghcp-L2-agents`, open **Settings > Secrets and
	variables > Actions > New repository secret**. Add the token as `MARKETPLACE_TOKEN`.
	The source repository's automatic `GITHUB_TOKEN` cannot publish to another repository.
	Ensure GitHub Actions is enabled in the source repository.
4. Commit and push these configuration changes to the source repository. Install dependencies
	with `npm install`, then run `npm run check` and `npm run package -- --ref v1.3.0` locally.
	Inspect `dist/marketplace` and `dist/package-report.json`. These commands build locally;
	they do not publish. Use a new release version instead if `v1.3.0` already exists.
5. From the source repository, tag the commit containing the publishing changes and push
	that tag. Run each command separately:

	```powershell
	git tag v1.3.0
	git push origin v1.3.0
	```

6. In the source repository's **Actions > Publish marketplace**, confirm the run succeeds.
	It validates the source, packages published bundles, and pushes a commit plus the release
	tag to the marketplace repository. Verify `.github/plugin/marketplace.json` and `plugins/`
	exist there. Draft bundles are not published. Existing release tags are never overwritten.
7. Test installation with an identity that can read the marketplace repository:

	```bash
	copilot plugin marketplace add techm-cto-caio/axon-ghcp-L2-marketplace
	copilot plugin install l2-guardrails@axon-sdlc-l2-agents
	copilot plugin install sdlc-delivery@axon-sdlc-l2-agents
	```

Subsequent releases use a new `vMAJOR.MINOR.PATCH` source tag after updating the relevant
versions. For a retry, use `gh workflow run publish-marketplace.yml --ref v1.3.0` from the
source repository, or rerun the original Actions run. Manual runs must select an existing
release tag, not a branch. Publication is serialized and pushes the branch and tag atomically.

## Application Workflows

Application repos: copy `dist/org-workflow-templates/workflow-templates/*` into the org `.github` repo, then add the
variables `WORK_ITEM_PROVIDER`, `ADO_ORG_URL`, `ADO_PROJECT`, `JIRA_BASE_URL` and the secrets `COPILOT_GITHUB_TOKEN`,
`ADO_PAT`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (or `JIRA_PAT`).

The published `sdlc-modernization` bundle includes ModPlanner, RequirementsHub (`fsd-agent`),
work-items, guard hooks and `l2-platform-runner`. Set `L2_PLATFORM_ROOT` to a configured
platform checkout with installed workspaces. Plugin packages intentionally exclude Node
runtime implementations, dependencies, archived state and credentials. The launcher uses
that checkout and a separate application workspace; it performs no automatic downloads.

Planning templates use `_agent-planning-reusable.yml`, explicit state artifact inputs and
a versioned platform reference. Configure required reviewers for `modplanner-jira-write`
before approving any Jira create job. See [planning-agents.md](planning-agents.md) for
prerequisites, provenance checks, artifact retention and conservative recovery.
