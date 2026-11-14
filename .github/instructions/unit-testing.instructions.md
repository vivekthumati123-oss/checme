---
description: 'Conventions for unit test files in this repository.'
applyTo: '**/*.test.js, **/*.test.ts, **/*.spec.ts, **/test_*.py, **/*Test.java, tests/**'
---

# Unit test conventions

- One test file per source file. Mirror the source path under `tests/unit/`.
- Name tests by behaviour: `returns zero interest for a zero rate`, not `test1`.
- Mark each block with `Arrange`, `Act` and `Assert` comments.
- No network, filesystem, real clock or randomness in unit tests. Mock them.
- No `.only`, `.skip`, `xit` or `@Disabled` in committed tests.
