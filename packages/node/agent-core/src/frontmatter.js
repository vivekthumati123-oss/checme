import { parseYaml } from "./yaml.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(content, filePath = "<memory>") {
  const match = FRONTMATTER.exec(String(content).replace(/^\uFEFF/, ""));
  if (!match) throw new Error(`${filePath} is missing YAML frontmatter`);
  return { data: parseYaml(match[1]) ?? {}, body: match[2].trim(), raw: match[1] };
}
