const Task =
    require("../domain/Task");

class TaskGenerationService {

    generateTasks(stories) {

        const tasks = [];

        stories.forEach(
            (story, index) => {

                tasks.push(
                    new Task(
                        `TASK-${index + 1}-1`,
                        story.id,
                        `Analyze ${story.title}`,
                        story.description
                    )
                );

                tasks.push(
                    new Task(
                        `TASK-${index + 1}-2`,
                        story.id,
                        `Implement ${story.title}`,
                        story.description
                    )
                );

                tasks.push(
                    new Task(
                        `TASK-${index + 1}-3`,
                        story.id,
                        `Test ${story.title}`,
                        story.description
                    )
                );

            }
        );

        return tasks;
    }
}

module.exports =
    TaskGenerationService;