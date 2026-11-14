"""GitHub Copilot REST client used by the repo-native FinOps monitor."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import requests

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"
API_VERSION = "2022-11-28"


class GitHubAPIError(Exception):
    def __init__(self, status_code: int, message: str, endpoint: str) -> None:
        self.status_code = status_code
        self.endpoint = endpoint
        super().__init__(f"GitHub API error {status_code} on {endpoint}: {message}")


class GitHubCopilotClient:
    def __init__(self, token: str, org: str, timeout: int = 30) -> None:
        self.org = org
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": API_VERSION,
                "User-Agent": "l2-finops-monitor/1.0.0",
            }
        )

    def get_org_metrics_28day(self) -> list[dict]:
        endpoint = f"/orgs/{self.org}/copilot/metrics/reports/organization-28-day/latest"
        try:
            response = self._get(endpoint)
            download_links = response.get("download_links", [])
            if not download_links:
                logger.warning("No download links in 28-day metrics response")
                return []
            return self._download_ndjson(download_links)
        except GitHubAPIError as exc:
            if exc.status_code == 404:
                logger.warning("Metrics Reports API is unavailable: %s", exc)
                return []
            raise

    def get_user_metrics(self, day: str | None = None) -> list[dict]:
        if day is None:
            day = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")

        endpoint = f"/orgs/{self.org}/copilot/metrics/reports/users-1-day"
        try:
            response = self._get(endpoint, params={"day": day})
            download_links = response.get("download_links", [])
            if not download_links:
                return []
            return self._download_ndjson(download_links)
        except GitHubAPIError as exc:
            if exc.status_code == 404:
                logger.warning("User metrics are unavailable: %s", exc)
                return []
            raise

    def get_user_teams(self, day: str | None = None) -> list[dict]:
        if day is None:
            day = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")

        endpoint = f"/orgs/{self.org}/copilot/metrics/reports/user-teams-1-day"
        try:
            response = self._get(endpoint, params={"day": day})
            download_links = response.get("download_links", [])
            if not download_links:
                return []
            return self._download_ndjson(download_links)
        except GitHubAPIError as exc:
            if exc.status_code == 404:
                logger.warning("User-teams mapping is unavailable: %s", exc)
                return []
            raise

    def _get(self, endpoint: str, params: dict | None = None) -> dict:
        url = f"{GITHUB_API_BASE}{endpoint}"
        logger.debug("GET %s params=%s", url, params)

        try:
            response = self.session.get(url, params=params, timeout=self.timeout)
        except requests.RequestException as exc:
            raise GitHubAPIError(0, f"Connection error: {exc}", endpoint) from exc

        if response.status_code == 200:
            return response.json()

        logger.error("HTTP %d from %s", response.status_code, endpoint)
        logger.error("Response Headers: %s", dict(response.headers))
        logger.error("Response Body: %s", response.text)

        if response.status_code == 403:
            body = response.text.lower()
            if "aadsts53003" in body or "conditional access" in body:
                raise GitHubAPIError(
                    403,
                    "Access blocked by Microsoft Entra Conditional Access. The token owner or runner is not allowed to access the Copilot Metrics API.",
                    endpoint,
                )
            if "X-GitHub-SSO" in response.headers:
                logger.error("PAT requires SAML SSO authorization: %s", response.headers["X-GitHub-SSO"])
            elif "ip allow" in body or "allow list" in body:
                logger.error("Organization IP allowlist is blocking the GitHub Actions runner.")

        error_messages = {
            401: "Invalid or expired PAT. Check GITHUB_TOKEN.",
            403: "Insufficient permissions. Ensure PAT has required scopes.",
            404: f"Organization '{self.org}' not found or Copilot metrics not enabled.",
            429: "Rate limit exceeded. Retry after the reset window.",
        }
        message = error_messages.get(response.status_code, response.text[:500] if response.text else "Unknown error")
        raise GitHubAPIError(response.status_code, message, endpoint)

    def _download_ndjson(self, download_links: list[str]) -> list[dict]:
        all_records: list[dict] = []
        for link in download_links:
            logger.debug("Downloading NDJSON from signed URL")
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
                response = requests.get(link, headers=headers, timeout=60)
                response.raise_for_status()
                text_data = response.text
            except requests.RequestException as exc:
                logger.error("Failed to download NDJSON (%s)", type(exc).__name__)
                raise GitHubAPIError(
                    0,
                    "Failed to download an NDJSON metrics report.",
                    "metrics report download",
                ) from exc

            for line_num, line in enumerate(text_data.strip().splitlines(), 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    if "day_totals" in record:
                        all_records.extend(record["day_totals"])
                    else:
                        all_records.append(record)
                except json.JSONDecodeError as exc:
                    raise GitHubAPIError(
                        0, f"Malformed NDJSON at line {line_num}.", "metrics report download"
                    ) from exc

        logger.info("Parsed %d records from %d NDJSON files", len(all_records), len(download_links))
        return all_records
