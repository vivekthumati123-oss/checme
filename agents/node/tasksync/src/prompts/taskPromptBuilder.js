class TaskPromptBuilder {

    buildPrompt(
        story,
        acceptanceCriteria
    ) {

        return `
You are a Senior Scrum Master.

Jira Story:
${story.summary}

Description:
${story.description}

Acceptance Criteria:
${acceptanceCriteria.join("\n")}

Generate implementation-ready development tasks.

Assign complexity using ONLY the following values:

Simple
Medium
Complex
Very Complex

Story Point mapping is mandatory:

Simple = 2 Story Points

Medium = 5 Story Points

Complex = 8 Story Points

Very Complex = 13 Story Points

Never use any other Story Point values.

The storyPoints value MUST exactly match the complexity mapping above.

Return ONLY valid JSON.

{
  "tasks": [
    {
      "title": "",
      "description": "",
      "complexity": "",
      "storyPoints": 0
    }
  ]
}
`;
    }

    buildSubtaskPrompt(
        task
    ) {

        return `
You are a Senior Technical Lead.

Task:
${task.title}

Description:
${task.description}

Generate implementation subtasks.

Return ONLY valid JSON.

{
  "subtasks": [
    {
      "title": "",
      "description": ""
    }
  ]
}
`;
    }
}

module.exports =
    TaskPromptBuilder;