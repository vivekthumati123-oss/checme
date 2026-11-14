---
name: figma-requirements-intake
description: 'Turns a design request, PRD, ticket, link or screenshot into a structured design brief (goals, users, screens, states, content, constraints, acceptance criteria) before anything is built in Figma. Use when starting any new design, redesign or component request, or when a request is vague. Does not write to Figma.'
compatibility: Uses the Figma MCP server read tools (search_design_system, get_libraries, get_design_context, get_screenshot)
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Requirements intake

Produces a short, checkable design brief so the build starts from agreed facts. Read-only.

## When to use

- A new screen, flow, component or redesign is requested.
- The request is a one-liner, a screenshot, a PRD, an issue or a Figma link with little context.
- Requirements conflict, or key states and constraints are missing.

## Instructions

1. **Gather sources.** Collect every link, attachment, issue and file the user gave you. For Figma links, call `get_metadata`, then `get_screenshot` on the relevant node. Read `docs/figma-agent/design-system.md`.
2. **Extract the facts:** goal, target users, primary task, platforms, screens, entry and exit points, content, constraints (brand, legal, technical), success criteria.
3. **List the states** each screen needs: default, loading, empty, error, success, disabled, and permission or offline cases where relevant.
4. **Map to the design system.** Call `get_libraries`, then batch focused `search_design_system` queries for needed elements. If no libraries are returned, omit `includeLibraryKeys` and still search local/published assets. Split the result into "reuse as is", "reuse with change" and "missing".
5. **Find gaps.** Ask at most five questions, ordered by how much a wrong guess would cost. For everything else, write an explicit assumption.
6. **Write the brief** using `references/brief-template.md`. Keep it to one screen of text.
7. **Hand off.** Recommend the next skill: `figma-build-screen` for screens and flows, `figma-component-builder` for components. If ambiguity is high, wait for confirmation before building.

## Example

Request: "Add a billing page where users can update their card."

Result: a brief listing the page goal, the states (loaded, editing, saving, error, success), reusable components found (form field, button, card), missing pieces (card-number input), assumptions (desktop and mobile frames, existing Settings layout), and three open questions.

## Common edge cases

- **Screenshot only:** infer structure but mark everything not visible (states, responsive behavior) as an assumption.
- **Conflicting requirements:** list the conflict, recommend one option and its trade-off, and ask the user to choose.
- **Brand or components not in the library:** say so, propose composing from primitives, and flag it for the design-system owners.
- **Large scope:** propose slicing into screens or milestones and brief the first slice only.
