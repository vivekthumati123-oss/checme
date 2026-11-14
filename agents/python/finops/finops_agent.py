"""FinOps: L2 extension of the `finops-agent` custom agent. Arithmetic in Python; model writes the narrative."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from agent_core import AgentArtifact, AgentMetrics, AgentRequest, AgentResult, BaseAgent, automation_task
from agent_runtime.agent_runtime import AgentRunOptions, parse_structured_output


class FinOpsAgent(BaseAgent):
    def __init__(self, binding: Any, metrics_client: Any) -> None:
        super().__init__(binding)
        self.metrics_client = metrics_client

    async def validate(self, request: AgentRequest) -> None:
        if self.metrics_client is None:
            raise ValueError("A Copilot metrics client is required")

    async def perform(self, request: AgentRequest, context: Any) -> AgentResult:
        config = self.binding.resolve_config(request.payload)
        days = self.metrics_client.get_metrics(since=config.get("since"), until=config.get("until"))
        as_of = report_date(days)
        totals = summarise_metrics(days)
        seats = summarise_seats(self.metrics_client.get_seats(), config.get("seatCostPerMonth", 39), config.get("currency", "USD"), as_of=as_of, inactive_days=config.get("inactiveDays", 30))
        alerts = build_alerts(totals, seats, config)
        prompt = self.compose_prompt().add_skill_reference("copilot-finops-report", "metrics-glossary").build()
        response = await context.runtime.run(AgentRunOptions(
            agent_id=self.id, system_prompt=prompt.system_prompt,
            user_prompt=automation_task({"task": "Write the leadership narrative. Use only these numbers.", "asOf": as_of.date().isoformat(), "totals": totals, "seats": seats, "alerts": alerts}),
            working_directory=context.workspace,
        ))
        output = response.structured_output or parse_structured_output(response.content) or {}
        is_breached = any(a.get("type") == "budget" for a in alerts)
        recs = output.get("recommendations")
        if not recs:
            if output.get("topAction"):
                recs = [output.get("topAction")]
            else:
                recs = [a["message"] for a in alerts][:3]

        adaptive_card = None
        if is_breached:
            try:
                from agents.python.finops.cost_calculator import FinOpsResult
                from agents.python.finops.insight_engine import InsightReport, UsageSummary
                from agents.python.finops.teams_notifier import TeamsNotifier

                cost_res = FinOpsResult(
                    active_users_28d=totals.get("peakActiveUsers", 0),
                    minimum_estimated_cost=seats.get("monthlyCost", 0.0),
                    monthly_budget_usd=float(config.get("monthlyBudget", 0.0) or 0.0),
                    percent_consumed=(seats["monthlyCost"] / float(config["monthlyBudget"]) * 100) if config.get("monthlyBudget") else 0.0,
                    alert_threshold_percent=float(config.get("budgetAlertThresholdPercent", 85)),
                    threshold_breached=True,
                    severity="critical" if (config.get("monthlyBudget") and seats["monthlyCost"] >= float(config["monthlyBudget"])) else "warning",
                )
                insight_res = InsightReport(
                    usage_summary=UsageSummary(acceptance_rate=totals.get("acceptanceRatePercent", 0.0)),
                    recommendations=recs,
                )
                org_name = config.get("org") or getattr(self.binding, "name", "Copilot")
                card_payload = TeamsNotifier(webhook_url="")._build_adaptive_card(org_name, cost_res, insight_res)
                adaptive_card = card_payload["attachments"][0]["content"]
            except Exception:
                adaptive_card = None
        else:
            print(f"FINOPS_BUDGET_OK: {seats['activeSeats']}/{seats['totalSeats']} active seats, budget healthy.")

        spend_section = {
            "monthlyCost": seats["monthlyCost"],
            "currency": seats["currency"],
            "wastedMonthlyCost": seats["wastedMonthlyCost"],
            "seatCostPerMonth": seats["seatCostPerMonth"],
        }
        budget_section = {
            "monthlyBudget": config.get("monthlyBudget"),
            "thresholdBreached": is_breached,
            "status": "BREACHED" if is_breached else "FINOPS_BUDGET_OK",
        }
        usage_section = {
            "activeSeats": seats["activeSeats"],
            "totalSeats": seats["totalSeats"],
            "inactiveSeats": seats["inactiveSeats"],
            "acceptanceRatePercent": totals["acceptanceRatePercent"],
            "peakActiveUsers": totals["peakActiveUsers"],
        }

        artifacts = [AgentArtifact(type="report", name="copilot-finops-report")]
        if adaptive_card:
            artifacts.append(AgentArtifact(type="adaptive-card", name="teams-alert-card"))

        return AgentResult(
            request_id=request.request_id, agent_id=self.id,
            summary=f"{seats['activeSeats']}/{seats['totalSeats']} seats active, {seats['currency']} {seats['monthlyCost']:.2f}/month, {len(alerts)} alert(s).",
            data={
                "asOf": as_of.date().isoformat(),
                "totals": totals,
                "seats": seats,
                "alerts": alerts,
                "spend": spend_section,
                "budget": budget_section,
                "usage": usage_section,
                "narrative": output.get("narrative", ""),
                "topAction": output.get("topAction"),
                "recommendations": recs,
                "adaptiveCard": adaptive_card,
                "prompt": {"included": prompt.included, "dropped": prompt.dropped},
            },
            artifacts=artifacts, warnings=[a["message"] for a in alerts],
            metrics=AgentMetrics(input_tokens=response.input_tokens, output_tokens=response.output_tokens),
        )


def report_date(days: list[dict[str, Any]]) -> datetime:
    dates = [d.get("date") for d in days if d.get("date")]
    if not dates:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(max(dates)).replace(tzinfo=timezone.utc) + timedelta(days=1)


def summarise_metrics(days: list[dict[str, Any]]) -> dict[str, Any]:
    suggested = sum(d.get("total_code_suggestions", 0) for d in days)
    accepted = sum(d.get("total_code_acceptances", 0) for d in days)
    active = [d.get("total_active_users", 0) for d in days]
    return {"days": len(days), "suggestions": suggested, "acceptances": accepted, "acceptanceRatePercent": round(accepted / suggested * 100, 1) if suggested else 0.0,
            "peakActiveUsers": max(active) if active else 0, "averageActiveUsers": round(sum(active) / len(active), 1) if active else 0.0}


def _parse_time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def summarise_seats(seats: dict[str, Any], seat_cost: float, currency: str = "USD", *, as_of: datetime | None = None, inactive_days: int = 30) -> dict[str, Any]:
    entries = seats.get("seats", [])
    cutoff = (as_of or datetime.now(timezone.utc)) - timedelta(days=inactive_days)
    floor = datetime.min.replace(tzinfo=timezone.utc)
    inactive = [s for s in entries if (_parse_time(s.get("last_activity_at")) or floor) < cutoff]
    total = seats.get("total_seats") or len(entries)
    return {"totalSeats": total, "activeSeats": total - len(inactive), "inactiveSeats": len(inactive),
            "inactiveLogins": sorted((s.get("assignee") or {}).get("login", "?") for s in inactive), "inactiveWindowDays": inactive_days,
            "seatCostPerMonth": seat_cost, "monthlyCost": round(total * seat_cost, 2), "wastedMonthlyCost": round(len(inactive) * seat_cost, 2), "currency": currency}


def build_alerts(totals: dict[str, Any], seats: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    budget = config.get("monthlyBudget")
    if budget:
        used = seats["monthlyCost"] / float(budget) * 100
        if used >= config.get("budgetAlertThresholdPercent", 85):
            alerts.append({"type": "budget", "severity": "high" if used >= 100 else "medium", "message": f"Copilot spend is at {used:.0f}% of the monthly budget."})
    if seats["inactiveSeats"]:
        alerts.append({"type": "waste", "severity": "medium", "message": f"{seats['inactiveSeats']} seat(s) inactive for {seats['inactiveWindowDays']}+ days, costing {seats['currency']} {seats['wastedMonthlyCost']:.2f} per month."})
    if totals["suggestions"] and totals["acceptanceRatePercent"] < 20:
        alerts.append({"type": "adoption", "severity": "low", "message": f"Acceptance rate is {totals['acceptanceRatePercent']}%, below 20%."})
    return alerts
