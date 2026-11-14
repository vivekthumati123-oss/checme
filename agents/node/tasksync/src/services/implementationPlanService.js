export class ImplementationPlanService {

    buildPlan(
        story,
        requirements,
        acceptanceCriteria,
        backlog
    ) {

        return {

            metadata: {

                generatedAt:
                    new Date()
                        .toISOString(),

                sourceStory: {

                    key:
                        story.key,

                    summary:
                        story.summary
                }
            },

            story: {

                key:
                    story.key,

                summary:
                    story.summary,

                description:
                    story.description,

                status:
                    story.status
            },

            requirements:
                requirements,

            acceptanceCriteria:
                acceptanceCriteria,

           implementationBacklog:
    backlog.map(
        item => ({

            taskId:
                item.task.id,

            title:
                item.task.title,

            description:
                item.task.description,

            complexity:
                item.task.complexity,

            storyPoints:
                item.task.storyPoints,

            subtasks:
                item.subtasks
        })
    )
        };
    }
}
 