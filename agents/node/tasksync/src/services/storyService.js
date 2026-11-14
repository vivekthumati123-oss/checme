const Story =
    require("../domain/Story");

const AdfParserService =
    require("./adfParserService");

class StoryService {

    createStory(issue) {

        const parser =
            new AdfParserService();

        const description =
            parser.extractText(
                issue.fields.description
            );

        return new Story(
            issue.key,
            issue.fields.summary,
            description,
            issue.fields.status.name
        );
    }
}

module.exports =
    StoryService;