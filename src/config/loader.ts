import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ZodError } from "zod";

import { ConfigError, ConfigSchema, type LanguageKey, type UnitAgentConfig } from "../contracts";

export interface LoadedConfigResult {
  config: UnitAgentConfig;
  configPath: string;
  warnings: string[];
}

export function formatZodError(err: ZodError): string[] {
  return err.issues.map((issue) => {
    const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    if (issue.code === "unrecognized_keys" && "keys" in issue && Array.isArray(issue.keys)) {
      return `${fieldPath}: unrecognized key(s): ${issue.keys.join(", ")}`;
    }
    return `${fieldPath}: ${issue.message}`;
  });
}

export function collectConfigWarnings(config: UnitAgentConfig): string[] {
  const warnings: string[] = [];
  for (const lang of ["javascript", "python", "java"] as LanguageKey[]) {
    const cfg = config.languages[lang];
    if (!cfg || !cfg.enabled) continue;
    if (cfg.toolchain && cfg.toolchainFile) {
      warnings.push(
        `languages.${lang}: both toolchain ("${cfg.toolchain}") and toolchainFile ("${cfg.toolchainFile}") are set; toolchain wins and toolchainFile is ignored.`,
      );
    }
  }
  return warnings;
}

export function resolveConfigPath(repoRoot: string, explicitPath?: string): string {
  const configured = explicitPath ?? process.env.UA_CONFIG ?? ".unit-agent.yml";
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(repoRoot, configured);
}

export function parseConfigYaml(
  rawYaml: string,
  configPath = ".unit-agent.yml",
): {
  config: UnitAgentConfig;
  warnings: string[];
} {
  let rawObj: unknown;
  try {
    rawObj = YAML.parse(rawYaml, { prettyErrors: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid YAML in ${configPath}: ${msg}`);
  }

  if (rawObj === null || typeof rawObj !== "object" || Array.isArray(rawObj)) {
    throw new ConfigError(`Invalid config in ${configPath}: root value must be a YAML mapping/object.`);
  }

  const parsed = ConfigSchema.safeParse(rawObj);
  if (!parsed.success) {
    const details = formatZodError(parsed.error);
    throw new ConfigError(
      `Invalid configuration in ${configPath} (see docs/config-reference.md):\n- ${details.join("\n- ")}`,
    );
  }

  const warnings = collectConfigWarnings(parsed.data);
  return { config: parsed.data, warnings };
}

export function loadConfig(repoRoot: string, explicitPath?: string): LoadedConfigResult {
  const configPath = resolveConfigPath(repoRoot, explicitPath);
  if (!existsSync(configPath)) {
    throw new ConfigError(
      `Configuration file not found at ${configPath.replace(/\\/g, "/")}. See docs/config-reference.md to create .unit-agent.yml.`,
      "config_missing",
    );
  }
  const rawYaml = readFileSync(configPath, "utf8");
  const { config, warnings } = parseConfigYaml(rawYaml, configPath);
  return { config, configPath, warnings };
}
