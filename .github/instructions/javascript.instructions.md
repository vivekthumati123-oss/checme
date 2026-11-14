---
description: 'JavaScript and TypeScript conventions for source and generated code.'
applyTo: '**/*.js, **/*.mjs, **/*.ts, **/*.tsx'
---

# JavaScript conventions

- ES modules only. Use `import`, never `require`.
- Prefer named exports. Avoid default exports.
- Throw `Error` subclasses with actionable messages. Never throw strings.
- No `console.log` in library code. Use the injected logger.
