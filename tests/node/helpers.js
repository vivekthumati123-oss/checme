import { Logger, Telemetry, PolicyEngine, createAgentRequest } from "@l2/agent-core";

export const silentLogger = () => new Logger({ level: "error", sink: () => {} });

export function context({ binding, scm, runtime, hooks = null, policy, workItems = null }) {
  const logger = silentLogger();
  return { logger, telemetry: new Telemetry(logger), policy: new PolicyEngine(policy ?? binding.policy), hooks, scm, runtime, workItems, workspace: binding.root };
}

export function prRequest(binding, overrides = {}) {
  return createAgentRequest({
    agentId: binding.id,
    trigger: { type: "pull_request", provider: "github", eventName: "pull_request" },
    repository: { provider: "github", owner: "o", name: "r", defaultBranch: "main", workingDirectory: binding.root, pullRequestNumber: 1, headSha: "head-sha" },
    payload: binding.resolveConfig({ pullRequestNumber: 1 }),
    ...overrides,
  });
}

export function memoryArtifacts(initial = {}) {
  const files = new Map(Object.entries(initial).map(([name, value]) => [name, typeof value === "string" ? value : JSON.stringify(value)]));
  const writes = [];
  return {
    files, writes,
    relative: (name) => `.l2/fixture/${name}`,
    async locked(operation) { return operation(); },
    async read(name) { return files.get(name) ?? null; },
    async json(name) { return files.has(name) ? JSON.parse(files.get(name)) : null; },
    async readInput(name) { if (!files.has(name)) throw new Error("Missing fixture input"); return files.get(name); },
    async write(name, value, { overwrite = true } = {}) {
      if (!overwrite && files.has(name)) throw new Error(`${name} already exists`);
      const content = typeof value === "string" ? value : JSON.stringify(value);
      writes.push({ name, content });
      files.set(name, content);
    },
  };
}

export function planningFixture(id, { artifacts = memoryArtifacts(), runtime = MockRuntime(), workItems = {} } = {}) {
  const binding = { id, root: process.cwd(), manifest: { version: "1.0.0" }, model: "fixture-model", tools: [], agent: {},
    policy: { rules: [{ action: "repository.read", effect: "allow" }, { action: "work-item.read", effect: "allow" }, { action: "work-item.create", effect: "require-approval" }] },
    resolveConfig: (payload) => payload,
  };
  const ctx = context({ binding, runtime, workItems, hooks: { async run() {} } });
  return { binding, context: { ...ctx, artifacts, scopeArtifacts: memoryArtifacts(), legacyIndex: { modplanner: [] } } };
}

function MockRuntime() {
  return { async run() { throw new Error("Unexpected model call"); } };
}
