function label(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;").replace(/[\r\n]/g, " ");
}

export function generateMermaid(architecture) {
  const lines = ["flowchart LR"];
  const identifiers = new Map();
  const ambiguous = new Set();
  const nodes = [...(architecture.applications ?? []), ...(architecture.components ?? [])];
  nodes.forEach((node, index) => {
    const identifier = `node${index}`;
    lines.push(`  ${identifier}["${label(node.name ?? node.id)}"]`);
    for (const key of [node.id, node.name, node.path].filter(Boolean)) {
      if (identifiers.has(key) && identifiers.get(key) !== identifier) ambiguous.add(key);
      else identifiers.set(key, identifier);
    }
  });
  let omittedRelationships = 0;
  for (const relationship of architecture.relationships ?? []) {
    const from = identifiers.get(relationship.from);
    const to = identifiers.get(relationship.to);
    if (!from || !to || ambiguous.has(relationship.from) || ambiguous.has(relationship.to)) {
      omittedRelationships += 1;
      continue;
    }
    lines.push(`  ${from} -->|"${label(relationship.relationship)}"| ${to}`);
  }
  return { content: lines.join("\n"), omittedRelationships };
}