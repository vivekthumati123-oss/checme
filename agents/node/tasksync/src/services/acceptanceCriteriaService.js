class AcceptanceCriteriaService {

    extractAcceptanceCriteria(story) {

        const criteria = [];

        const description =
            story.description;

        const marker =
            "Acceptance Criteria:";

        if (
            !description.includes(marker)
        ) {
            return criteria;
        }

        const acceptanceSection =
            description.split(marker)[1];

        const items =
            acceptanceSection
                .split(".")
                .map(item => item.trim())
                .filter(item => item);

        items.forEach(item => {
            criteria.push(item);
        });

        return criteria;
    }
}

module.exports =
    AcceptanceCriteriaService;