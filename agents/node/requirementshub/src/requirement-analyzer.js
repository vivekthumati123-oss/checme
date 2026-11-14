export function analyzeRequirements(issues) {
  const clarifications = [];
  for (const issue of issues) {
    const title = String(issue.title ?? issue.fields?.summary ?? "");
    if (/notification/i.test(title)) clarifications.push({ requirement: title, question: "Which notification channels should be supported (Email, SMS, Teams)?" });
    if (/approval/i.test(title)) clarifications.push({ requirement: title, question: "Is approval single-level or multi-level?" });
  }
  return { requirementCount: issues.length, clarifications };
}

export function captureRequirements(children, existing = {}) {
  const ids = { ...existing };
  const values = Object.values(ids);
  if (values.some((id) => !/^FR-\d{3,}$/.test(id)) || new Set(values).size !== values.length) throw new Error("Stored FR-ID map is invalid; restore it before regeneration");
  let nextId = Math.max(0, ...values.map((id) => Number(id.slice(3)))) + 1;
  const seen = new Set();
  const requirements = [...children].sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true })).map((item) => {
    if (!/^jira:[A-Z][A-Z0-9_]+-\d+$/.test(item.id) || seen.has(item.id)) throw new Error("Jira children require unique source references");
    seen.add(item.id);
    ids[item.id] ??= `FR-${String(nextId++).padStart(3, "0")}`;
    return { frId: ids[item.id], jiraKey: item.id.slice(5), sourceRef: item.id, title: item.title, description: item.description ?? "", url: item.url ?? "" };
  });
  return { ids, requirements };
}