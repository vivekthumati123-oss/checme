const text = (value) => typeof value === "string" && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every(text);

export function validateAssessment(assessment) {
  if (!assessment || !Array.isArray(assessment.modules) || !assessment.modules.length) return ["Assessment requires a non-empty modules array"];
  const problems = [];
  if (!text(assessment.application)) problems.push("Assessment application is required");
  if (!assessment.currentStack || !assessment.targetStack) problems.push("Current and target stacks are required");
  const ids = assessment.modules.map((module) => module?.id);
  if (new Set(ids).size !== ids.length) problems.push("Module IDs must be unique");
  for (const module of assessment.modules) {
    if (!module || !text(module.id) || !text(module.description)) { problems.push("Each module requires an ID and description"); continue; }
    if (!Number.isFinite(module.linesOfCode) || module.linesOfCode < 0) problems.push(`${module.id}: linesOfCode must be nonnegative`);
    if (!strings(module.issues) || !strings(module.dependsOn)) { problems.push(`${module.id}: issues and dependsOn must be string arrays`); continue; }
    if (new Set(module.dependsOn).size !== module.dependsOn.length) problems.push(`${module.id}: duplicate dependencies`);
    if (module.dependsOn.some((dependency) => dependency === module.id || !ids.includes(dependency))) problems.push(`${module.id}: unknown or self dependency`);
  }
  if (problems.length) return problems;
  const modules = new Map(assessment.modules.map((module) => [module.id, module]));
  const active = new Set();
  const visited = new Set();
  function visit(id) {
    if (active.has(id)) { problems.push("Dependency cycle detected"); return; }
    if (visited.has(id)) return;
    active.add(id);
    modules.get(id).dependsOn.forEach(visit);
    active.delete(id);
    visited.add(id);
  }
  ids.forEach(visit);
  return [...new Set(problems)];
}

export function validatePlan(plan, assessment) {
  const problems = validateAssessment(assessment);
  if (problems.length) return problems;
  if (!plan || !Array.isArray(plan.modules)) return ["Plan requires a modules array"];
  if (plan.application !== assessment.application || !text(plan.summary)) problems.push("Plan requires the unchanged application and a summary");
  const expected = new Map(assessment.modules.map((module) => [module.id, module]));
  const ids = plan.modules.map((module) => module?.id);
  if (new Set(ids).size !== ids.length || ids.length !== expected.size || ids.some((id) => !expected.has(id))) problems.push("Plan module IDs must exactly match the assessment without duplicates");
  const order = new Map(plan.modules.map((module) => [module?.id, module?.order]));
  for (const module of plan.modules) {
    if (!module) { problems.push("Plan module must be an object"); continue; }
    const prefix = `${module.id}:`;
    if (!Number.isInteger(module.order) || module.order < 1) problems.push(`${prefix} order must be a positive integer`);
    if (!Number.isFinite(module.riskScore) || module.riskScore < 1 || module.riskScore > 10 || !text(module.riskReason)) problems.push(`${prefix} risk must be 1-10 with a reason`);
    if (!Number.isFinite(module.effortDays) || module.effortDays <= 0) problems.push(`${prefix} effortDays must be positive`);
    if (!strings(module.tasks) || !module.tasks.length) problems.push(`${prefix} tasks must be non-empty strings`);
    if (module.status !== "pending") problems.push(`${prefix} status must be pending`);
    const original = expected.get(module.id);
    if (!strings(module.dependsOn) || !original || JSON.stringify([...module.dependsOn].sort()) !== JSON.stringify([...original.dependsOn].sort())) {
      problems.push(`${prefix} dependencies must match the assessment`);
    } else if (module.dependsOn.some((dependency) => order.get(dependency) >= module.order)) problems.push(`${prefix} must follow its dependencies`);
  }
  if (plan.modules.map((module) => module?.order).sort((left, right) => left - right).some((value, index) => value !== index + 1)) problems.push("Orders must be contiguous 1..N");
  return [...new Set(problems)];
}