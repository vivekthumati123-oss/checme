"""Runs .github/hooks/*.json inside Python L2 agents. Mirrors hooks.js."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent_core.paths import Layout

HOOK_EVENTS = ("sessionStart", "sessionEnd", "userPromptSubmitted", "preToolUse", "postToolUse", "errorOccurred")


@dataclass
class HookOutcome:
    decision: str
    reason: str | None = None
    results: list[dict[str, Any]] = field(default_factory=list)


class HookRunner:
    def __init__(self, root: Path, configs: list[dict[str, Any]], logger: Any = None, context: dict[str, Any] | None = None) -> None:
        self.root, self.configs, self.logger, self.context = root, configs, logger, context or {}

    @classmethod
    def load(cls, root: Path, names: list[str] | None = None, logger: Any = None, context: dict[str, Any] | None = None) -> "HookRunner":
        configs = []
        directory = Layout(root).hooks
        if directory.exists():
            for path in sorted(directory.glob("*.json")):
                if names is None or path.stem in names:
                    configs.append({"name": path.stem, **json.loads(path.read_text(encoding="utf-8"))})
        return cls(root, configs, logger, context)

    def entries_for(self, event: str, tool_name: str | None) -> list[dict[str, Any]]:
        entries = []
        for config in self.configs:
            for entry in (config.get("hooks") or {}).get(event, []):
                matcher = entry.get("matcher")
                if matcher and tool_name and not re.fullmatch(f"(?:{matcher})", tool_name, re.IGNORECASE):
                    continue
                entries.append({**entry, "source": config["name"]})
        return entries

    def run(self, event: str, payload: dict[str, Any] | None = None) -> HookOutcome:
        body = {"timestamp": datetime.now(timezone.utc).isoformat(), "cwd": str(self.root), "source": "l2", **self.context, **(payload or {})}
        if "toolArgs" in body and not isinstance(body["toolArgs"], str):
            body["toolArgs"] = json.dumps(body["toolArgs"])
        results = []
        for entry in self.entries_for(event, body.get("toolName")):
            result = self._exec(entry, body)
            results.append(result)
            if event == "preToolUse" and result["decision"] == "deny":
                return HookOutcome("deny", result.get("reason"), results)
        return HookOutcome("allow", None, results)

    def allow_tool(self, tool_name: str, tool_args: dict[str, Any]) -> HookOutcome:
        return self.run("preToolUse", {"toolName": tool_name, "toolArgs": tool_args})

    def _exec(self, entry: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        windows = sys.platform.startswith("win")
        command = (entry.get("powershell") or entry.get("bash")) if windows else (entry.get("bash") or entry.get("powershell"))
        if not command:
            return {"source": entry["source"], "decision": "allow", "error": "no command for platform"}
        argv = ["powershell", "-NoProfile", "-Command", command] if windows else ["bash", "-c", command]
        try:
            completed = subprocess.run(argv, input=json.dumps(payload), capture_output=True, text=True, cwd=self.root / entry.get("cwd", "."),
                                       env={**os.environ, **{k: str(v) for k, v in (entry.get("env") or {}).items()}}, timeout=entry.get("timeoutSec", 30))
        except subprocess.TimeoutExpired:
            return {"source": entry["source"], "decision": "deny", "reason": f"hook timed out ({entry['source']})"}
        except OSError as error:
            return {"source": entry["source"], "decision": "allow", "error": str(error)}
        for line in reversed(completed.stdout.strip().splitlines()):
            try:
                output = json.loads(line)
            except json.JSONDecodeError:
                continue
            if output.get("permissionDecision") == "deny":
                return {"source": entry["source"], "decision": "deny", "reason": output.get("permissionDecisionReason", "denied by hook")}
            break
        if completed.returncode != 0:
            return {"source": entry["source"], "decision": "deny", "reason": completed.stderr.strip() or f"hook exited {completed.returncode}"}
        return {"source": entry["source"], "decision": "allow"}
