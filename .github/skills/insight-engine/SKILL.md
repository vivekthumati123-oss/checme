---
name: insight-engine
title: Insight Engine (Metrics-Only)
description: Analyzes Copilot usage data to identify adoption trends, calculate acceptance rates, and generate 3 usage optimization recommendations.
---

# Insight Engine (Metrics-Only)

## Purpose
Transform raw usage telemetry into actionable intelligence focused on developer adoption and utilization efficiency.

## Inputs
- metrics_28day
- finops_result

## Steps
1. Aggregate the 28-day metrics array into a single `UsageSummary`.
2. Calculate the global Acceptance Rate (lines accepted / lines suggested).
3. Identify the top 3 programming languages/ecosystems by volume of accepted code.
4. Generate 3 targeted recommendations focusing on prompt engineering, training, or manual licensing checks (due to the lack of billing visibility).
5. Return InsightReport with the summary and recommendations.

## Outputs
- `InsightReport` dataclass containing `UsageSummary` and 3 string recommendations.

## Failure Modes
- Empty metrics (handles gracefully by returning empty summary and default generic recommendations).
