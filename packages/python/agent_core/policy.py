from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent_core.contracts import PolicyViolationError
from agent_core.glob import matches_glob


@dataclass
class PolicyDecision:
    allowed: bool
    requires_approval: bool
    reason: str


class PolicyEngine:
    """Same semantics as policy.js: deny wins, unknown actions are denied."""

    def __init__(self, policy: dict[str, Any] | None = None) -> None:
        self.policy = policy or {"rules": []}

    def evaluate(self, action: str, attributes: dict[str, Any] | None = None) -> PolicyDecision:
        attributes = attributes or {}
        rules = [r for r in (self.policy.get("rules") or []) if r.get("action") == action]
        if not rules:
            return PolicyDecision(False, False, f"No rule for {action}")
        decision = PolicyDecision(False, False, f"Denied: {action}")
        for rule in rules:
            if not self._met(rule, attributes):
                continue
            effect = rule.get("effect")
            if effect == "deny":
                return PolicyDecision(False, False, rule.get("reason", f"Denied: {action}"))
            if effect == "require-approval":
                decision = PolicyDecision(True, True, f"Approval required: {action}")
            elif effect == "allow" and not decision.requires_approval:
                decision = PolicyDecision(True, False, f"Allowed: {action}")
        return decision

    def authorize(self, action: str, attributes: dict[str, Any] | None = None) -> PolicyDecision:
        decision = self.evaluate(action, attributes)
        if not decision.allowed:
            raise PolicyViolationError(decision.reason)
        return decision

    @staticmethod
    def _met(rule: dict[str, Any], attributes: dict[str, Any]) -> bool:
        c = rule.get("conditions") or {}
        listify = lambda v: v if isinstance(v, list) else [v]
        if c.get("paths") and "path" in attributes and not any(matches_glob(p, attributes["path"]) for p in listify(c["paths"])):
            return False
        if c.get("commands") and "command" in attributes and not any(attributes["command"].startswith(x) for x in listify(c["commands"])):
            return False
        return True
