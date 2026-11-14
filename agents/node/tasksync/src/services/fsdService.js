const FSD =
    require("../domain/FSD");

class FSDService {

    generateFSD(
        story,
        requirements,
        acceptanceCriteria
    ) {

        return new FSD(
            story.summary,
            requirements,
            acceptanceCriteria
        );
    }
}

module.exports =
    FSDService;