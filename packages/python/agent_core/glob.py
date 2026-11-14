"""Glob semantics identical to packages/node/agent-core/src/glob.js."""

from __future__ import annotations

import re
from functools import lru_cache


@lru_cache(maxsize=512)
def glob_to_regex(pattern: str) -> re.Pattern[str]:
    out = ""
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "*" and pattern[i + 1:i + 2] == "*":
            if pattern[i + 2:i + 3] == "/":
                out += "(?:.*/)?"
                i += 3
                continue
            out += ".*"
            i += 2
            continue
        out += "[^/]*" if ch == "*" else "[^/]" if ch == "?" else re.escape(ch)
        i += 1
    return re.compile(f"^{out}$")


def normalise_path(value: str) -> str:
    path = str(value or "").replace("\\", "/")
    return path[2:] if path.startswith("./") else path


def matches_glob(pattern: str, value: str) -> bool:
    return bool(glob_to_regex(pattern.strip()).match(normalise_path(value)))


def split_patterns(value) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [p.strip() for p in str(value or "").split(",") if p.strip()]


def matches_any(patterns, value: str) -> bool:
    return any(matches_glob(p, value) for p in split_patterns(patterns))
