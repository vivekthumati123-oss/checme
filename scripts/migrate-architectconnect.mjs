import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "Architect Connect");
const targetRoot = path.join(root, "agents/node/architectconnect/src/engine");
const apply = process.argv.includes("--apply");
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

async function listModules(directory) {
  const entries = await readdir(path.join(sourceRoot, directory), { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return listModules(relative);
    return entry.name.endsWith(".js") && !entry.name.includes(".backup.") ? [relative] : [];
  }));
  return groups.flat();
}

const files = [
  "repositoryScanner.js", "hldGenerator.js", "structurizrGenerator.js", "adrGenerator.js",
  ...await listModules("analyzers"), ...await listModules("models"),
];
const modules = new Map();
for (const relative of files) {
  const content = await readFile(path.join(sourceRoot, relative), "utf8");
  const exported = content.match(/module\.exports\s*=\s*(\{[\w\s,]+\}|[A-Za-z_$][\w$]*)\s*;?\s*$/);
  if (!exported) throw new Error(`Unsupported export shape in ${relative}`);
  modules.set(relative, { content, exported, names: exported[1] });
}

const receipt = [];
for (const [relative, module] of modules) {
  const target = path.join(targetRoot, relative);
  if (relative === "analyzers/discovery/architectureSelector.js") {
    receipt.push({ source: relative, sha256: sha256(module.content), treatment: "manually adapted and tested" });
    continue;
  }
  let converted = module.content.replace(
    /^\s*const\s+([A-Za-z_$][\w$]*|\{[\w\s,$:]+\})\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)\s*;/gm,
    (_, binding, specifier) => {
      if (!specifier.startsWith(".")) {
        if (specifier !== "path") throw new Error(`Unexpected external dependency in ${relative}`);
        return `import * as ${binding.trim()} from "node:path";`;
      }
      const dependencyPath = path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.js`));
      const dependency = modules.get(dependencyPath);
      if (!dependency) throw new Error(`Missing dependency ${dependencyPath}`);
      const imported = binding.trim().startsWith("{") ? binding.replace(/\s+/g, " ").trim()
        : `{ ${dependency.names} as ${binding.trim()} }`;
      if (!binding.trim().startsWith("{") && dependency.names.startsWith("{")) {
        return `import * as ${binding.trim()} from "${specifier}.js";`;
      }
      return `import ${imported} from "${specifier}.js";`;
    },
  );
  converted = converted.replace(module.exported[0], module.names.startsWith("{")
    ? `export ${module.names};\n` : `export { ${module.names} };\n`);
  if (/console\.(log|warn|error)/.test(converted)) {
    converted = `const trace = () => {};\n\n${converted.replace(/console\.(log|warn|error)/g, "trace")}`;
  }
  if (/^\s*(?:const\s+[\s\S]{0,100}?=\s*)?require\s*\(/m.test(converted) || /module\.exports/.test(converted)) {
    throw new Error(`Unconverted CommonJS boundary in ${relative}`);
  }
  receipt.push({ source: relative, sha256: sha256(module.content), migratedSha256: sha256(converted), treatment: "mechanical ESM conversion; legacy debug output discarded" });
  if (apply) {
    if (existsSync(target)) throw new Error(`Refusing to overwrite ${path.relative(root, target)}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, converted);
  }
}
if (apply) {
  const receiptPath = path.join(root, "docs/migration-archive/architectconnect/engine-receipt.json");
  if (existsSync(receiptPath)) throw new Error("Refusing to overwrite the existing migration receipt");
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify({ sourceRoot: "Architect Connect", targetRoot: "agents/node/architectconnect/src/engine", files: receipt }, null, 2)}\n`);
}
process.stdout.write(`${apply ? "Migrated" : "Checked"} ${receipt.length} active engine modules; temporary sources unchanged.\n`);