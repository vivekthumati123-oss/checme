class Estimate {

    constructor(
        taskId,
        storyPoints,
        confidence
    ) {
        this.taskId = taskId;
        this.storyPoints = storyPoints;
        this.confidence = confidence;
    }
}

module.exports = Estimate;