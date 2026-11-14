import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyEngine } from "@l2/agent-core";

function parserEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|JAVA_HOME|LANG|LC_ALL)$/i.test(key)));
}

function execute(command, args, input = "") {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: parserEnvironment(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (chunk) => { if (stdout.length < 4096) stdout += chunk.toString(); });
    child.stderr.on("data", () => {});
    child.on("error", () => { clearTimeout(timer); resolve({ unavailable: true }); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function parseMermaid(source) {
  const worker = fileURLToPath(new URL("./mermaid-parser-worker.mjs", import.meta.url));
  const result = await execute(process.execPath, [worker], source);
  if (result.unavailable || result.signal || result.code !== 0) return { status: "unverified", reason: "Mermaid parser could not run." };
  try { return JSON.parse(result.stdout); } catch { return { status: "unverified", reason: "Mermaid parser returned an invalid result." }; }
}

async function parseStructurizr(source, { hooks, war = process.env.STRUCTURIZR_WAR, java = process.env.JAVA_EXECUTABLE ?? "java" } = {}) {
  if (!war) return { status: "unverified", reason: "Configure STRUCTURIZR_WAR and Java 21 for local Structurizr validation." };
  if (/^\s*!(?!identifiers\s+hierarchical\s*$)/m.test(source)) return { status: "invalid", reason: "Dynamic DSL directives are not permitted in generated validation input." };
  const availability = await execute(java, ["-version"]);
  if (availability.unavailable || availability.code !== 0) return { status: "unverified", reason: "Configured Java is unavailable." };
  const directory = await mkdtemp(path.join(os.tmpdir(), "l2-structurizr-"));
  const filePath = path.join(directory, "workspace.dsl");
  try {
    const policy = new PolicyEngine({ rules: [{ action: "file.write", effect: "allow", conditions: { paths: [filePath.replace(/\\/g, "/")] } }] });
    if (!policy.permits("file.write", { path: filePath.replace(/\\/g, "/") })) throw new Error("Parser input write denied.");
    const guard = await hooks?.allowTool?.("create", { path: filePath, content: source });
    if (guard?.decision !== "allow" || guard.results?.some((result) => result.error)) throw new Error("Parser input denied by guardrails.");
    await writeFile(filePath, source, { encoding: "utf8", flag: "wx" });
    const result = await execute(java, ["-jar", path.resolve(war), "validate", "-workspace", filePath]);
    if (result.unavailable || result.signal) return { status: "unverified", reason: "Structurizr validator could not run." };
    return { status: result.code === 0 ? "valid" : "invalid", reason: result.code === 0 ? undefined : "Structurizr validation failed; check the DSL and configured validator version." };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function validateDiagrams({ mermaid, dsl }, { mermaidParser = parseMermaid, structurizrParser = parseStructurizr, ...options } = {}) {
  const mermaidResult = await mermaidParser(mermaid, options);
  const structurizrResult = await structurizrParser(dsl, options);
  return {
    mermaidGrammar: mermaidResult.status, structurizrGrammar: structurizrResult.status,
    notes: [mermaidResult.reason, structurizrResult.reason].filter(Boolean),
  };
}