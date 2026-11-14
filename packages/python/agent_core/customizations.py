"""Loaders for Copilot customisation files: agents, instructions and skills."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agent_core.frontmatter import parse_frontmatter
from agent_core.glob import matches_any, split_patterns
from agent_core.paths import Layout

ASSET_DIRS = ("references", "assets", "scripts")


@dataclass
class AgentDefinition:
    file_path: Path
    frontmatter: dict[str, Any]
    body: str

    @property
    def name(self) -> str:
        return self.frontmatter.get("name") or self.file_path.name.removesuffix(".agent.md").removesuffix(".md")

    @property
    def description(self) -> str:
        return self.frontmatter.get("description", "")

    @property
    def tools(self) -> list[str]:
        return self.frontmatter.get("tools") or []


def parse_agent_markdown(content: str, file_path: str | Path = "<memory>.agent.md") -> AgentDefinition:
    data, body = parse_frontmatter(content, str(file_path))
    return AgentDefinition(Path(file_path), data, body)


def load_agent_file(path: Path) -> AgentDefinition:
    if not path.exists():
        raise FileNotFoundError(f"Custom agent file not found: {path}")
    return parse_agent_markdown(path.read_text(encoding="utf-8"), path)


@dataclass
class Instruction:
    name: str
    description: str
    apply_to: list[str]
    body: str
    file_path: Path


@dataclass
class InstructionSet:
    repository: Instruction | None = None
    files: list[Instruction] = field(default_factory=list)

    @classmethod
    def load(cls, root: Path) -> "InstructionSet":
        layout = Layout(root)
        repository = None
        if layout.repo_instructions.exists():
            repository = Instruction("copilot-instructions", "", ["**"], layout.repo_instructions.read_text(encoding="utf-8").strip(), layout.repo_instructions)
        files = []
        if layout.instructions.exists():
            for path in sorted(layout.instructions.glob("*.instructions.md")):
                data, body = parse_frontmatter(path.read_text(encoding="utf-8"), str(path))
                files.append(Instruction(path.name.removesuffix(".instructions.md"), data.get("description", ""), split_patterns(data.get("applyTo")), body, path))
        return cls(repository, files)

    def resolve_for(self, target_paths: list[str] | None = None) -> list[Instruction]:
        target_paths = target_paths or []
        selected = [i for i in self.files if "**" in i.apply_to or any(matches_any(i.apply_to, p) for p in target_paths)]
        return [self.repository, *selected] if self.repository else selected


@dataclass
class Skill:
    name: str
    description: str
    body: str
    directory: Path
    assets: list[str]

    @property
    def references(self) -> list[str]:
        return [a for a in self.assets if a.startswith("references/")]

    def read_asset(self, relative: str) -> str:
        if relative not in self.assets:
            raise FileNotFoundError(f"Skill {self.name} has no asset {relative}")
        return (self.directory / relative).read_text(encoding="utf-8")

    def find_reference(self, keyword: str) -> str | None:
        return next((r for r in self.references if Path(r).stem.lower() == keyword.lower()), None)


def load_skill(name: str, root: Path) -> Skill:
    directory = Layout(root).skills / name
    file = directory / "SKILL.md"
    if not file.exists():
        raise FileNotFoundError(f"Skill not found: {file}")
    data, body = parse_frontmatter(file.read_text(encoding="utf-8"), str(file))
    assets = sorted(p.relative_to(directory).as_posix() for d in ASSET_DIRS if (directory / d).exists() for p in (directory / d).rglob("*") if p.is_file())
    return Skill(data.get("name") or name, data.get("description", ""), body, directory, assets)
