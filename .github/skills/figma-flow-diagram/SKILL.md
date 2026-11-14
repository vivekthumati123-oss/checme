---
name: figma-flow-diagram
description: 'Creates editable FigJam diagrams from Mermaid via generate_diagram: user flows, process flows, architecture, sequence, state, entity-relationship and gantt diagrams. Use when the user wants a diagram, flowchart or journey map in FigJam rather than screens in a Design file. Not for UI screens (use figma-build-screen or figma-wireframe).'
compatibility: Requires the Figma MCP server (remote); uses Figma's figma-generate-diagram skill when installed
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Flow diagram

Turns real information into an editable FigJam diagram. Quality is bounded by the facts you feed it.

**Prerequisite:** load Figma's `figma-generate-diagram` skill before every `generate_diagram` call (the agent rules require it). If it is not installed and `get_figma_skill` cannot supply it, do not call the tool; give the user the Mermaid source instead and say why. Hybrid edits through `use_figma` also need `figma-use` and `figma-use-figjam`.

## When to use

- User flows, onboarding or checkout journeys, decision trees, pipelines.
- Architecture, sequence, state-machine, ER and gantt diagrams.

## Instructions

1. **Pick the type.** Supported: flowchart, sequence, state, ER, gantt. Not supported by `generate_diagram`: pie, mindmap, venn, class, journey, timeline, quadrant, C4, git graph. Say so directly instead of calling the tool and failing.
2. **Gather the facts.** Read source code, specs or the user's notes. For an existing board use `get_figjam`. If the description is thin, ask one or two focused questions (the 3 to 5 main steps, who owns each, what triggers the next). Do not invent nodes, edges or labels; leave a visible gap and flag it.
3. **Write the Mermaid.** Keep these constraints unless the loaded Figma skill says otherwise: no emoji, no HTML tags, no `\n` in labels, camelCase node IDs, quote labels with special characters, never use `end`, `subgraph` or `graph` as an ID. Sequence-diagram notes and gantt styling are stripped by the renderer; do not rely on them.
4. **Decide if you need annotations or color.** Add stickies or per-node color through a follow-up `use_figma` write only if the user asked or the diagram is a shareable artifact. Use FigJam-only APIs: there is no `figma.createPage()` in FigJam.
5. **Create a file if needed.** Use `create_new_file` with `editorType` for FigJam, resolved as the agent file describes. Otherwise write into the file the user named.
6. **Generate and check.** Call `generate_diagram`, then one `get_screenshot` in `low` mode to confirm it rendered and reads left to right or top to bottom without crossing chaos. Regenerate for content changes; tell the user that moving single shapes or changing fonts on a generated diagram is easier by hand in Figma.
7. **Report** with the link, the diagram type, the source Mermaid in a code block, assumptions and gaps.

## Example

Request: "Diagram our password reset flow."

Result: a FigJam flowchart with the entry points, email send, token check, success and expired paths, the Mermaid source, and a note that rate-limit behavior was not specified.

## Common edge cases

- **Very large diagram:** split by domain or by flow and generate each part.
- **Wants a UI flow with screens:** build wireframes with `figma-wireframe` and lay them out in order, or ask which they want.
- **Wants a chart of data:** not a diagram; say so and offer a table or a chart in a different tool.
