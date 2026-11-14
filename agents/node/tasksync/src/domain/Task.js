class Task {

    constructor(
        id,
        storyId,
        title,
        description
    ) {
        this.id = id;
        this.storyId = storyId;
        this.title = title;
        this.description = description;
    }
}

module.exports = Task;