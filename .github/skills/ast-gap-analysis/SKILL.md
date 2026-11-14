---
name: "ast-gap-analysis"
title: "AST Gap Analysis"
description: "Uses Tree-sitter to parse JavaScript source and test files, identifying untested public methods to prevent hallucinations and strictly scope AI test generation."
version: "1.0.0"
plugin: "develop-plugin"
sdlc_phase: "Develop"
author: "AXON CoE - Tech Mahindra"
type: "skill"
---

# AST Gap Analysis

## Purpose
Prevent redundant AI generations and hallucinated scope by mathematically deriving the exact coverage gaps in modified files using an Abstract Syntax Tree.

## Inputs
```yaml
changed_file_ref: string  # path to the modified JS/TS source file
test_file_ref: string     # path to the corresponding .test.js file
```

## Steps
1. Parse `changed_file_ref` using `tree-sitter-javascript`.
2. Extract all `function_declaration` and `method_definition` node names.
3. Parse `test_file_ref` (if it exists). Extract all `string_fragment` nodes (test descriptions and describe blocks).
4. Cross-reference source methods against the test strings.
5. If a source method is found in the test file, flag it as COVERED and skip.
6. If a source method is NOT found, flag it as UNTESTED and pass to the generation pipeline.

## Outputs
```yaml
untested_methods: list  # strict list of function names requiring tests
```

## Failure Modes
- **Syntax Error in Source** — block execution; return parsing error to developer.
- **Empty Return** — if list is empty, terminate the agent workflow early (success state).
