"""Mirrors packages/node/agent-core/src/prompt-composer.js."""

from __future__ import annotations

from dataclasses import dataclass, field

from agent_core.binding import AgentBinding


@dataclass
class ComposedPrompt:
    system_prompt: str
    included: list[str]
    dropped: list[str]
    chars: int


@dataclass
class _Section:
    id: str
    content: str
    priority: int
    order: int


@dataclass
class PromptComposer:
    binding: AgentBinding
    budget_chars: int = 60000
    sections: list[_Section] = field(default_factory=list)

    def add_instructions_for(self, target_paths: list[str] | None = None) -> "PromptComposer":
        for i in self.binding.instructions.resolve_for(target_paths):
            self._add(f"instructions:{i.name}", i.body, 1)
        return self

    def add_agent(self) -> "PromptComposer":
        self._add(f"agent:{self.binding.agent.name}", self.binding.agent.body, 1)
        return self

    def add_skills(self, exclude: tuple[str, ...] = ("work-items",)) -> "PromptComposer":
        for s in self.binding.skills:
            if s.name not in exclude:
                self._add(f"skill:{s.name}", f"# Skill: {s.name}\n\n{s.body}", 2)
        return self

    def add_skill_reference(self, skill_name: str, keyword: str) -> "PromptComposer":
        skill = self.binding.skill(skill_name)
        reference = skill.find_reference(keyword)
        if reference:
            self._add(f"reference:{skill_name}/{reference}", skill.read_asset(reference), 3)
        return self

    def _add(self, section_id: str, text: str, priority: int) -> None:
        content = (text or "").strip()
        if content and all(s.id != section_id for s in self.sections):
            self.sections.append(_Section(section_id, content, priority, len(self.sections)))

    def build(self) -> ComposedPrompt:
        kept = list(self.sections)
        dropped: list[str] = []
        size = lambda: sum(len(s.content) + 7 for s in kept)
        while size() > self.budget_chars:
            candidates = [s for s in kept if s.priority > 1]
            if not candidates:
                break
            victim = sorted(candidates, key=lambda s: (-s.priority, -s.order))[0]
            kept.remove(victim)
            dropped.append(victim.id)
        kept.sort(key=lambda s: s.order)
        return ComposedPrompt("\n\n---\n\n".join(s.content for s in kept), [s.id for s in kept], dropped, size())
