---
description: 'Rules for UI code generated from, or kept in sync with, Figma designs. Applies only when the task references a Figma design.'
applyTo: '**/*.tsx, **/*.jsx, **/*.vue, **/*.svelte, **/*.html, **/*.css, **/*.scss'
---

# UI code derived from Figma

**Apply these rules only when the current task implements or syncs UI from a Figma design (a Figma URL, node, or design screenshot is part of the task). Otherwise ignore this file.**

- Start from the design-system config in `docs/figma-agent/design-system.md` for the framework, styling approach, component directory and token source.
- Use design tokens, never literals. If a value has no token, flag it and ask whether to add one instead of inlining it.
- Reuse components from the repo's component library. Check Code Connect mappings (`get_code_connect_map`) when the tool and access are available; if unavailable or denied, continue with source and library inspection and report the skipped check.
- Match the repo's conventions for file layout, naming, props and styling. Do not paste the MCP server's default React + Tailwind output unchanged.
- Treat asset URLs returned by the MCP server as temporary. Download assets into the repo's assets folder and reference the local file. Never ship localhost or temporary URLs.
- Do not add an icon or image package when Figma already provides the asset.
- Implement every state shown in the design: hover, focus, active, disabled, loading, empty and error.
- Accessibility: semantic elements first, labels for inputs and icon buttons, visible focus, keyboard operability, contrast that meets WCAG 2.2 AA.
- Responsive behavior follows the breakpoints in the config. If the design shows only one size, say what you assumed for the others.
- After implementing, compare the result with the design screenshot and list any intentional deviations.
- Never read `.env` files or hard-code tokens, keys or credentials into generated UI code.
