class ImplementationPlan {

    constructor(
        story,
        requirements,
        tasks,
        subtasks,
        dependencies,
        estimates
    ) {

        this.story = story;
        this.requirements = requirements;
        this.tasks = tasks;
        this.subtasks = subtasks;
        this.dependencies = dependencies;
        this.estimates = estimates;
    }
}

module.exports =
    ImplementationPlan;
    