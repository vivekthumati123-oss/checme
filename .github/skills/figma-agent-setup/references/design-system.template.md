# Design system profile (read by the Figma agent)

Copy this file to `docs/figma-agent/design-system.md` in your workspace, or run `/figma-agent-setup`. Lines marked CHANGE ME are unset: the agent will not use them and will ask or rely on what it finds in Figma. Facts in the user's request and in the Figma file override this profile.

## Access and budget

Write access: enabled
Call budget: ask
Allowed working files: CHANGE ME (Figma file URLs, one per line; leave as is to let users name the file each request)
Approver: CHANGE ME (person or team who approves changes to published components, variables and styles)

- `Write access`: `enabled`, or `read-only` to block every write.
- `Call budget`: `ask` (recommend by Figma seat, then ask once per chat), `auto` (follow the seat without asking), `low` or `normal` (force a mode). A prompt that says "use normal call budget" overrides this line.
- Until `Approver` is set, the agent asks the requesting user before touching any published object.

## Libraries and files

- Primary UI library: none configured. Inspect the target file and its libraries before creating anything.
- Icon library: none configured. If creating icons, use simple outline icons on a 24px grid, 2px stroke, named `icon/<name>`.
- Where new work goes: a new file, or a new page named `Agent / <task>` in the file the user names. Existing pages are edited in place only when the user says so.

## Tokens

- Collections: `Primitives` (raw values), `Semantic` (meaning, aliases Primitives), `Component` (optional, aliases Semantic). Match the file's existing collections and modes first.
- Modes: `Semantic` has `Light` and `Dark`; `Primitives` has one.
- Names are lowercase and slash-separated: `color/brand/500`, `color/text/primary`, `color/surface/default`, `color/border/default`, `color/action/primary`, `color/feedback/error`.
- Scales: spacing 4, 8, 12, 16, 24, 32, 48, 64 (`space/1` is 4). Radius `sm` 4, `md` 8, `lg` 16, `full` 999.
- Type styles (font Inter): `display/lg` 32/40, `heading/lg` 24/32, `heading/md` 20/28, `heading/sm` 16/24, `body/md` 16/24, `body/sm` 14/20, `label/md` 14/20 medium, `caption` 12/16.
- Token source in the repo: CHANGE ME (for example `src/tokens/tokens.json`), or "none".

## Components and naming

- Components are PascalCase with optional grouping: `Button`, `Input/Text`, `Card`.
- Variant properties in this order: `Variant`, `Size`, `State`. State values: Default, Hover, Focus, Pressed, Disabled, Loading, Error, where they apply.
- Screens: `Screen/<Feature>/<State>`; sections: `<Feature>`. Wireframes: `Wire/<Flow>/<NN>-<Screen>`.
- Every component has a description, a usage note and an accessibility note (role, keyboard, focus).

## Platforms and layout

- Platforms: CHANGE ME (for example web, iOS, Android, desktop app). Frame sizes come from the brief or the existing file; otherwise the agent uses the fallbacks in its rules for the platforms listed here.
- Grid and breakpoints: CHANGE ME, or "take them from the existing file".
- Accessibility target: WCAG 2.2 AA.

## Code mapping

- Framework and styling approach: CHANGE ME, or "design only, no code mapping".
- Component directory: CHANGE ME, or "none".
- Code Connect in use: no.
