import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentRequest, loadBinding } from "@l2/agent-core";
import { buildExecutionContext } from "@l2/agent-runtime";
import { ArchitectConnectAgent } from "./architectconnect-agent.js";

export function parseArguments(args, env = {}, cwd = process.cwd()) {
  const payload = { apply: false };
  let workspace = env.APPLICATION_WORKSPACE;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") { payload.apply = true; continue; }
    if (argument === "--validate") { payload.validateDiagrams = true; continue; }
    if (argument === "--require-validated") { payload.requireValidated = true; continue; }
    const keys = { "--local": "localPath", "--github": "githubDirect", "--output": "outputDirectory", "--bridge-url": "scmBridgeUrl", "--workspace": "workspace" };
    if (keys[argument]) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Every named option requires a value.");
      if (argument === "--workspace") workspace = value;
      else payload[keys[argument]] = value;
    } else if (!argument.startsWith("--") && !payload.repositoryUrl) payload.repositoryUrl = argument;
    else throw new Error("Unknown CLI argument. Use a repository URL, --github OWNER/REPOSITORY, or --local directory, with --workspace, --output, --bridge-url, --validate, --require-validated, and optional --apply.");
  }
  if (payload.apply && !workspace) throw new Error("--apply requires --workspace or APPLICATION_WORKSPACE.");
  if (payload.localPath) payload.localPath = path.resolve(cwd, payload.localPath);
  return { payload, workspace: path.resolve(cwd, workspace ?? cwd), dryRun: env.AGENT_DRY_RUN === "true" || !payload.apply };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args, process.env);
  const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const binding = await loadBinding("architectconnect", { root: platformRoot });
  if (binding.status === "planned") throw new Error("ArchitectConnect is not yet runnable.");
  const request = createAgentRequest({ agentId: binding.id, payload: options.payload, dryRun: options.dryRun });
  const context = await buildExecutionContext(request, binding);
  request.payload.scmBridgeUrl ??= process.env.SCM_BRIDGE_URL;
  const result = await new ArchitectConnectAgent(binding).execute(request, { ...context, workspace: options.workspace });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failed") process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("ArchitectConnect could not initialize. Check source arguments, application workspace, and platform configuration.\n");
    process.exitCode = 1;
  });
}