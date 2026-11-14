from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def repo_root(start: Path | None = None) -> Path:
    if os.environ.get("L2_ROOT"):
        return Path(os.environ["L2_ROOT"]).resolve()
    if os.environ.get("GITHUB_WORKSPACE"):
        return Path(os.environ["GITHUB_WORKSPACE"]).resolve()
    current = (start or Path.cwd()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".github").exists():
            return candidate
    return current


@dataclass(frozen=True)
class Layout:
    root: Path

    @property
    def agents(self) -> Path: return self.root / ".github" / "agents"
    @property
    def instructions(self) -> Path: return self.root / ".github" / "instructions"
    @property
    def repo_instructions(self) -> Path: return self.root / ".github" / "copilot-instructions.md"
    @property
    def skills(self) -> Path: return self.root / ".github" / "skills"
    @property
    def hooks(self) -> Path: return self.root / ".github" / "hooks"
    @property
    def l2(self) -> Path: return self.root / "l2"
