---
description: 'Python conventions for source and generated code.'
applyTo: '**/*.py'
---

# Python conventions

- Python 3.11 or later. Type hints on every public function.
- Use `pathlib` for paths and `dataclasses` for plain data.
- Raise specific exceptions with actionable messages. Never use bare `except:`.
- Tests use `pytest` style plain asserts unless the module already uses `unittest`.
