class ProjectStoryService {

    formatStories(
        stories
    ) {

        return stories.map(
            story => ({

                id:
                    story.key,

                title:
                    story.fields.summary,

                display:
                    `${story.key} - ${story.fields.summary}`
            })
        );
    }

    printStories(
        stories
    ) {

        const formattedStories =
            this.formatStories(
                stories
            );

        console.log(
            "\nAVAILABLE STORIES\n"
        );

        formattedStories.forEach(
            story => {

                console.log(
                    story.display
                );
            }
        );

        return formattedStories;
    }
}

module.exports =
    ProjectStoryService;
