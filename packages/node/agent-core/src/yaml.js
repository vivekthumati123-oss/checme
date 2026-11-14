/**
 * Minimal YAML subset parser: block maps, block sequences, nesting, inline flow lists,
 * quoted scalars and block scalars. Dependency-free; swap for `yaml` when ready.
 */
function splitFlow(text) {
  const parts = [];
  let current = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

export function coerce(value) {
  const text = String(value).trim();
  if (text === "" || text === "null" || text === "~") return null;
  if (text === "true" || text === "True") return true;
  if (text === "false" || text === "False") return false;
  if (text.length >= 2 && text[0] === text[text.length - 1] && (text[0] === '"' || text[0] === "'")) return text.slice(1, -1).replace(/''/g, "'");
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    return inner === "" ? [] : splitFlow(inner).map(coerce);
  }
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  return text;
}

function tokenise(text) {
  return String(text).split(/\r?\n/).map((l) => l.replace(/\t/g, "  "))
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
    .map((l) => ({ indent: l.length - l.trimStart().length, content: l.trim() }));
}

function splitKey(content) {
  let quote = null;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (i === 0) quote = ch;
      continue;
    }
    if (ch === ":" && (i + 1 === content.length || /\s/.test(content[i + 1]))) {
      return { key: content.slice(0, i).trim().replace(/^["']|["']$/g, ""), value: content.slice(i + 1).trim() };
    }
  }
  return null;
}

const isItem = (line) => line.content === "-" || line.content.startsWith("- ");
const parseBlock = (lines, start, indent) => (lines[start] && isItem(lines[start]) ? parseSequence(lines, start, indent) : parseMapping(lines, start, indent));

function parseSequence(lines, start, indent) {
  const items = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
    const rest = lines[i].content.slice(1).trim();
    const childStart = i + 1;
    let childEnd = childStart;
    while (childEnd < lines.length && lines[childEnd].indent > indent) childEnd += 1;
    if (rest === "") items.push(childEnd > childStart ? parseBlock(lines, childStart, lines[childStart].indent).value : null);
    else if (splitKey(rest) && !rest.startsWith("[")) {
      const contentIndent = indent + (lines[i].content.length - rest.length);
      const synthetic = [{ indent: 0, content: rest }];
      for (let j = childStart; j < childEnd; j += 1) synthetic.push({ indent: lines[j].indent - contentIndent, content: lines[j].content });
      items.push(parseMapping(synthetic, 0, 0).value);
    } else items.push(coerce(rest));
    i = childEnd;
  }
  return { value: items, next: i };
}

function parseMapping(lines, start, indent) {
  const map = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const parts = splitKey(lines[i].content);
    if (!parts) {
      i += 1;
      continue;
    }
    if (parts.value !== "" && parts.value !== "|" && parts.value !== ">") {
      map[parts.key] = coerce(parts.value);
      i += 1;
      continue;
    }
    const childStart = i + 1;
    if (parts.value === "|" || parts.value === ">") {
      let end = childStart;
      while (end < lines.length && lines[end].indent > indent) end += 1;
      map[parts.key] = lines.slice(childStart, end).map((l) => l.content).join(parts.value === "|" ? "\n" : " ");
      i = end;
    } else if (childStart < lines.length && lines[childStart].indent > indent) {
      const child = parseBlock(lines, childStart, lines[childStart].indent);
      map[parts.key] = child.value;
      i = child.next;
    } else if (childStart < lines.length && lines[childStart].indent === indent && isItem(lines[childStart])) {
      const child = parseSequence(lines, childStart, indent);
      map[parts.key] = child.value;
      i = child.next;
    } else {
      map[parts.key] = null;
      i = childStart;
    }
  }
  return { value: map, next: i };
}

export function parseYaml(text) {
  const lines = tokenise(text);
  return lines.length ? parseBlock(lines, 0, lines[0].indent).value : {};
}
