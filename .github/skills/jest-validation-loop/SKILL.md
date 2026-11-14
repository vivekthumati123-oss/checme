---
name: "jest-validation-loop"
title: "Jest Validation Sandbox"
description: "Executes generated AI test code in a sandboxed Node environment, capturing stderr outputs to power a 3-retry autonomous self-healing loop."
version: "1.0.0"
plugin: "develop-plugin"
sdlc_phase: "Develop"
author: "AXON CoE - Tech Mahindra"
type: "skill"
---

# Jest Validation Sandbox

## Purpose
Mathematically prove that AI-generated tests compile, execute, and assert successfully before committing code. Provide closed-loop feedback to the LLM to fix syntax errors or logic bugs.

## Inputs
```yaml
test_file_path: string    # The local path to the generated .test.js file
max_retries: int          # The maximum number of self-healing attempts (Default: 3)
```

## Steps
1. Execute `npx --no-install jest <test_file_path> --runInBand` synchronously in a credential-free isolated sandbox:
   - Strip all sensitive tokens and environment credentials (`GITHUB_TOKEN`, API keys, secrets) from the execution environment.
   - Restrict network access and limit filesystem access strictly to the target test file.
   - Refuse validation if an isolated runner environment is unavailable.
2. If the exit code is `0` (Success):
   - Terminate the loop.
   - Flag the test suite as VERIFIED.
3. If the exit code is non-zero (Failure):
   - Extract the `stderr` string.
   - Increment the retry counter.
   - If counter < `max_retries`, invoke the AI generation model again, appending the `stderr` log to the context prompt with instructions to fix the error.
4. Repeat execution with the newly generated payload.

## Outputs
```yaml
validation_status: boolean  # True if tests eventually passed, false if max_retries hit
final_code: string          # The final passing JS payload
```

## Failure Modes
- **Max Retries Exceeded** — block execution; abort workflow and emit failure warning to PR.
- **Jest Missing** — if `jest` command not found, exit gracefully with environment configuration error.
- **Isolated Runner Unavailable** — if a credential-free, network-restricted sandbox environment cannot be established, refuse validation and exit with an environment configuration error.
