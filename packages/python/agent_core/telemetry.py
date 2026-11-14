from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any

_LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40}


class Logger:
    def __init__(self, agent_id: str = "unknown", correlation_id: str | None = None, level: str = "info") -> None:
        self.base = {"agentId": agent_id, "correlationId": correlation_id}
        normalised = str(level).lower()
        self.level = normalised if normalised in _LEVELS else "info"

    def _write(self, level: str, message: str, **properties: Any) -> None:
        if _LEVELS[level] >= _LEVELS[self.level]:
            sys.stderr.write(json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(), "level": level, "message": message, **self.base, **properties}, default=str) + "\n")

    def debug(self, message: str, **p: Any) -> None: self._write("debug", message, **p)
    def info(self, message: str, **p: Any) -> None: self._write("info", message, **p)
    def warn(self, message: str, **p: Any) -> None: self._write("warn", message, **p)
    def error(self, message: str, **p: Any) -> None: self._write("error", message, **p)
