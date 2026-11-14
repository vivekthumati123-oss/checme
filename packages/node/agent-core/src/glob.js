const cache = new Map();

/** `**` any segments (`**\/x` also matches `x` at root), `*` within a segment, `?` one char. */
export function globToRegExp(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const regex = new RegExp(`^${source}$`);
  cache.set(pattern, regex);
  return regex;
}

export const normalisePath = (value) => String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
export const matchesGlob = (pattern, value) => globToRegExp(pattern.trim()).test(normalisePath(value));
export function splitPatterns(value) {
  if (Array.isArray(value)) return value.map(String).map((p) => p.trim()).filter(Boolean);
  return String(value ?? "").split(",").map((p) => p.trim()).filter(Boolean);
}
export const matchesAny = (patterns, value) => splitPatterns(patterns).some((p) => matchesGlob(p, value));
