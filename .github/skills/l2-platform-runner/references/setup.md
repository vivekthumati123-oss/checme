# Setup

1. Obtain the L2 platform checkout at the same supported release as this plugin.
2. Install the platform's declared npm workspaces and dependencies with `npm install`.
3. Use Node 22.12+ and configure Copilot access for the pinned SDK.
4. Set `L2_PLATFORM_ROOT` to the platform checkout. Keep application inputs/outputs in
   the caller repository; `--workspace` can select another application root explicitly.
5. Configure Jira through environment variables or the platform root's `.env.local`:
   `JIRA_BASE_URL`, `JIRA_PROJECT`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (Cloud), or
   `JIRA_PAT` and `JIRA_DEPLOYMENT=datacenter`. Configure `COPILOT_GITHUB_TOKEN`
   for live generation. Never print tokens or read credential files into chat.

Legacy mappings: `JIRA_SITE`/`ATLASSIAN_SITE` -> `JIRA_BASE_URL`,
`JIRA_PROJECT_KEY`/`PROJECT_KEY` -> `JIRA_PROJECT`, `ATLASSIAN_EMAIL` -> `JIRA_EMAIL`,
`ATLASSIAN_TOKEN` -> `JIRA_API_TOKEN`. Configure these yourself; the launcher never
copies old credential files. TLS verification stays enabled; use `NODE_EXTRA_CA_CERTS`
for an approved private CA instead of a certificate-verification bypass.

Runtime defaults to Copilot. Offline generation can use `--runtime mock --mock-output`
with a workspace-relative JSON fixture. It does not authenticate or query Jira on its own.
Preview and linking need no Jira credential. Live FSD generation reads Jira.

Actions additionally need a versioned platform release, repository secrets and a
protected environment with required reviewers for approved Jira creation. Plugin
installation alone does not install the programmatic runtime.