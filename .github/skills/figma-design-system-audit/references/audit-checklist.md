# Audit checklist

## Tokens
- Colors come from semantic variables, not raw hex values.
- Spacing, radii and stroke widths come from the scale.
- Typography uses text styles; no ad hoc font sizes or weights.
- Dark and brand modes resolve correctly (no mode-specific hard-coded values).

## Components
- Instances come from the library; none are detached.
- No local copies of components that already exist in a library.
- Overrides are limited to intended properties (text, visibility, swaps).
- Variants follow the property naming from the config.

## Structure
- Auto layout on containers; constraints set on children.
- No absolute positioning except overlays and decorations.
- Layer names are meaningful and follow the convention; no `Frame 12` or `Group 3`.
- Pages and sections are organized and named.

## States and content
- Required states exist (loading, empty, error, success, disabled, focus).
- Content is realistic and handles long text and missing data.

## Accessibility
- Text contrast at least 4.5:1 (3:1 for large text and UI shapes).
- Touch targets at least 44×44.
- Visible focus state on interactive elements.
- Color is not the only carrier of meaning.

## Severity guide
- **High:** accessibility failures, detached core components, raw values in shared components.
- **Medium:** token drift, naming issues, missing states in non-critical flows.
- **Low:** spacing nits, organization, documentation gaps.
