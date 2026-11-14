const Subtask =
    require("../domain/Subtask");

class SubtaskGenerationService {

    generateSubtasks(tasks) {

        const subtasks = [];

        tasks.forEach(
            (task, index) => {

                subtasks.push(
                    new Subtask(
                        `SUB-${index + 1}-1`,
                        task.id,
                        "Design Solution",
                        task.description
                    )
                );

                subtasks.push(
                    new Subtask(
                        `SUB-${index + 1}-2`,
                        task.id,
                        "Implement Logic",
                        task.description
                    )
                );

                subtasks.push(
                    new Subtask(
                        `SUB-${index + 1}-3`,
                        task.id,
                        "Write Tests",
                        task.description
                    )
                );

            }
        );

        return subtasks;
    }
}

module.exports =
    SubtaskGenerationService;