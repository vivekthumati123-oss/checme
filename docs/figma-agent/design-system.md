# Design System Profile

This document defines the default design-system conventions used by the Figma Agent when a project-specific system is not available. It is a fallback profile, not a substitute for the target team's actual design standards. When a real design file, library, or product requirement exists, that source takes precedence.

The purpose of this profile is to keep AI-assisted design work consistent, reusable, and production-minded without forcing unnecessary invention.

## 1. Source of truth and decision hierarchy

When requirements conflict, apply the following order:

1. The user's explicit request and product constraints.
2. The target Figma file and its libraries, variables, styles, and component structure.
3. Supplied design artifacts, screenshots, and implementation source files.
4. This fallback profile, used only when no project-specific rule can be verified.

This document should be treated as a safe baseline, not as proof of a real design system.

## 2. Principles

- Reuse existing system assets before creating new ones.
- Prefer semantic tokens and text styles over direct property values.
- Design for responsive behavior, accessibility, and clear state handling from the start.
- Keep work constrained to the file, page, or frame explicitly named by the user.
- If a decision is uncertain, ask the user or state the assumption clearly before proceeding.

## 3. Working files and scope boundaries

- Primary UI library: not configured. Inspect the named target file and available libraries for each task before creating anything new.
- Icon library: not configured. Search the target file and available libraries first. If no suitable icon library exists and icon creation is in scope, use simple outline icons on a 24px grid with 2px strokes and name them `icon/<name>`.
- Allowed working files: no files are preapproved. The agent may write only to a Figma file explicitly named in the current request or to a new file created during the same session.
- New work location: in a user-named file, create a new page named `Agent / <task>` unless the user asks to edit an existing page.
- New file creation: only when the user requests a new design without identifying an existing target file.
- Asset creation: create local assets only when the agreed scope allows it and the design system does not already provide a suitable equivalent.

## 4. Design tokens and naming

### 4.1 Collection structure

When creating a local design system, the recommended variable collections are:

- `Primitives`: raw values
- `Semantic`: meaning-based aliases of primitives
- `Component`: optional aliases of semantic tokens

If the target file already contains established collections or modes, match those instead.

Suggested modes:

- `Semantic`: `Light`, `Dark`
- `Primitives`: one mode only

### 4.2 Token naming

Token names should use lowercase, slash-separated values.

Color examples:

- `color/brand/500`
- `color/neutral/900`
- `color/text/primary`
- `color/text/secondary`
- `color/text/inverse`
- `color/surface/default`
- `color/surface/raised`
- `color/border/default`
- `color/action/primary`
- `color/feedback/error`
- `color/feedback/success`
- `color/feedback/warning`

Spacing examples:

- `space/0`, `space/1` (4), `space/2` (8), `space/3` (12), `space/4` (16), `space/6` (24), `space/8` (32), `space/12` (48)

Radius examples:

- `radius/sm` (4)
- `radius/md` (8)
- `radius/lg` (16)
- `radius/full` (999)

### 4.3 Suggested scales

Spacing scale:

- 4, 8, 12, 16, 24, 32, 48, 64
- Base rhythm: 4px with an 8pt-inspired spacing system

Fallback type scale when no verified product type scale exists:

- `display/lg`: 32/40 bold
- `heading/lg`: 24/32 semibold
- `heading/md`: 20/28 semibold
- `heading/sm`: 16/24 semibold
- `body/md`: 16/24 regular
- `body/sm`: 14/20 regular
- `label/md`: 14/20 medium
- `caption`: 12/16 regular

Font rule:

- Do not assume Inter or any other font family.
- Verify the actual product font from the target file or supplied source before standardizing type styles.

Token source note:

- This repository does not include a token source.
- Do not invent a token path. Use a token source supplied by the user, or treat the work as design-only.

## 5. Components

- Component naming: PascalCase, with grouping where helpful, for example `Button`, `Input/Text`, `Card`.
- Variant properties and order: `Variant`, `Size`, `State`.
  - Variant values: Primary, Secondary, Tertiary, Destructive
  - Size values: Small, Medium, Large
  - State values: Default, Hover, Focus, Pressed, Disabled, Loading, Error (when relevant)
- Screen layer naming: `Screen/<Feature>/<State>`, for example `Screen/Login/Default` and `Screen/Login/Error`.
- Section naming: `<Feature>`
- Documentation expectations: each reusable component should include a short description, a usage note, and an accessibility note covering role, keyboard interaction, and focus treatment.

## 6. Layout and responsive behavior

Default frame sizes:

- Mobile: 390×844
- Tablet: 834×1194
- Desktop: 1440×1024

Grid and breakpoints:

- Mobile: 4 columns, 16px margin, 16px gutter
- Tablet: 8 columns, 24px margin
- Desktop: 12 columns, 80px margin, 24px gutter
- Breakpoints: 768 and 1280

Rules:

- Minimum touch target: 44×44.
- Prefer auto layout for composition.
- Use constraints intentionally; avoid absolute positioning except for overlays or deliberate exceptions.

## 7. Accessibility and quality bar

- Accessibility target: WCAG 2.2 AA.
- Maintain strong contrast for text and UI elements.
- Provide meaningful states for default, hover, focus, pressed, disabled, loading, empty, error, and success when relevant.
- Keep layer names meaningful and avoid generic names such as `Frame 123`.
- Use realistic content; do not rely on filler text such as `Lorem ipsum` or `Button` unless the design specifically calls for placeholder content.

## 8. Code mapping and implementation expectations

- Framework and styling approach: design-only by default. No product UI implementation is present in this repository.
- Use a code framework only when the user supplies the relevant project and explicitly asks for code work.
- Component directory: none configured.
- Code Connect: not configured in this project. If the relevant Figma tools and permissions are available, inspect existing target-file mappings; if unavailable or denied, skip the check without blocking the design work.
- Never invent code paths, component names, or mappings that are not supplied by the user or the target file.

## 9. Operating rules for the agent

- Reuse before creating: prefer existing design system components, variables, and styles before creating new assets.
- Never detach instances when a library component can be reused.
- Prefer semantic variables over literal values for color, spacing, radius, and typography.
- Keep work scoped to the file, page, or frame explicitly named by the user.
- If a decision is ambiguous, ask the user or state the assumption clearly before proceeding.
- Favor explicit constraints and safe fallback choices over guesswork.

## 10. Call budget

- Default call budget: `ask`.
- The agent checks the Figma seat with `whoami`, recommends a mode, and asks the user once per chat.
- Alternate values:
  - `low`: target no more than 8 read calls per task and favor batched checks
  - `normal`: allow more frequent validation after coherent batches
  - `auto`: follow the seat-based recommendation without asking
- A prompt that says `use normal call budget` overrides this default.

## 11. Review policy

- Changes to published components, variables, and styles require explicit approval for the exact objects being edited.
- If the user does not authorize a published object for modification, do not overwrite it.
- When in doubt, prefer the safest option: reuse, duplicate, or create a new local asset rather than editing an existing published object.

## 12. Summary

This profile is intentionally conservative. It is designed to support AI-assisted design work with a strong emphasis on consistency, reusability, accessibility, and scope control. In real projects, the actual target file or product requirement remains the authority. This document works best as a reliable fallback when the team has not yet defined a broader system.

A well-run design system does not try to be clever. It makes the right decision consistently, and that is the standard this profile is designed to support.
