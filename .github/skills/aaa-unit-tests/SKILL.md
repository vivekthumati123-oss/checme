---
name: aaa-unit-tests
description: 'Write executable unit tests using the Arrange-Act-Assert pattern. Use when generating or reviewing unit tests for Jest, pytest or JUnit.'
---

# Arrange-Act-Assert unit tests

## Procedure

1. Detect the framework from the repository. Load only the matching reference:
   - Jest: `references/jest.md`
   - pytest: `references/pytest.md`
   - JUnit 5: `references/junit.md`
2. List the public behaviours of the changed unit. Write one test per behaviour.
3. For each behaviour cover: the happy path, one boundary value, one failure case.
4. Lay out every test as three blocks marked `Arrange`, `Act`, `Assert`.
5. Keep exactly one action in the `Act` block.
6. Start from `assets/test-template.js` when writing a Jest file.

## Quality bar

- A test fails if the behaviour it names breaks, and passes otherwise.
- No logic (loops, conditionals) inside a test body.
- No shared mutable state between tests.
