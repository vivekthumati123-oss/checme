from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agent_core.customizations import AgentDefinition, InstructionSet, Skill, load_agent_file, load_skill
from agent_core.mini_yaml import parse_yaml
from agent_core.paths import Layout, repo_root


@dataclass
class AgentBinding:
    """Everything one L2 agent needs, resolved from l2/<id>.json. Mirrors binding.js."""

    manifest: dict[str, Any]
    manifest_path: Path
    root: Path
    agent: AgentDefinition
    skills: list[Skill]
    instructions: InstructionSet
    policy: dict[str, Any]

    @property
    def id(self) -> str: return self.manifest["name"]
    @property
    def display_name(self) -> str: return self.manifest.get("displayName") or self.id
    @property
    def status(self) -> str: return self.manifest.get("status", "draft")
    @property
    def hook_names(self) -> list[str]: return self.manifest.get("hooks") or []
    @property
    def tools(self) -> list[str]: return self.agent.tools

    @property
    def model(self) -> str | None:
        return (self.manifest.get("runtime") or {}).get("model") or os.environ.get("L2_DEFAULT_MODEL") or None

    def skill(self, name: str) -> Skill:
        for skill in self.skills:
            if skill.name == name:
                return skill
        raise KeyError(f"Agent {self.id} does not declare skill {name}")

    def resolve_config(self, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
        merged = dict(self.manifest.get("config") or {})
        merged.update({k: v for k, v in (overrides or {}).items() if v is not None})
        return merged


def load_binding(binding_id: str, root: Path | None = None) -> AgentBinding:
    root = root or repo_root()
    manifest_path = Layout(root).l2 / f"{binding_id}.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"L2 binding not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    policy_path = root / manifest.get("policy", "configurations/policies/default.yaml")
    policy = parse_yaml(policy_path.read_text(encoding="utf-8")) if policy_path.exists() else {"rules": []}
    return AgentBinding(manifest=manifest, manifest_path=manifest_path, root=root, agent=load_agent_file(root / manifest["agent"]),
                        skills=[load_skill(n, root) for n in manifest.get("skills") or []], instructions=InstructionSet.load(root), policy=policy)
