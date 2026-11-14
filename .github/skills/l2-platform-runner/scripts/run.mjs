import { readFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OPERATIONS = { modplanner: ["plan", "preview", "create", "link"], requirementshub: ["list", "generate", "finalize"] };

export function launcherCommand(argv, { env = process.env, workspace = process.cwd(), executable = process.execPath } = {}) {
  const [agent, mode, ...args] = argv;
  if (!OPERATIONS[agent]?.includes(mode)) throw new Error("Choose modplanner plan/preview/create/link or requirementshub list/generate/finalize");
  if (!env.L2_PLATFORM_ROOT) throw new Error("Set L2_PLATFORM_ROOT to an installed, configured platform checkout");
  const root = path.resolve(env.L2_PLATFORM_ROOT);
  return { executable, args: [path.join(root, "agents", "node", agent, "src", "index.js"), mode, ...args],
    cwd: root, env: { ...env, L2_ROOT: root, APPLICATION_WORKSPACE: path.resolve(workspace) }, agent };
}

export async function launch(argv) {
  const command = launcherCommand(argv);
  const manifest = JSON.parse(await readFile(path.join(command.cwd, "l2", `${command.agent}.json`), "utf8"));
  if (manifest.status !== "active" || path.resolve(command.cwd, manifest.runtime?.entrypoint ?? "") !== command.args[0]) throw new Error("Platform checkout does not contain a supported active agent binding");
  await access(command.args[0]);
  await access(path.join(command.cwd, "node_modules", "@l2", "agent-runtime", "package.json")).catch(() => { throw new Error("Install the platform's npm workspaces first with npm install"); });
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env, shell: false, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  launch(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}