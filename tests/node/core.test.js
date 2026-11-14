import { test } from "node:test";
import assert from "node:assert/strict";

import { parseYaml, matchesGlob, matchesAny, parseFrontmatter, parseAgentMarkdown, loadBinding, InstructionSet, loadSkill, PromptComposer, repoRoot, automationTask, listAgentFiles, loadAgentFile } from "@l2/agent-core";

test("yaml: nested maps, sequences of maps, flow lists, quotes, block scalars", () => {
  const doc = parseYaml("description: 'It''s quoted: x'\ntools: ['read', 'edit']\nrules:\n  - action: file.write\n    effect: allow\n    conditions:\n      paths:\n        - tests/**\n  - action: commit.create\n    effect: require-approval\nnotes: |\n  one\n  two\n");
  assert.equal(doc.description, "It's quoted: x");
  assert.deepEqual(doc.rules[0].conditions.paths, ["tests/**"]);
  assert.equal(doc.rules[1].action, "commit.create");
  assert.equal(doc.notes, "one\ntwo");
});

test("glob semantics", () => {
  assert.ok(matchesGlob("**/*.test.js", "a.test.js"));
  assert.ok(matchesGlob("**.js", "src/deep/file.js"));
  assert.ok(!matchesGlob("tests/*", "tests/unit/a.js"));
  assert.ok(matchesAny("**/*.ts, **/*.js", "lib/a.js"));
});

test("frontmatter and agent name fallback", () => {
  assert.throws(() => parseFrontmatter("# nope", "x.md"), /missing YAML frontmatter/);
  assert.equal(parseAgentMarkdown("---\ndescription: 'x'\n---\n\nBody", "review.agent.md").name, "review");
});

test("agents: no pinned model; both output modes; work-item agents can run the skill", async () => {
  for (const file of await listAgentFiles(repoRoot())) {
    const agent = await loadAgentFile(file);
    assert.equal(agent.frontmatter.model, undefined, file);
    assert.match(agent.body, /\*\*Automation:\*\*.*"mode": "automation"/s, file);
    assert.match(agent.body, /\*\*Chat:\*\*/, file);
    if (agent.body.includes("work-items")) assert.ok(agent.tools.includes("execute"), `${file} needs execute`);
  }
});

test("binding: model from l2 json, fallback env, then null", async () => {
  assert.equal((await loadBinding("testgen")).model, "gpt-5");
  const planned = await loadBinding("architectconnect");
  assert.equal(planned.model, null);
  process.env.L2_DEFAULT_MODEL = "org-default";
  try {
    assert.equal(planned.model, "org-default");
  } finally {
    delete process.env.L2_DEFAULT_MODEL;
  }
});

test("automationTask carries mode", () => assert.equal(JSON.parse(automationTask({ task: "y" })).mode, "automation"));

test("instructions resolve by path", async () => {
  const set = await InstructionSet.load(repoRoot());
  const names = (paths) => set.resolveFor(paths).map((i) => i.name);
  assert.deepEqual(names([]), ["copilot-instructions", "l2-guardrails"]);
  assert.ok(names(["src/a.py"]).includes("python"));
  assert.ok(!names(["src/a.py"]).includes("javascript"));
  assert.ok(names(["src/Button.tsx"]).includes("figma-ui-code"));
  assert.ok(!names(["src/a.py"]).includes("figma-ui-code"));
});

test("skills: on-demand references, no path escape; work-items script bundled", async () => {
  const skill = await loadSkill("aaa-unit-tests", repoRoot());
  assert.equal(skill.findReference("pytest"), "references/pytest.md");
  await assert.rejects(() => skill.readAsset("../../secrets.txt"), /has no asset/);
  const wi = await loadSkill("work-items", repoRoot());
  assert.deepEqual(wi.assets, ["references/setup.md", "scripts/wi.mjs"]);
});

test("composer: excludes the CLI-only work-items skill from automation prompts", async () => {
  const binding = await loadBinding("tasksync");
  const { included } = PromptComposer.for(binding).addInstructionsFor([]).addAgent().addSkills({ exclude: ["work-items"] }).build();
  assert.ok(included.includes("skill:story-decomposition"));
  assert.ok(!included.includes("skill:work-items"));
});

test("composer: budget drops references first", async () => {
  const binding = await loadBinding("testgen");
  const composer = PromptComposer.for(binding, { budgetChars: 3800 }).addInstructionsFor([]).addAgent().addSkills();
  await composer.addSkillReference("aaa-unit-tests", "jest");
  const { included, dropped } = composer.build();
  assert.equal(dropped[0], "reference:aaa-unit-tests/references/jest.md");
  assert.ok(included.includes("agent:unit-agent"));
});
