class TaskSelectionService {

    getTaskById(
        implementationPlan,
        taskId
    ) {

        return implementationPlan
            .implementationBacklog
            .find(
                task =>
                    task.taskId === taskId
            );
    }
}

module.exports =
    TaskSelectionService;