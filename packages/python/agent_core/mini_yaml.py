"""Minimal YAML subset parser. Behaves like packages/node/agent-core/src/yaml.js."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class _Line:
    indent: int
    content: str


def _split_flow(text: str) -> list[str]:
    parts: list[str] = []
    current = ""
    quote: str | None = None
    for ch in text:
        if quote:
            current += ch
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            current += ch
        elif ch == ",":
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p.strip() for p in parts if p.strip()]


def coerce(value: str) -> Any:
    text = value.strip()
    if text in {"", "null", "~"}:
        return None
    if text in {"true", "True"}:
        return True
    if text in {"false", "False"}:
        return False
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1].replace("''", "'")
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        return [coerce(i) for i in _split_flow(inner)] if inner else []
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return text


def _tokenise(text: str) -> list[_Line]:
    lines = []
    for raw in text.splitlines():
        expanded = raw.replace("\t", "  ")
        stripped = expanded.strip()
        if stripped and not stripped.startswith("#"):
            lines.append(_Line(len(expanded) - len(expanded.lstrip()), stripped))
    return lines


def _split_key(content: str) -> tuple[str, str] | None:
    quote: str | None = None
    for i, ch in enumerate(content):
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            if i == 0:
                quote = ch
            continue
        if ch == ":" and (i + 1 == len(content) or content[i + 1].isspace()):
            return content[:i].strip().strip("\"'"), content[i + 1:].strip()
    return None


def _is_item(line: _Line) -> bool:
    return line.content == "-" or line.content.startswith("- ")


def _parse_block(lines: list[_Line], start: int, indent: int) -> tuple[Any, int]:
    if start < len(lines) and _is_item(lines[start]):
        return _parse_sequence(lines, start, indent)
    return _parse_mapping(lines, start, indent)


def _parse_sequence(lines: list[_Line], start: int, indent: int) -> tuple[list[Any], int]:
    items: list[Any] = []
    i = start
    while i < len(lines) and lines[i].indent == indent and _is_item(lines[i]):
        rest = lines[i].content[1:].strip()
        child_start = i + 1
        child_end = child_start
        while child_end < len(lines) and lines[child_end].indent > indent:
            child_end += 1
        if rest == "":
            items.append(_parse_block(lines, child_start, lines[child_start].indent)[0] if child_end > child_start else None)
        elif _split_key(rest) and not rest.startswith("["):
            content_indent = indent + (len(lines[i].content) - len(rest))
            synthetic = [_Line(0, rest)] + [_Line(lines[j].indent - content_indent, lines[j].content) for j in range(child_start, child_end)]
            items.append(_parse_mapping(synthetic, 0, 0)[0])
        else:
            items.append(coerce(rest))
        i = child_end
    return items, i


def _parse_mapping(lines: list[_Line], start: int, indent: int) -> tuple[dict[str, Any], int]:
    mapping: dict[str, Any] = {}
    i = start
    while i < len(lines) and lines[i].indent == indent:
        parts = _split_key(lines[i].content)
        if parts is None:
            i += 1
            continue
        key, value = parts
        if value not in ("", "|", ">"):
            mapping[key] = coerce(value)
            i += 1
            continue
        child_start = i + 1
        if value in ("|", ">"):
            end = child_start
            while end < len(lines) and lines[end].indent > indent:
                end += 1
            mapping[key] = ("\n" if value == "|" else " ").join(l.content for l in lines[child_start:end])
            i = end
        elif child_start < len(lines) and lines[child_start].indent > indent:
            mapping[key], i = _parse_block(lines, child_start, lines[child_start].indent)
        elif child_start < len(lines) and lines[child_start].indent == indent and _is_item(lines[child_start]):
            mapping[key], i = _parse_sequence(lines, child_start, indent)
        else:
            mapping[key] = None
            i = child_start
    return mapping, i


def parse_yaml(text: str) -> Any:
    lines = _tokenise(text)
    return _parse_block(lines, 0, lines[0].indent)[0] if lines else {}
