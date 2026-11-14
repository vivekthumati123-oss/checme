---
name: cost-projection-engine
title: Cost Projection Engine (Metrics-Only)
description: Calculates minimum estimated current Copilot spend based on active usage metrics.
---

# Cost Projection Engine (Metrics-Only)

## Purpose
Deterministic financial evaluation of Copilot spend using "Minimum Estimated Cost" based on active users, circumventing enterprise billing restrictions.

## Inputs
- metrics_28day
- monthly_budget_usd
- seat_cost_usd (default 19)
- alert_threshold_percent

## Steps
1. Identify the peak total active users from the 28-day metrics report.
2. Calculate minimum estimated monthly cost = `active_users_28d` × `seat_cost_usd`.
3. Compute days_elapsed and days_in_month using calendar.monthrange().
4. Compute percent_consumed = (minimum_estimated_cost / monthly_budget_usd) × 100.
5. Determine threshold breach status and severity.

## Outputs
- FinOpsResult dataclass with computed financial estimates.

## Failure Modes
- Metrics data empty (results in zero cost).
- Zero budget configured (rejects division by zero, forces 0% consumed).
