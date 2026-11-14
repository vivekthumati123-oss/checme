const text = (value) => typeof value === "string" && value.trim().length > 0;
const list = (value) => Array.isArray(value) && value.every(text);
const fields = ["acceptanceCriteria", "businessRules", "dependencies"];
const globalFields = ["nonFunctionalConsiderations", "assumptions"];

export function validateDocument(document, captured) {
  const problems = [];
  if (!document || !Array.isArray(document.requirements) || !Array.isArray(document.openQuestions)) return ["FSD requires requirements and openQuestions arrays"];
  if (!text(document.purposeScope) || !text(document.epicOverview)) problems.push("Purpose/scope and epic overview are required");
  if (!globalFields.every((field) => list(document[field]))) problems.push("Non-functional considerations and assumptions must be string arrays");
  const expected = new Map(captured.map((item) => [item.frId, item]));
  const seen = new Set();
  for (const requirement of document.requirements) {
    const source = expected.get(requirement?.frId);
    if (!source || seen.has(requirement.frId) || requirement.jiraKey !== source.jiraKey || requirement.title !== source.title || requirement.description !== source.description) problems.push("FSD must preserve each captured FR ID, Jira key, title and description exactly once");
    seen.add(requirement?.frId);
    if (!fields.every((field) => list(requirement?.[field]))) problems.push("Requirement criteria, business rules and dependencies must be string arrays");
  }
  if (seen.size !== expected.size || document.requirements.length !== captured.length) problems.push("FSD must cover every captured requirement");
  const questions = new Set();
  for (const question of document.openQuestions) {
    if (!/^Q[1-9]\d*$/.test(question?.id ?? "") || questions.has(question.id) || !text(question.text) || !Array.isArray(question.frIds) || question.frIds.some((id) => !expected.has(id))) problems.push("Open questions require unique Q IDs, text and known FR IDs");
    if (question?.field && !(question.frIds?.length ? fields : globalFields).includes(question.field)) problems.push("Question target field is invalid");
    questions.add(question?.id);
  }
  const inspect = (values, frId, field) => {
    for (const value of Array.isArray(values) ? values : []) {
      if (typeof value === "string" && /Proposed:/i.test(value) && !document.openQuestions.some((question) => question?.proposal === value && question.field === field && Array.isArray(question.frIds) && (frId ? question.frIds.includes(frId) : question.frIds.length === 0))) problems.push("Every Proposed item requires a question with matching proposal, field and FR IDs");
    }
  };
  for (const requirement of document.requirements) fields.forEach((field) => inspect(requirement?.[field], requirement?.frId, field));
  globalFields.forEach((field) => inspect(document[field], null, field));
  const prose = [document.purposeScope, document.epicOverview, ...globalFields.flatMap((field) => Array.isArray(document[field]) ? document[field] : []),
    ...document.requirements.flatMap((item) => fields.flatMap((field) => Array.isArray(item?.[field]) ? item[field] : [])), ...document.openQuestions.map((item) => item?.text)];
  if (prose.some((value) => typeof value === "string" && /^#{1,6}\s+.*Traceability Matrix/im.test(value))) problems.push("Do not include a model-generated Traceability Matrix");
  return [...new Set(problems)];
}

export function applyAnswers(document, answers, captured) {
  if (!Array.isArray(answers)) throw new Error("BA answers must be an array");
  const result = structuredClone(document);
  const resolved = new Set();
  const seen = new Set();
  for (const answer of answers) {
    const question = result.openQuestions.find((item) => item.id === answer?.questionId);
    if (!question || seen.has(answer.questionId)) throw new Error("Answers must refer to unique existing question IDs");
    seen.add(answer.questionId);
    if (answer.confirmed !== true || !text(answer.answer) || /^(?:tbd|not sure|unknown|undecided|to be determined)[.!?]?$/i.test(answer.answer.trim())) continue;
    const field = question.field ?? (question.frIds.length ? "businessRules" : "nonFunctionalConsiderations");
    const targets = question.frIds.length ? result.requirements.filter((item) => question.frIds.includes(item.frId)) : [result];
    for (const target of targets) {
      target[field] = target[field].filter((value) => value !== question.proposal);
      target[field].push(`Business Analyst confirmation (${question.id}): ${answer.answer.trim()}`);
    }
    resolved.add(question.id);
  }
  result.openQuestions = result.openQuestions.filter((question) => !resolved.has(question.id));
  const problems = validateDocument(result, captured);
  if (problems.length) throw new Error(problems.join("; "));
  return { document: result, resolved: [...resolved] };
}

const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const bullets = (values) => values.length ? values.map((value) => `- ${value}`).join("\n") : "Not supplied.";

export function traceability(captured) {
  return ["## Traceability Matrix", "", "| FR ID | Jira Key | Title |", "|---|---|---|", ...captured.map((item) => `| ${cell(item.frId)} | ${cell(item.jiraKey)} | ${cell(item.title)} |`)].join("\n");
}

export function renderDocument(document, { epic, requirements }) {
  const sections = [
    `# FSD - ${cell(epic.jiraKey)}: ${cell(epic.title)}`,
    `## 1. Purpose & Scope\n\n${document.purposeScope}`,
    `## 2. Epic Overview\n\n${document.epicOverview}`,
    "## 3. Functional Requirements\n\n" + document.requirements.map((item) =>
      `### ${item.frId}: ${cell(item.title)}\n\nJira: ${item.jiraKey}\n\n${(item.description || "Description not supplied.").split(/\r?\n/).map((line) => `> ${line}`).join("\n")}\n\n#### Acceptance Criteria\n\n${bullets(item.acceptanceCriteria)}\n\n#### Business Rules\n\n${bullets(item.businessRules)}\n\n#### Dependencies\n\n${bullets(item.dependencies)}`).join("\n\n"),
    `## 4. Non-Functional Considerations\n\n${bullets(document.nonFunctionalConsiderations)}`,
    `## 5. Assumptions\n\n${bullets(document.assumptions)}`,
    `## 6. Open Questions\n\n${document.openQuestions.length ? document.openQuestions.map((question) => `${question.id}. ${question.text}${question.frIds.length ? ` (${question.frIds.join(", ")})` : ""}`).join("\n") : "None."}`,
    traceability(requirements),
  ];
  return `${sections.join("\n\n")}\n`;
}