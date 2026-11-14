class StorySelectionService {

    getStoryById(
        stories,
        storyId
    ) {

        return stories.find(
    story =>
        story.id ===
        storyId
);
    }
}

module.exports =
    StorySelectionService;