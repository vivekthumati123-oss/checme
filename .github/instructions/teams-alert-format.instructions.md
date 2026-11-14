---
description: 'Defines the Microsoft Teams Adaptive Card schema and mandatory sections for FinOps budget alerts based on Minimum Estimated Cost.'
applyTo: '**/*.md'
---

# Teams Alert Format (Metrics-Only)

## Standard Rules
1. Card version always Adaptive Card v1.5.
2. Severity colors: Warning (🟡 attention) when threshold–100%, Critical (🔴 default/accent) when >100%.
3. Header must include org name and severity indicator.
4. FactSet section mandatory with: 
   - Min. Estimated Cost
   - Monthly Budget
   - Budget Consumed %
   - Active Users (28d)
   - Acceptance Rate
5. Recommendations section must contain exactly 3 numbered, specific, data-driven actions focused on adoption and efficiency.
6. Footer must include run timestamp (ISO 8601 UTC) and correlation ID (UUID).
7. No raw PII in any card field.
