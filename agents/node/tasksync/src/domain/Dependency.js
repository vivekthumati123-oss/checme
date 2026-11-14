class Dependency {

    constructor(
        sourceTask,
        targetTask
    ) {
        this.sourceTask = sourceTask;
        this.targetTask = targetTask;
    }
}

module.exports = Dependency;