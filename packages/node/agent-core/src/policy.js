import { PolicyViolationError } from "./contracts.js";
import { matchesGlob } from "./glob.js";

/** Path-and-action authorisation. Deny wins; actions with no rule are denied. */
export class PolicyEngine {
  constructor(policy = { rules: [] }) {
    this.policy = policy ?? { rules: [] };
  }

  evaluate({ action, attributes = {} }) {
    const rules = (this.policy.rules ?? []).filter((r) => r.action === action);
    if (rules.length === 0) return { allowed: false, requiresApproval: false, reason: `No rule for ${action}` };
    let decision = { allowed: false, requiresApproval: false, reason: `Denied: ${action}` };
    for (const rule of rules) {
      if (!conditionsMet(rule, attributes)) continue;
      if (rule.effect === "deny") return { allowed: false, requiresApproval: false, reason: rule.reason ?? `Denied: ${action}` };
      if (rule.effect === "require-approval") decision = { allowed: true, requiresApproval: true, reason: `Approval required: ${action}` };
      if (rule.effect === "allow" && !decision.requiresApproval) decision = { allowed: true, requiresApproval: false, reason: `Allowed: ${action}` };
    }
    return decision;
  }

  authorize(input) {
    const decision = this.evaluate(input);
    if (!decision.allowed) throw new PolicyViolationError(decision.reason);
    return decision;
  }

  /** True only for a plain allow (no approval gate). */
  permits(action, attributes) {
    const d = this.evaluate({ action, attributes });
    return d.allowed && !d.requiresApproval;
  }
}

function conditionsMet(rule, attributes) {
  const c = rule.conditions;
  if (!c) return true;
  if (c.paths && attributes.path !== undefined && ![].concat(c.paths).some((p) => matchesGlob(p, attributes.path))) return false;
  if (c.commands && attributes.command !== undefined && ![].concat(c.commands).some((x) => attributes.command.startsWith(x))) return false;
  return true;
}
