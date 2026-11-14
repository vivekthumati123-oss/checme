class CodeGenerationPromptBuilder {

    buildPrompt(
        request
    ) {

        return `
You are a senior software engineer.

Language:
${request.repositoryContext.language}

Framework:
${request.repositoryContext.framework}

ORM:
${request.repositoryContext.orm}

Test Framework:
${request.repositoryContext.testFramework}

Architecture:
${request.repositoryContext.architecture}

Repository Conventions:

Follow the same:
- coding style
- import patterns
- dependency usage
- folder structure
- naming conventions
- error handling approach
- testing conventions

used in the examples below.

IMPORTANT:

- Reuse existing repository patterns.
- Reuse existing services when possible.
- Reuse existing repositories when possible.
- Do not invent connectors, repositories, services, or utilities unless absolutely necessary.
- Prefer repository examples over generic framework conventions.

Existing Repository Example:

${request.repositoryContext.examples?.repository || "No repository example found"}

Existing Service Example:

${request.repositoryContext.examples?.service || "No service example found"}

Existing Controller Example:

${request.repositoryContext.examples?.controller || "No controller example found"}
Existing Repository Components:

Repositories:
${request.repositoryContext.symbols?.repositories?.join("\n") || "None"}

Services:
${request.repositoryContext.symbols?.services?.join("\n") || "None"}

Controllers:
${request.repositoryContext.symbols?.controllers?.join("\n") || "None"}

Routes:
${request.repositoryContext.symbols?.routes?.join("\n") || "None"}

Connectors:
${request.repositoryContext.symbols?.connectors?.join("\n") || "None"}

IMPORTANT:

- Reuse the repositories listed above whenever possible.
- Reuse the services listed above whenever possible.
- Reuse the controllers listed above whenever possible.
- Prefer modifying existing files over creating new files.
- Do not invent alternative repositories if one already exists.
- Do not invent alternative services if one already exists.
- Do not invent connectors unless absolutely necessary.
Previous Validation Errors:

${request.validationErrors || "None"}
Retry Instructions:

You are fixing a previously generated implementation.

Do not rewrite the repository from scratch.

Analyze the validation errors and apply the minimum code changes necessary.

Preserve:
- constructor logic
- seeded users
- existing maps
- existing indexes
- existing test setup assumptions

The validation errors identify the bug.
Fix only those bugs.
Important Validation Rules:

- Preserve all existing public methods.
- Preserve all existing constructors.
- Preserve all existing repository fields and maps.
- Do not remove seeded users, test data, or initialization logic.
- Existing Jest tests must continue to pass.
- Do not redesign repositories.
- Do not replace working implementations.
- Fix only the validation failures reported below.
- Keep all method signatures unchanged.
- Keep all constructor behavior unchanged.
- Keep all existing repository state unchanged unless the validation error explicitly requires modification.
- If a repository already contains working users, maps, indexes, or seed data, preserve them.
- Prefer the smallest possible code change.
- Do not rewrite entire files when only one method needs to change.
Task:
${request.task.title}

Subtasks:
${request.task.subtasks
    .map(
        subtask =>
            "- " +
            subtask.title
    )
    .join("\n")
}

Files To Modify:
${request.task.filesToModify.join("\n")}

Generate actual code changes
for each file.

Return ONLY valid JSON.

Format:

{
  "files": [
    {
      "file": "AuthController.js",
      "code": "...",
      "explanation": "..."
    }
  ]
}

Rules:

- Return JSON only
- Do not explain your reasoning
- Do not describe your process
- Do not mention repository analysis
- Do not mention package installation
- Do not mention tests executed
- Do not mention files you inspected
- Do not use markdown
- Do not wrap JSON in code fences
- Output must begin with {
- Output must end with }

Return only the JSON response.
`;
    }
}

module.exports =
    CodeGenerationPromptBuilder;