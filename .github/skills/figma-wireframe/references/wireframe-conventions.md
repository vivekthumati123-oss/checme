# Wireframe conventions

Use these when the file has no wireframe kit.

## Look
- Grayscale only. Background `#FFFFFF`, surfaces `#F2F2F2`, strokes `#BDBDBD`, text `#212121` and `#757575`. One accent (a blue) only for the primary action, if at all.
- One font family, three sizes: 24 for titles, 16 for body and labels, 12 for notes.
- 1px strokes, 4px corner radius, no shadows, no gradients.

## Building blocks
- **Image or media:** a gray rectangle with a diagonal cross and a label.
- **Text:** real headings and labels; body copy as two or three gray lines when wording does not matter.
- **Button:** rounded rectangle with a label. Primary is filled dark, secondary is outlined.
- **Input:** outlined rectangle with a visible label above it.
- **List, table, card:** repeat three rows or items, not twenty.
- **Icons:** a labeled square, for example `icon: search`.

## Structure
- Auto layout on every container, consistent 8px spacing steps.
- Frame sizes follow the target platform (see the agent file for fallbacks).
- Name layers by role: `Header`, `Nav`, `Hero`, `Form/Email`, `Table/Tickets`.

## Notes
- Number annotations and place them in a column to the right of the frame.
- Keep each note to one sentence: behavior, rule or open question.
