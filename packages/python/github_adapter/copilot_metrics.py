"""Copilot metrics and seat data for the FinOps agent (stdlib urllib)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class CopilotMetricsClient:
    def __init__(self, org: str, token: str | None = None, base_url: str = "https://api.github.com") -> None:
        self.org = org
        self.token = token or os.environ.get("GITHUB_TOKEN")
        self.base_url = base_url.rstrip("/")

    def _get(self, path: str) -> Any:
        if not self.token:
            raise RuntimeError("GITHUB_TOKEN is not set")
        request = urllib.request.Request(f"{self.base_url}{path}", headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                                                                             "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "l2-agent-platform"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"GitHub GET {path} failed: {error.code} {error.read().decode()[:300]}") from error

    def get_metrics(self, since: str | None = None, until: str | None = None) -> list[dict[str, Any]]:
        query = "&".join(f"{k}={v}" for k, v in (("since", since), ("until", until)) if v)
        return self._get(f"/orgs/{self.org}/copilot/metrics{'?' + query if query else ''}")

    def get_seats(self) -> dict[str, Any]:
        seats: list[dict[str, Any]] = []
        total = 0
        for page in range(1, 51):
            data = self._get(f"/orgs/{self.org}/copilot/billing/seats?per_page=100&page={page}")
            total = data.get("total_seats", total)
            seats.extend(data.get("seats", []))
            if len(data.get("seats", [])) < 100:
                break
        return {"total_seats": total, "seats": seats}


class InMemoryMetricsClient:
    def __init__(self, metrics: list[dict[str, Any]], seats: dict[str, Any]) -> None:
        self.metrics, self.seats = metrics, seats

    def get_metrics(self, since: str | None = None, until: str | None = None) -> list[dict[str, Any]]:
        return self.metrics

    def get_seats(self) -> dict[str, Any]:
        return self.seats
