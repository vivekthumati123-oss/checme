/**
 * System prompt from the same files Copilot uses interactively:
 *   instructions (1, never dropped) · agent body (1) · skill bodies (2) · skill references (3, dropped first)
 */
export class PromptComposer {
  constructor(binding, { budgetChars = 60000 } = {}) {
    this.binding = binding;
    this.budgetChars = budgetChars;
    this.sections = [];
  }

  static for(binding, options) {
    return new PromptComposer(binding, options);
  }

  addInstructionsFor(targetPaths = []) {
    for (const i of this.binding.instructions.resolveFor(targetPaths)) this.#add(`instructions:${i.name}`, i.body, 1);
    return this;
  }

  addAgent() {
    this.#add(`agent:${this.binding.agent.name}`, this.binding.agent.body, 1);
    return this;
  }

  addSkills({ exclude = [] } = {}) {
    for (const s of this.binding.skills) if (!exclude.includes(s.name)) this.#add(`skill:${s.name}`, `# Skill: ${s.name}\n\n${s.body}`, 2);
    return this;
  }

  async addSkillReference(skillName, keyword) {
    const skill = this.binding.skill(skillName);
    const reference = skill.findReference(keyword);
    if (reference) this.#add(`reference:${skillName}/${reference}`, await skill.readAsset(reference), 3);
    return this;
  }

  #add(id, text, priority) {
    const content = String(text ?? "").trim();
    if (content && !this.sections.some((s) => s.id === id)) this.sections.push({ id, content, priority, order: this.sections.length });
  }

  build() {
    const kept = [...this.sections];
    const dropped = [];
    const size = () => kept.reduce((n, s) => n + s.content.length + 7, 0);
    while (size() > this.budgetChars) {
      const candidates = kept.filter((s) => s.priority > 1);
      if (candidates.length === 0) break;
      const victim = candidates.sort((a, b) => b.priority - a.priority || b.order - a.order)[0];
      kept.splice(kept.indexOf(victim), 1);
      dropped.push(victim.id);
    }
    kept.sort((a, b) => a.order - b.order);
    return { systemPrompt: kept.map((s) => s.content).join("\n\n---\n\n"), included: kept.map((s) => s.id), dropped, chars: size() };
  }
}
