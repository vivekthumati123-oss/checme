class TaskMappingService {

    mapTask(
        task,
        repositoryAnalysis
    ) {

        const filesToModify = [];

        const title =
            task.title.toLowerCase();

        if (
            title.includes("api") ||
            title.includes("endpoint")
        ) {

            filesToModify.push(
                ...repositoryAnalysis.controllers,
                ...repositoryAnalysis.routes,
                ...repositoryAnalysis.services
            );
        }

        if (
            title.includes("database") ||
            title.includes("schema") ||
            title.includes("token")
        ) {

            filesToModify.push(
                ...repositoryAnalysis.repositories
            );
        }

        if (
            title.includes("email")
        ) {

            filesToModify.push(
                ...repositoryAnalysis.services
            );
        }

        return {

            taskId:
                task.taskId,

            title:
                task.title,

            filesToModify:
                [...new Set(
                    filesToModify
                )]
        };
    }
}

module.exports =
    TaskMappingService;