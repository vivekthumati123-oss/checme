"""Insight aggregation for the repo-native FinOps monitor."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .cost_calculator import FinOpsResult

logger = logging.getLogger(__name__)


@dataclass
class UsageSummary:
    avg_active_users: int = 0
    total_lines_suggested: int = 0
    total_lines_accepted: int = 0
    acceptance_rate: float = 0.0
    top_languages: list[str] | None = None


@dataclass
class InsightReport:
    usage_summary: UsageSummary
    recommendations: list[str]


class InsightEngine:
    def analyze(self, metrics_28day: list[dict], result: FinOpsResult) -> InsightReport:
        summary = self._summarize_metrics(metrics_28day)
        recommendations = self._generate_recommendations(summary, result)
        return InsightReport(usage_summary=summary, recommendations=recommendations)

    def _summarize_metrics(self, metrics: list[dict]) -> UsageSummary:
        summary = UsageSummary(top_languages=[])
        if not metrics:
            return summary

        active_users: list[int] = []
        lines_suggested = 0
        lines_accepted = 0
        lang_counts: dict[str, int] = {}

        for day in metrics:
            active_users.append(day.get("total_active_users", day.get("daily_active_users", 0)))
            for feature in day.get("totals_by_feature", []):
                if feature.get("feature") in ("code_completions", "code_completion"):
                    lines_suggested += (
                        feature.get("total_lines_suggested")
                        or feature.get("loc_suggested_to_add_sum")
                        or 0
                    )
                    lines_accepted += (
                        feature.get("total_lines_accepted")
                        or feature.get("loc_added_sum")
                        or 0
                    )

            for language_feature in day.get("totals_by_language_feature", []):
                if language_feature.get("feature") in ("code_completions", "code_completion"):
                    name = language_feature.get("language")
                    if name:
                        accepted_lines = (
                            language_feature.get("total_lines_accepted")
                            or language_feature.get("loc_added_sum")
                            or 0
                        )
                        lang_counts[name] = lang_counts.get(name, 0) + accepted_lines

        if active_users:
            summary.avg_active_users = int(sum(active_users) / len(active_users))

        summary.total_lines_suggested = lines_suggested
        summary.total_lines_accepted = lines_accepted

        if lines_suggested > 0:
            summary.acceptance_rate = (lines_accepted / lines_suggested) * 100

        sorted_langs = sorted(lang_counts.items(), key=lambda item: item[1], reverse=True)
        summary.top_languages = [name for name, _ in sorted_langs[:3]]
        return summary

    def _generate_recommendations(self, summary: UsageSummary, result: FinOpsResult) -> list[str]:
        recs: list[str] = []

        if 0 < summary.acceptance_rate < 25.0:
            recs.append(
                f"Your Copilot acceptance rate is low ({summary.acceptance_rate:.1f}%). "
                "Schedule a prompt engineering workshop to improve context usage and developer efficiency."
            )
        elif summary.acceptance_rate > 35.0:
            recs.append(
                f"High acceptance rate ({summary.acceptance_rate:.1f}%) indicates strong value. "
                "Consider upgrading power users to Copilot Enterprise for internal codebase grounding."
            )
        else:
            recs.append(
                f"Acceptance rate is average ({summary.acceptance_rate:.1f}%). "
                "Encourage developers to leave tabs open longer to give the AI more context."
            )

        if summary.top_languages:
            langs = ", ".join(summary.top_languages)
            recs.append(
                f"Top usage is in {langs}. Focus future internal training and IDE optimization specifically on these ecosystems to maximize ROI."
            )
        else:
            recs.append(
                "Language telemetry is missing. Ensure developers are using the latest Copilot extension versions."
            )

        recs.append(
            f"Your active users are generating at least ${result.minimum_estimated_cost:,.0f}/mo in licensing costs. "
            "Since we cannot see inactive seats, manually check the GitHub billing portal for idle licenses."
        )

        return recs[:3]
