from __future__ import annotations

import re
from typing import Any

from agent_core.mini_yaml import parse_yaml

_FRONTMATTER = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", re.DOTALL)


def parse_frontmatter(content: str, file_path: str = "<memory>") -> tuple[dict[str, Any], str]:
    match = _FRONTMATTER.match(content.lstrip("\ufeff"))
    if not match:
        raise ValueError(f"{file_path} is missing YAML frontmatter")
    return parse_yaml(match.group(1)) or {}, match.group(2).strip()
