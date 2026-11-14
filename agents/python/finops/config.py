"""Configuration for the repo-native FinOps monitor."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Config:
    """Strongly typed configuration for the Copilot budget monitor."""

    github_token: str
    github_org: str
    monthly_budget_usd: float
    alert_threshold_percent: float
    teams_webhook_url: str = ""
    seat_cost_usd: float = 19.0
    copilot_plan: str = "business"
    dry_run: bool = False

    @classmethod
    def from_env(cls) -> "Config":
        required_vars = [
            "GITHUB_TOKEN",
            "COPILOT_ORG",
            "MONTHLY_BUDGET_USD",
        ]
        missing = [name for name in required_vars if not os.environ.get(name)]
        if missing:
            raise ValueError(f"Missing required environment variables: {', '.join(missing)}")

        try:
            monthly_budget = float(os.environ["MONTHLY_BUDGET_USD"])
            if monthly_budget < 0:
                raise ValueError("MONTHLY_BUDGET_USD cannot be negative")
        except ValueError as exc:  # noqa: PERF203 - preserve clear validation error
            raise ValueError(f"Invalid MONTHLY_BUDGET_USD: {exc}") from exc

        threshold_str = os.environ.get("ALERT_THRESHOLD_PERCENT") or "90"
        try:
            threshold = float(threshold_str)
        except ValueError as exc:
            raise ValueError(f"Invalid ALERT_THRESHOLD_PERCENT: {threshold_str}") from exc

        seat_cost = float(os.environ.get("SEAT_COST_USD") or "19.0")
        plan = (os.environ.get("COPILOT_PLAN") or "business").lower()
        dry_run = os.environ.get("DRY_RUN", "false").strip().lower() in ("true", "1", "yes")

        return cls(
            github_token=os.environ["GITHUB_TOKEN"],
            github_org=os.environ["COPILOT_ORG"],
            monthly_budget_usd=monthly_budget,
            alert_threshold_percent=threshold,
            teams_webhook_url=os.environ.get("TEAMS_WEBHOOK_URL", ""),
            seat_cost_usd=seat_cost,
            copilot_plan=plan,
            dry_run=dry_run,
        )

    def __repr__(self) -> str:
        return (
            f"Config(org='{self.github_org}', "
            f"budget=${self.monthly_budget_usd:.0f}, "
            f"threshold={self.alert_threshold_percent}%, "
            f"plan='{self.copilot_plan}', "
            f"seat_cost=${self.seat_cost_usd:.0f}, "
            f"dry_run={self.dry_run})"
        )
