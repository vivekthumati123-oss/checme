---
name: copilot-metrics-fetcher
title: Copilot Metrics Fetcher
description: Fetches GitHub Copilot usage metrics from the GitHub REST API using PAT authentication with NDJSON report download support.
---

# Copilot Metrics Fetcher

## Purpose
Ingest live Copilot consumption data via PAT-authenticated REST API calls to the Reports API.

## Inputs
- github_token: Personal Access Token with read:org scope
- github_org: GitHub organization slug
- api_version: default 2022-11-28

## Steps
1. Validate PAT scopes.
2. GET `/orgs/{org}/copilot/metrics/reports/organization-28-day/latest` for org metrics.
3. Download NDJSON from signed URLs (parse line-by-line as JSON).
4. Optionally GET `users-1-day` and `user-teams-1-day` for per-team breakdown.
5. Return normalized data structures.

## Outputs
- `metrics_28day`: List of daily metric records.

## Failure Modes
- 401 bad PAT.
- 403 missing scope or metrics not enabled in Enterprise settings.
- 404 org not found or Copilot metrics disabled.
- NDJSON URL expired (>1hr).
- Rate limit exceeded (429).
