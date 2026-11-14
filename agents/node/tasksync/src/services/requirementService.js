const Requirement =
    require("../domain/Requirement");

class RequirementService {

    extractRequirements(story) {

        const requirements = [];

        const parts =
            story.description
                .split(".")
                .map(item => item.trim())
                .filter(item => item);

        parts.forEach(
            (part, index) => {

                requirements.push(
                    new Requirement(
                        `REQ-${String(
                            index + 1
                        ).padStart(3, "0")}`,
                        `Requirement ${index + 1}`,
                        part
                    )
                );

            }
        );

        return requirements;
    }
}

module.exports =
    RequirementService;