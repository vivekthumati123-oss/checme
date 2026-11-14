---
name: budget-threshold-alert
title: Budget Threshold Alert (Metrics-Only)
description: Fires when the Minimum Estimated Cost (based on active users) crosses the configured alert_threshold_percent of the monthly budget.
---

# Budget Threshold Alert (Metrics-Only)

## Trigger Event
Daily GitHub Actions cron schedule (0 6 * * * UTC) + manual workflow_dispatch.

## Detection Logic
1. Fetch 28-day usage metrics via copilot-metrics-fetcher.
2. Calculate Minimum Estimated Cost based on active users via cost-projection-engine.
3. Compare percent_consumed against alert_threshold_percent.
4. If threshold NOT breached: log FINOPS_BUDGET_OK and exit 0.
5. If threshold breached: invoke insight-engine for usage/adoption analysis.
6. Format and dispatch Teams Adaptive Card per teams-alert-format instruction.

## Block Behaviour
No block — alert only. Does not block any Copilot usage.

## Allowed Bypass
- Set ALERT_THRESHOLD_PERCENT to 100 to suppress warnings.
- Set TEAMS_WEBHOOK_URL to empty to disable alerting (data still collected and logged).

## Telemetry
Emits to stdout: FINOPS_BUDGET_OK or FINOPS_ALERT_SENT with percent_consumed. 
GitHub Actions run log retains full output.
