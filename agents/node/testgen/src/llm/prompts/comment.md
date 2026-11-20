{{marker}}
### Unit Agent — Test Generation Summary

- **Mode:** `{{mode}}`
- **Status:** `{{statusLabel}}`
- **Baseline:** `{{baselineStatus}}` ({{baselinePatchPct}})
- **Result Patch Coverage:** {{afterPatchPct}} ({{coverageDelta}})

{{#if rows}}
| File | Outcome | Kept / Total Tests | Notes |
| --- | --- | --- | --- |
{{rows}}
{{/if}}

{{#if approvalBanner}}
> [!IMPORTANT]
> {{approvalBanner}}
{{/if}}

