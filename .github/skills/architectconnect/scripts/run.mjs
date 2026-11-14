import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const platform = process.env.L2_PLATFORM_ROOT;
if (!platform) {
  process.stderr.write("Set L2_PLATFORM_ROOT to the configured L2 platform checkout.\n");
  process.exitCode = 1;
} else {
  const entrypoint = path.resolve(platform, "agents/node/architectconnect/src/index.js");
  try {
    await access(entrypoint);
    const args = process.argv.slice(2);
    if (!args.includes("--workspace")) args.push("--workspace", process.env.APPLICATION_WORKSPACE ?? process.cwd());
    const child = spawn(process.execPath, [entrypoint, ...args], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    child.on("error", () => { process.stderr.write("Could not start the configured ArchitectConnect runtime.\n"); process.exitCode = 1; });
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
  } catch {
    process.stderr.write("L2_PLATFORM_ROOT does not contain the ArchitectConnect runtime. Install/configure the platform first.\n");
    process.exitCode = 1;
  }
}