"""FinOps entry point. Offline: make demo-python. Real: AGENT_RUNTIME=copilot GITHUB_ORG=<org> GITHUB_TOKEN=... python -m agents.python.finops.main"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from agent_runtime import run_agent
from github_adapter import CopilotMetricsClient, InMemoryMetricsClient

from agents.python.finops.finops_agent import FinOpsAgent


def build_metrics_client():
    fixture = os.environ.get("METRICS_FIXTURE")
    if fixture:
        data = json.loads(Path(fixture).read_text(encoding="utf-8"))
        return InMemoryMetricsClient(data["metrics"], data["seats"])
    return CopilotMetricsClient(org=os.environ["GITHUB_ORG"])


async def _mock_narrative(options) -> dict:
    return {"narrative": "Reclaiming inactive Copilot seats is the fastest saving available this month. Usage among active seats is healthy, with acceptance above the 20 percent guidance.",
            "topAction": "Reclaim inactive seats"}


async def main() -> None:
    client = build_metrics_client()
    budget = os.environ.get("MONTHLY_BUDGET")
    await run_agent("finops", lambda binding: FinOpsAgent(binding, client),
                    payload={"since": os.environ.get("SINCE"), "until": os.environ.get("UNTIL"), "monthlyBudget": float(budget) if budget else None},
                    mock_handlers={"finops": _mock_narrative})


if __name__ == "__main__":
    asyncio.run(main())
