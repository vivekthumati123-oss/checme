const Story =
    require("../domain/Story");

class StoryGenerationService {

    generateStories(fsd) {

        return fsd.requirements.map(
            requirement => {

                return {
                    id: requirement.id,
                    title:
                        requirement.title,
                    description:
                        requirement.description
                };

            }
        );
    }
}

module.exports =
    StoryGenerationService;