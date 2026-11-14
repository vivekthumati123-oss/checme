### JavaScript / TypeScript Addendum

- Use the exact configured framework (`vitest` or `jest`) shown in the context packet:
  - For **vitest**: import `{ describe, it, expect, vi }` from `"vitest"` (or rely only on explicit imports from `"vitest"`). Prefer `vi.fn()` / `vi.spyOn(...)` and restore mocks with `vi.restoreAllMocks()`.
  - For **jest**: use global `describe` / `it` / `expect` (or import `@jest/globals` if used in styleSample) and `jest.fn()` / `jest.spyOn(...)` with `jest.restoreAllMocks()`.
- Import the unit under test strictly via `conventions.importHint`.
- Cover normal inputs, edge/boundary cases, and error branches (`expect(() => ...).toThrow(...)` or `await expect(...).rejects.toThrow(...)`).

