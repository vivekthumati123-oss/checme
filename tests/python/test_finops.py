import asyncio
from contextlib import redirect_stdout
from io import StringIO
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import requests
from agent_core import ActorContext, AgentRequest, TriggerContext, load_binding, repo_root
from agent_runtime.agent_runtime import MockAgentRuntime
from agent_runtime.context import build_execution_context
from github_adapter import InMemoryMetricsClient

from agents.python.finops.finops_agent import FinOpsAgent, build_alerts, report_date, summarise_metrics, summarise_seats
from agents.python.finops.config import Config
from agents.python.finops.cost_calculator import CostCalculator, FinOpsResult
from agents.python.finops.github_client import GitHubAPIError, GitHubCopilotClient
from agents.python.finops.insight_engine import InsightEngine, InsightReport, UsageSummary
from agents.python.finops.teams_notifier import TeamsNotifier

import agents.python.finops.monitor as finops_monitor

ROOT = repo_root(Path(__file__).resolve().parent)
FIXTURE = json.loads((ROOT / "examples/sample-events/copilot-metrics.json").read_text())
AS_OF = datetime(2026, 8, 30, tzinfo=timezone.utc)


class FinOpsTests(unittest.TestCase):
    def test_calculations(self) -> None:
        self.assertEqual(report_date(FIXTURE["metrics"]), AS_OF)
        totals = summarise_metrics(FIXTURE["metrics"])
        self.assertEqual((totals["suggestions"], totals["acceptanceRatePercent"]), (25240, 28.5))
        seats = summarise_seats(FIXTURE["seats"], 39, as_of=AS_OF)
        self.assertEqual(seats["inactiveLogins"], ["eltp-01", "eltp-02", "eltp-03"])
        self.assertEqual({a["type"] for a in build_alerts(totals, seats, {"monthlyBudget": 300})}, {"budget", "waste"})

    def test_end_to_end(self) -> None:
        binding = load_binding("finops", ROOT)
        request = AgentRequest(binding.id, TriggerContext("schedule", "github", "schedule"), ActorContext("1", "bot"), payload={"monthlyBudget": 300})
        seen = {}

        async def narrative(options):
            seen["o"] = options
            return {"narrative": "Reclaim seats.", "topAction": "Reclaim seats"}

        context = build_execution_context(request, binding, runtime=MockAgentRuntime({"finops": narrative}), hooks=False)
        result = asyncio.run(FinOpsAgent(binding, InMemoryMetricsClient(FIXTURE["metrics"], FIXTURE["seats"])).execute(request, context))
        self.assertEqual(result.metrics.model, "mock:gpt-5")
        self.assertEqual(json.loads(seen["o"].user_prompt)["mode"], "automation")
        self.assertIn("Metrics glossary", seen["o"].system_prompt)
        self.assertIn("spend", result.data)
        self.assertIn("budget", result.data)
        self.assertIn("usage", result.data)
        self.assertTrue(result.data["budget"]["thresholdBreached"])
        self.assertIsNotNone(result.data["adaptiveCard"])
        self.assertEqual(result.data["adaptiveCard"]["type"], "AdaptiveCard")
        self.assertTrue(any(a.type == "adaptive-card" for a in result.artifacts))

    def test_monitor_orchestrates_repo_native_dependencies(self) -> None:
        config = SimpleNamespace(
            github_token="test-token",
            github_org="example-org",
            monthly_budget_usd=300,
            seat_cost_usd=39,
            alert_threshold_percent=90,
            teams_webhook_url="https://example.invalid/webhook",
            dry_run=False,
        )
        metrics = [{"total_active_users": 5}]
        cost = SimpleNamespace(
            active_users_28d=5,
            minimum_estimated_cost=195,
            monthly_budget_usd=300,
            percent_consumed=65,
            alert_threshold_percent=90,
            threshold_breached=False,
        )
        insights = SimpleNamespace(
            usage_summary=SimpleNamespace(acceptance_rate=28.5),
            recommendations=["Review adoption", "Reclaim unused seats", "Track trends"],
        )
        output = StringIO()

        with (
            patch.object(finops_monitor.Config, "from_env", return_value=config),
            patch.object(finops_monitor, "GitHubCopilotClient") as client_type,
            patch.object(finops_monitor, "CostCalculator") as calculator_type,
            patch.object(finops_monitor, "InsightEngine") as insight_type,
            patch.object(finops_monitor, "TeamsNotifier") as notifier_type,
            redirect_stdout(output),
        ):
            client_type.return_value.get_org_metrics_28day.return_value = metrics
            calculator_type.return_value.calculate.return_value = cost
            insight_type.return_value.analyze.return_value = insights

            # Act
            status = finops_monitor.main()

        # Assert: healthy budget should emit FINOPS_BUDGET_OK and NOT call Teams notifier
        self.assertEqual(status, 0)
        self.assertIn("FINOPS_BUDGET_OK", output.getvalue())
        client_type.assert_called_once_with(config.github_token, config.github_org)
        calculator_type.return_value.calculate.assert_called_once_with(metrics)
        insight_type.return_value.analyze.assert_called_once_with(metrics, cost)
        notifier_type.assert_not_called()

    def test_monitor_dispatches_alert_when_threshold_breached(self) -> None:
        config = SimpleNamespace(
            github_token="test-token",
            github_org="example-org",
            monthly_budget_usd=300,
            seat_cost_usd=39,
            alert_threshold_percent=90,
            teams_webhook_url="https://example.invalid/webhook",
            dry_run=False,
        )
        metrics = [{"total_active_users": 8}]
        cost = SimpleNamespace(
            active_users_28d=8,
            minimum_estimated_cost=312,
            monthly_budget_usd=300,
            percent_consumed=104,
            alert_threshold_percent=90,
            threshold_breached=True,
        )
        insights = SimpleNamespace(
            usage_summary=SimpleNamespace(acceptance_rate=28.5),
            recommendations=["Review adoption", "Reclaim unused seats", "Track trends"],
        )
        output = StringIO()

        with (
            patch.object(finops_monitor.Config, "from_env", return_value=config),
            patch.object(finops_monitor, "GitHubCopilotClient") as client_type,
            patch.object(finops_monitor, "CostCalculator") as calculator_type,
            patch.object(finops_monitor, "InsightEngine") as insight_type,
            patch.object(finops_monitor, "TeamsNotifier") as notifier_type,
            redirect_stdout(output),
        ):
            client_type.return_value.get_org_metrics_28day.return_value = metrics
            calculator_type.return_value.calculate.return_value = cost
            insight_type.return_value.analyze.return_value = insights
            notifier_type.return_value.send_alert.return_value = True

            # Act
            status = finops_monitor.main()

        # Assert: breached threshold dispatches Teams alert
        self.assertEqual(status, 0)
        self.assertIn("FINOPS_ALERT_SENT", output.getvalue())
        notifier_type.return_value.send_alert.assert_called_once_with(config.github_org, cost, insights)

    def test_monitor_returns_error_when_webhook_delivery_fails(self) -> None:
        config = SimpleNamespace(
            github_token="test-token",
            github_org="example-org",
            monthly_budget_usd=300,
            seat_cost_usd=39,
            alert_threshold_percent=90,
            teams_webhook_url="https://example.invalid/webhook",
            dry_run=False,
        )
        metrics = [{"total_active_users": 8}]
        cost = SimpleNamespace(
            active_users_28d=8,
            minimum_estimated_cost=312,
            monthly_budget_usd=300,
            percent_consumed=104,
            alert_threshold_percent=90,
            threshold_breached=True,
        )
        insights = SimpleNamespace(
            usage_summary=SimpleNamespace(acceptance_rate=28.5),
            recommendations=["Review adoption", "Reclaim unused seats", "Track trends"],
        )
        output = StringIO()

        with (
            patch.object(finops_monitor.Config, "from_env", return_value=config),
            patch.object(finops_monitor, "GitHubCopilotClient") as client_type,
            patch.object(finops_monitor, "CostCalculator") as calculator_type,
            patch.object(finops_monitor, "InsightEngine") as insight_type,
            patch.object(finops_monitor, "TeamsNotifier") as notifier_type,
            redirect_stdout(output),
        ):
            client_type.return_value.get_org_metrics_28day.return_value = metrics
            calculator_type.return_value.calculate.return_value = cost
            insight_type.return_value.analyze.return_value = insights
            notifier_type.return_value.send_alert.return_value = False

            # Act
            status = finops_monitor.main()

        # Assert: failed delivery returns exit code 1
        self.assertEqual(status, 1)
        self.assertIn("FINOPS_ALERT_FAILED: Webhook delivery failed.", output.getvalue())
        notifier_type.return_value.send_alert.assert_called_once_with(config.github_org, cost, insights)

    def test_monitor_dry_run_suppresses_alert(self) -> None:
        config = SimpleNamespace(
            github_token="test-token",
            github_org="example-org",
            monthly_budget_usd=300,
            seat_cost_usd=39,
            alert_threshold_percent=90,
            teams_webhook_url="https://example.invalid/webhook",
            dry_run=True,
        )
        metrics = [{"total_active_users": 8}]
        cost = SimpleNamespace(
            active_users_28d=8,
            minimum_estimated_cost=312,
            monthly_budget_usd=300,
            percent_consumed=104,
            alert_threshold_percent=90,
            threshold_breached=True,
        )
        insights = SimpleNamespace(
            usage_summary=SimpleNamespace(acceptance_rate=28.5),
            recommendations=["Review adoption", "Reclaim unused seats", "Track trends"],
        )
        output = StringIO()

        with (
            patch.object(finops_monitor.Config, "from_env", return_value=config),
            patch.object(finops_monitor, "GitHubCopilotClient") as client_type,
            patch.object(finops_monitor, "CostCalculator") as calculator_type,
            patch.object(finops_monitor, "InsightEngine") as insight_type,
            patch.object(finops_monitor, "TeamsNotifier") as notifier_type,
            redirect_stdout(output),
        ):
            client_type.return_value.get_org_metrics_28day.return_value = metrics
            calculator_type.return_value.calculate.return_value = cost
            insight_type.return_value.analyze.return_value = insights

            # Act
            status = finops_monitor.main()

        # Assert: breached threshold with dry_run=True does not call Teams notifier
        self.assertEqual(status, 0)
        self.assertIn("FINOPS_DRY_RUN_OK", output.getvalue())
        notifier_type.assert_not_called()

    def test_cost_calculator_boundaries(self) -> None:
        calc = CostCalculator(monthly_budget_usd=300, seat_cost_usd=30, alert_threshold_percent=80)
        # Healthy: 2 users * $30 = $60 (20% of budget)
        healthy = calc.calculate([{"total_active_users": 2}])
        self.assertEqual(healthy.severity, "ok")
        self.assertFalse(healthy.threshold_breached)
        self.assertEqual(healthy.percent_consumed, 20.0)

        # Warning: 9 users * $30 = $270 (90% of budget, >= 80% and <= 100%)
        warning = calc.calculate([{"total_active_users": 9}])
        self.assertEqual(warning.severity, "warning")
        self.assertTrue(warning.threshold_breached)

        # Exact 100% boundary: 10 users * $30 = $300 (100% of budget, remains warning per teams-alert-format instruction)
        exact_100 = calc.calculate([{"total_active_users": 10}])
        self.assertEqual(exact_100.severity, "warning")
        self.assertTrue(exact_100.threshold_breached)

        # Critical: 12 users * $30 = $360 (120% of budget, > 100%)
        critical = calc.calculate([{"total_active_users": 12}])
        self.assertEqual(critical.severity, "critical")
        self.assertTrue(critical.threshold_breached)

    def test_config_from_env_validation(self) -> None:
        with patch.dict("os.environ", {"GITHUB_TOKEN": "tok", "COPILOT_ORG": "org", "MONTHLY_BUDGET_USD": "500"}, clear=True):
            cfg = Config.from_env()
            self.assertEqual(cfg.github_token, "tok")
            self.assertEqual(cfg.github_org, "org")
            self.assertEqual(cfg.monthly_budget_usd, 500.0)
            self.assertEqual(cfg.teams_webhook_url, "")
            self.assertFalse(cfg.dry_run)

        # Test DRY_RUN parsing
        with patch.dict("os.environ", {"GITHUB_TOKEN": "tok", "COPILOT_ORG": "org", "MONTHLY_BUDGET_USD": "500", "DRY_RUN": "true"}, clear=True):
            cfg = Config.from_env()
            self.assertTrue(cfg.dry_run)

        # Missing required variable raises ValueError
        with patch.dict("os.environ", {"GITHUB_TOKEN": "tok"}, clear=True):
            with self.assertRaises(ValueError):
                Config.from_env()

        # Empty string workflow variables fallback to defaults
        with patch.dict(
            "os.environ",
            {
                "GITHUB_TOKEN": "tok",
                "COPILOT_ORG": "org",
                "MONTHLY_BUDGET_USD": "500",
                "ALERT_THRESHOLD_PERCENT": "",
                "SEAT_COST_USD": "",
                "COPILOT_PLAN": "",
                "DRY_RUN": "",
            },
            clear=True,
        ):
            cfg = Config.from_env()
            self.assertEqual(cfg.alert_threshold_percent, 90.0)
            self.assertEqual(cfg.seat_cost_usd, 19.0)
            self.assertEqual(cfg.copilot_plan, "business")
            self.assertFalse(cfg.dry_run)

    def test_teams_notifier_card_format(self) -> None:
        notifier = TeamsNotifier("https://example.invalid/webhook")
        result = FinOpsResult(
            active_users_28d=5,
            seat_cost_per_month=39.0,
            minimum_estimated_cost=195.0,
            monthly_budget_usd=300.0,
            percent_consumed=65.0,
            severity="warning",
            threshold_breached=True,
        )
        insights = InsightReport(
            usage_summary=UsageSummary(avg_active_users=5, total_lines_suggested=100, total_lines_accepted=30, acceptance_rate=30.0),
            recommendations=["Rec 1", "Rec 2", "Rec 3"],
        )
        card = notifier._build_adaptive_card("my-org", result, insights)
        body = card["attachments"][0]["content"]["body"]
        header = body[0]
        self.assertEqual(header["color"], "attention")
        fact_set = body[2]
        fact_titles = [f["title"] for f in fact_set["facts"]]
        self.assertIn("Min. Estimated Cost", fact_titles)
        self.assertNotIn("Credits Used", fact_titles)

    def test_download_ndjson_failure_raises_github_api_error(self) -> None:
        client = GitHubCopilotClient(token="test-token", org="test-org")
        with patch.object(client.session, "get", side_effect=requests.RequestException("Connection timed out")):
            # Note: _download_ndjson uses requests.get directly for signed S3 URLs
            pass
        with patch("requests.get", side_effect=requests.RequestException("Connection timed out")):
            with self.assertRaises(GitHubAPIError) as ctx:
                client._download_ndjson(["https://example.invalid/signed-report.ndjson"])
            self.assertIn("Failed to download an NDJSON metrics report.", str(ctx.exception))

    def test_download_ndjson_malformed_line_raises_github_api_error(self) -> None:
        client = GitHubCopilotClient(token="test-token", org="test-org")
        mock_response = SimpleNamespace(
            raise_for_status=lambda: None,
            text='{"total_active_users": 10}\n{malformed-json}\n',
        )
        with patch("requests.get", return_value=mock_response):
            with self.assertRaises(GitHubAPIError) as ctx:
                client._download_ndjson(["https://example.invalid/signed-report.ndjson"])
            self.assertIn("Malformed NDJSON at line 2.", str(ctx.exception))

    def test_insight_engine_reports_api_normalization(self) -> None:
        engine = InsightEngine()
        metrics = [
            {
                "date": "2026-08-25",
                "daily_active_users": 6,
                "totals_by_feature": [
                    {
                        "feature": "code_completion",
                        "loc_suggested_to_add_sum": 1000,
                        "loc_added_sum": 300,
                    }
                ],
                "totals_by_language_feature": [
                    {
                        "language": "python",
                        "feature": "code_completion",
                        "loc_added_sum": 200,
                    },
                    {
                        "language": "typescript",
                        "feature": "code_completion",
                        "loc_added_sum": 100,
                    },
                ],
            }
        ]
        result = FinOpsResult(active_users_28d=6, minimum_estimated_cost=114, monthly_budget_usd=300)
        report = engine.analyze(metrics, result)
        self.assertEqual(report.usage_summary.avg_active_users, 6)
        self.assertEqual(report.usage_summary.total_lines_suggested, 1000)
        self.assertEqual(report.usage_summary.total_lines_accepted, 300)
        self.assertEqual(report.usage_summary.acceptance_rate, 30.0)
        self.assertEqual(report.usage_summary.top_languages, ["python", "typescript"])
        self.assertEqual(len(report.recommendations), 3)

    def test_monitor_policy_denial_blocks_alert(self) -> None:
        config = SimpleNamespace(
            github_token="test-token",
            github_org="example-org",
            monthly_budget_usd=300,
            seat_cost_usd=39,
            alert_threshold_percent=90,
            teams_webhook_url="https://example.invalid/webhook",
            dry_run=False,
        )
        metrics = [{"total_active_users": 8}]
        cost = SimpleNamespace(
            active_users_28d=8,
            minimum_estimated_cost=312,
            monthly_budget_usd=300,
            percent_consumed=104,
            alert_threshold_percent=90,
            threshold_breached=True,
        )
        insights = SimpleNamespace(
            usage_summary=SimpleNamespace(acceptance_rate=28.5),
            recommendations=["Review adoption", "Reclaim unused seats", "Track trends"],
        )
        denied_binding = SimpleNamespace(
            policy={"rules": [{"action": "notification.send", "effect": "deny", "reason": "Policy denies all notifications"}]},
            hook_names=[],
        )
        output = StringIO()

        with (
            patch.object(finops_monitor.Config, "from_env", return_value=config),
            patch.object(finops_monitor, "GitHubCopilotClient") as client_type,
            patch.object(finops_monitor, "CostCalculator") as calculator_type,
            patch.object(finops_monitor, "InsightEngine") as insight_type,
            patch.object(finops_monitor, "load_binding", return_value=denied_binding),
            patch.object(finops_monitor, "TeamsNotifier") as notifier_type,
            redirect_stdout(output),
        ):
            client_type.return_value.get_org_metrics_28day.return_value = metrics
            calculator_type.return_value.calculate.return_value = cost
            insight_type.return_value.analyze.return_value = insights

            status = finops_monitor.main()

        self.assertEqual(status, 0)
        self.assertIn("FINOPS_ALERT_SKIPPED: Policy blocked notification", output.getvalue())
        notifier_type.assert_not_called()


if __name__ == "__main__":
    unittest.main()
