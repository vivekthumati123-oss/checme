const Dependency =
    require("../domain/Dependency");

class DependencyService {

    generateDependencies(tasks) {

        const dependencies = [];

        for (
            let i = 1;
            i < tasks.length;
            i++
        ) {

            dependencies.push(
                new Dependency(
                    tasks[i - 1].id,
                    tasks[i].id
                )
            );
        }

        return dependencies;
    }
}

module.exports =
    DependencyService;