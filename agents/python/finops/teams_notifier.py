"""Microsoft Teams notification adapter for the repo-native FinOps monitor."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

import requests

from .cost_calculator import FinOpsResult
from .insight_engine import InsightReport

logger = logging.getLogger(__name__)


class TeamsNotifier:
    def __init__(self, webhook_url: str) -> None:
        self.webhook_url = webhook_url

    def send_alert(self, org: str, result: FinOpsResult, insights: InsightReport) -> bool:
        if not self.webhook_url:
            logger.warning("No TEAMS_WEBHOOK_URL configured. Skipping alert dispatch.")
            return False

        card = self._build_adaptive_card(org, result, insights)
        try:
            response = requests.post(
                self.webhook_url,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                },
                json=card,
                timeout=10,
            )
            if not response.ok:
                logger.error("Webhook failed. Status: %s, Body: %s", response.status_code, response.text)
            response.raise_for_status()
            return True
        except requests.RequestException as exc:
            logger.error("Failed to dispatch Teams alert (%s)", type(exc).__name__)
            return False

    def _build_adaptive_card(self, org: str, result: FinOpsResult, insights: InsightReport) -> dict:
        if result.severity == "critical":
            color = "accent"
            color_hex = "🔴"
        elif result.severity == "warning":
            color = "attention"
            color_hex = "🟡"
        else:
            color = "good"
            color_hex = "🟢"

        title = f"{color_hex} FinOps Report: {org}"

        return {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "contentUrl": None,
                    "content": {
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "type": "AdaptiveCard",
                        "version": "1.5",
                        "body": [
                            {
                                "type": "TextBlock",
                                "size": "Large",
                                "weight": "Bolder",
                                "text": title,
                                "color": color,
                            },
                            {
                                "type": "TextBlock",
                                "text": "Minimum Estimated Cost exceeded budget threshold.",
                                "wrap": True,
                            },
                            {
                                "type": "FactSet",
                                "facts": [
                                    {"title": "Min. Estimated Cost", "value": f"${result.minimum_estimated_cost:,.0f} / mo"},
                                    {"title": "Monthly Budget", "value": f"${result.monthly_budget_usd:,.0f}"},
                                    {"title": "Budget Consumed", "value": f"{result.percent_consumed:.1f}%"},
                                    {"title": "Active Users (28d)", "value": str(result.active_users_28d)},
                                    {"title": "Acceptance Rate", "value": f"{insights.usage_summary.acceptance_rate:.1f}%"},
                                ],
                            },
                            {
                                "type": "TextBlock",
                                "size": "Medium",
                                "weight": "Bolder",
                                "text": "Recommendations",
                                "spacing": "Medium",
                            },
                            {
                                "type": "TextBlock",
                                "text": "\n".join(f"{index + 1}. {recommendation}" for index, recommendation in enumerate(insights.recommendations)),
                                "wrap": True,
                            },
                            {
                                "type": "TextBlock",
                                "text": f"Run UTC: {datetime.now(timezone.utc).isoformat()} | ID: {uuid.uuid4()}",
                                "size": "Small",
                                "weight": "Lighter",
                                "spacing": "Medium",
                            },
                        ],
                    },
                }
            ],
        }
