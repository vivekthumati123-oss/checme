# Jest reference

- Files: `tests/unit/<mirror of source path>/<name>.test.js`.
- Group with one `describe` per exported function or class.
- Use `it("<behaviour>")`. Use `expect(...).toThrow(ErrorType)` for failures.
- Mock modules with `jest.mock("<path>")`. Mock time with `jest.useFakeTimers()`.
- Use `toBeCloseTo` for floating point values.
