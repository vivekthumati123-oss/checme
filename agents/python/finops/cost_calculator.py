"""Deterministic cost calculations for the repo-native FinOps monitor."""

from __future__ import annotations

import calendar
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class FinOpsResult:
    active_users_28d: int = 0
    seat_cost_per_month: float = 19.0
    minimum_estimated_cost: float = 0.0
    monthly_budget_usd: float = 0.0
    credits_used: float = 0.0
    credits_remaining: float = 0.0
    days_elapsed: int = 0
    days_in_month: int = 30
    days_remaining: int = 0
    percent_consumed: float = 0.0
    alert_threshold_percent: float = 90.0
    threshold_breached: bool = False
    severity: str = "ok"


class CostCalculator:
    def __init__(self, monthly_budget_usd: float, seat_cost_usd: float = 19.0, alert_threshold_percent: float = 90.0) -> None:
        self.monthly_budget_usd = monthly_budget_usd
        self.seat_cost_usd = seat_cost_usd
        self.alert_threshold_percent = alert_threshold_percent

    def calculate(self, metrics_28day: list[dict]) -> FinOpsResult:
        now = datetime.now(timezone.utc)
        result = FinOpsResult()

        result.days_in_month = calendar.monthrange(now.year, now.month)[1]
        result.days_elapsed = now.day
        result.days_remaining = result.days_in_month - result.days_elapsed

        max_active_users = 0
        if metrics_28day:
            max_active_users = max(
                (record.get("total_active_users", record.get("daily_active_users", 0)) for record in metrics_28day),
                default=0,
            )

        result.active_users_28d = max_active_users
        result.seat_cost_per_month = self.seat_cost_usd
        result.minimum_estimated_cost = result.active_users_28d * self.seat_cost_usd
        result.monthly_budget_usd = self.monthly_budget_usd
        result.credits_used = result.minimum_estimated_cost
        result.credits_remaining = max(0.0, result.monthly_budget_usd - result.credits_used)

        if self.monthly_budget_usd > 0:
            result.percent_consumed = (result.minimum_estimated_cost / self.monthly_budget_usd) * 100
        else:
            result.percent_consumed = 0.0

        result.alert_threshold_percent = self.alert_threshold_percent
        result.threshold_breached = result.percent_consumed >= self.alert_threshold_percent

        if result.percent_consumed > 100:
            result.severity = "critical"
        elif result.percent_consumed >= self.alert_threshold_percent:
            result.severity = "warning"
        else:
            result.severity = "ok"

        logger.info(
            "FinOps (Metrics-Only): %d active users × $%.0f = $%.0f/mo minimum | Budget: $%.0f | Consumed: %.1f%% | Credits Remaining: $%.0f | Breached: %s",
            result.active_users_28d,
            self.seat_cost_usd,
            result.minimum_estimated_cost,
            self.monthly_budget_usd,
            result.percent_consumed,
            result.credits_remaining,
            result.threshold_breached,
        )
        return result
