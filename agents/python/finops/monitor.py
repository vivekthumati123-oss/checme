"""Repository-native FinOps monitor entry point.

This keeps the operational behavior of the standalone monitor while living under the
main repo's Python agent layout and without any hard-coded references to the legacy
workspace directory name.
"""

from __future__ import annotations

import logging
import os
import sys
import traceback
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional local development dependency
    load_dotenv = None

from .config import Config
from .cost_calculator import CostCalculator
from .github_client import GitHubAPIError, GitHubCopilotClient
from .insight_engine import InsightEngine
from .teams_notifier import TeamsNotifier

ROOT_DIR = Path(__file__).resolve().parents[3]
packages_dir = str(ROOT_DIR / "packages" / "python")
if packages_dir not in sys.path:
    sys.path.insert(0, packages_dir)

try:
    from agent_core import HookRunner, PolicyEngine, load_binding
except ImportError:  # pragma: no cover
    HookRunner = PolicyEngine = load_binding = None

for env_path in (ROOT_DIR / ".env.local", ROOT_DIR / ".env"):
    if env_path.exists() and load_dotenv is not None:
        load_dotenv(dotenv_path=env_path, override=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("agents.python.finops.monitor")


def main() -> int:
    logger.info("=" * 60)
    logger.info("FinOps monitor starting")
    logger.info("=" * 60)

    try:
        config = Config.from_env()
        logger.info("Config loaded: %s", config)
    except ValueError as exc:
        logger.error("Configuration error: %s", exc)
        print(f"FINOPS_DATA_UNAVAILABLE: {exc}")
        return 1

    try:
        client = GitHubCopilotClient(config.github_token, config.github_org)
        logger.info("Fetching 28-day usage metrics...")
        metrics_28day = client.get_org_metrics_28day()
        if not metrics_28day:
            logger.error("No metrics found. Ensure Copilot metrics are enabled.")
            print("FINOPS_DATA_UNAVAILABLE: No metrics returned")
            return 1

        logger.info("Metrics: %d daily records from 28-day report", len(metrics_28day))
    except GitHubAPIError as exc:
        logger.error("GitHub API error: %s", exc)
        print(f"FINOPS_DATA_UNAVAILABLE: {exc}")
        return 1
    except Exception as exc:  # pragma: no cover - defensive guard for unexpected integration errors.
        logger.error("Unexpected error during data ingestion: %s", exc)
        logger.debug(traceback.format_exc())
        print(f"FINOPS_DATA_UNAVAILABLE: {exc}")
        return 1

    calculator = CostCalculator(
        monthly_budget_usd=config.monthly_budget_usd,
        seat_cost_usd=config.seat_cost_usd,
        alert_threshold_percent=config.alert_threshold_percent,
    )
    result = calculator.calculate(metrics_28day)

    logger.info("Active Users (28d peak): %d", result.active_users_28d)
    logger.info(
        "Estimated Cost: $%.0f min / $%.0f budget = %.1f%% consumed",
        result.minimum_estimated_cost,
        result.monthly_budget_usd,
        result.percent_consumed,
    )

    insights = InsightEngine().analyze(metrics_28day, result)
    logger.info("Acceptance Rate: %.1f%%", insights.usage_summary.acceptance_rate)

    logger.info("Recommendations:")
    for index, recommendation in enumerate(insights.recommendations, start=1):
        logger.info("  %d. %s", index, recommendation)

    if not result.threshold_breached:
        logger.info(
            "Budget healthy (%.1f%% consumed <= %.1f%% threshold). No alert dispatched.",
            result.percent_consumed,
            result.alert_threshold_percent,
        )
        print(f"FINOPS_BUDGET_OK: {result.percent_consumed:.1f}% consumed")
        logger.info("=" * 60)
        logger.info("FinOps monitor completed")
        logger.info("=" * 60)
        return 0

    if config.dry_run:
        logger.info("[DRY-RUN] Budget threshold breached but alert suppressed due to dry_run=True.")
        print(
            f"FINOPS_DRY_RUN_OK: {result.percent_consumed:.1f}% of budget consumed "
            f"(Min ${result.minimum_estimated_cost:,.0f}/${result.monthly_budget_usd:,.0f}) - alert suppressed"
        )
        logger.info("=" * 60)
        logger.info("FinOps monitor completed")
        logger.info("=" * 60)
        return 0

    if not config.teams_webhook_url:
        logger.info("Budget breached but no TEAMS_WEBHOOK_URL configured. Skipping alert dispatch.")
        print(
            f"FINOPS_ALERT_SKIPPED: {result.percent_consumed:.1f}% of budget consumed "
            f"(Min ${result.minimum_estimated_cost:,.0f}/${result.monthly_budget_usd:,.0f}) - no webhook URL"
        )
        logger.info("=" * 60)
        logger.info("FinOps monitor completed")
        logger.info("=" * 60)
        return 0

    hooks = None
    if load_binding is not None and PolicyEngine is not None:
        try:
            binding = load_binding("finops", ROOT_DIR)
            policy = PolicyEngine(binding.policy)
            decision = policy.evaluate("notification.send")
            if not decision.allowed or decision.requires_approval:
                logger.warning("Notification dispatch blocked by policy: %s", decision.reason)
                print(f"FINOPS_ALERT_SKIPPED: Policy blocked notification - {decision.reason}")
                logger.info("=" * 60)
                logger.info("FinOps monitor completed")
                logger.info("=" * 60)
                return 0

            if HookRunner is not None:
                hooks = HookRunner.load(ROOT_DIR, names=binding.hook_names, context={"agent": "finops"})
                hook_outcome = hooks.allow_tool("notification", {"action": "send", "org": config.github_org})
                if hook_outcome.decision == "deny":
                    logger.warning("Notification dispatch blocked by hook: %s", hook_outcome.reason)
                    print(f"FINOPS_ALERT_SKIPPED: Hook blocked notification - {hook_outcome.reason}")
                    logger.info("=" * 60)
                    logger.info("FinOps monitor completed")
                    logger.info("=" * 60)
                    return 0
        except Exception as exc:
            logger.warning("Policy/hook evaluation skipped due to unexpected error: %s", exc)

    notifier = TeamsNotifier(config.teams_webhook_url)
    alert_sent = notifier.send_alert(config.github_org, result, insights)

    if hooks is not None:
        hooks.run(
            "postToolUse",
            {
                "toolName": "notification",
                "toolResult": {"resultType": "success" if alert_sent else "failed"},
            },
        )

    if alert_sent:
        logger.info("Teams alert dispatched successfully")
        print(
            f"FINOPS_ALERT_SENT: {result.percent_consumed:.1f}% of budget consumed "
            f"(Min ${result.minimum_estimated_cost:,.0f}/${result.monthly_budget_usd:,.0f})"
        )
        logger.info("=" * 60)
        logger.info("FinOps monitor completed")
        logger.info("=" * 60)
        return 0

    logger.error("Teams alert delivery failed")
    print("FINOPS_ALERT_FAILED: Webhook delivery failed.")
    logger.info("=" * 60)
    logger.info("FinOps monitor completed with error")
    logger.info("=" * 60)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
