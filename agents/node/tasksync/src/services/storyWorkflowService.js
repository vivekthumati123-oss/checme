class StoryWorkflowService {

    displaySelectedStory(
        story
    ) {

        console.log(
            "\nSELECTED STORY\n"
        );

        console.log(
            `${story.id} - ${story.title}`
        );
    }
}

module.exports =
    StoryWorkflowService;