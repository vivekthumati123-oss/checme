import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const WASM_FILES = [
  {
    src: path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
    name: "tree-sitter.wasm",
  },
  ...["javascript", "typescript", "tsx", "python", "java"].map((lang) => ({
    src: path.join(ROOT, "node_modules", "tree-sitter-wasms", "out", `tree-sitter-${lang}.wasm`),
    name: `tree-sitter-${lang}.wasm`,
  })),
];

async function main() {
  const distDir = path.join(ROOT, "dist");
  const wasmDir = path.join(distDir, "wasm");
  mkdirSync(wasmDir, { recursive: true });

  await build({
    entryPoints: [path.join(ROOT, "src", "cli.ts")],
    outfile: path.join(distDir, "cli.js"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    sourcemap: true,
    logLevel: "info",
    banner: {
      js: [
        "#!/usr/bin/env node",
        "import { createRequire as __uaCreateRequire } from 'node:module';",
        "const require = __uaCreateRequire(import.meta.url);",
      ].join("\n"),
    },
  });

  for (const item of WASM_FILES) {
    if (!existsSync(item.src)) {
      throw new Error(`Missing required WASM asset: ${item.src}`);
    }
    cpSync(item.src, path.join(wasmDir, item.name));
  }

  const jacocoSrc = path.join(ROOT, "src", "stages", "validate", "runners", "java", "jacoco-init.gradle");
  if (existsSync(jacocoSrc)) {
    cpSync(jacocoSrc, path.join(distDir, "unit-agent-jacoco.init.gradle"));
  }

  const promptsSrc = path.join(ROOT, "src", "llm", "prompts");
  if (existsSync(promptsSrc)) {
    cpSync(promptsSrc, path.join(distDir, "prompts"), { recursive: true });
  }

  const chatTemplatesSrc = path.join(ROOT, "templates", "chat");
  if (existsSync(chatTemplatesSrc)) {
    cpSync(chatTemplatesSrc, path.join(distDir, "templates", "chat"), { recursive: true });
  }

  // Generate schema/unit-agent.schema.json directly from ConfigSchema without needing tsx at runtime
  const schemaBuild = await build({
    entryPoints: [path.join(ROOT, "src", "contracts", "config.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    write: false,
  });
  const schemaOut = schemaBuild.outputFiles[0];
  if (!schemaOut) {
    throw new Error("Failed to bundle config schema generator");
  }
  const tmpSchemaModule = path.join(distDir, ".config-schema.tmp.mjs");
  writeFileSync(tmpSchemaModule, schemaOut.text, "utf8");
  try {
    const mod = await import(`${pathToFileURL(tmpSchemaModule).href}?t=${Date.now()}`);
    const jsonSchema = {
      $id: "https://unit-agent.local/schema/unit-agent.schema.json",
      title: "Unit Agent Configuration (.unit-agent.yml)",
      ...mod.exportConfigJsonSchema(),
    };
    const schemaDir = path.join(ROOT, "schema");
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(path.join(schemaDir, "unit-agent.schema.json"), `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
  } finally {
    const { rmSync } = await import("node:fs");
    rmSync(tmpSchemaModule, { force: true });
  }
}

main().catch((err) => {
  globalThis.console.error(err);
  globalThis.process.exit(1);
});

