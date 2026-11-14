---
description: 'Rules for writing custom agents, skills, instructions, hooks and bundles in this repository.'
applyTo: '.github/agents/**, .github/skills/**, .github/instructions/**, .github/hooks/**, l2/**, bundles.json'
---

# Authoring Copilot customisations

- Agent files are named `<name>.agent.md`, lowercase with hyphens.
- Agent frontmatter uses `name`, `description` and `tools`. Do not add `model:`.
- Every agent's output contract has an **Automation** branch (`"mode": "automation"` → JSON only)
  and a **Chat** branch (work in the workspace, reply with a summary).
- Wrap `description` values in single quotes.
- A skill's `name` must match its folder name. Keep `SKILL.md` short; move detail into `references/`.
- Every instructions file needs `description` and `applyTo`.
- Every hook needs a `bash` and a `powershell` command.
- Run `npm run validate` after any change.
