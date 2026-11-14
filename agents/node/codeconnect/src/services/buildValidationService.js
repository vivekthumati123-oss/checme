const { execSync } =
    require("child_process");

class BuildValidationService {

    validate(
        repositoryPath
    ) {

        try {

            execSync(
                "npm test",
                {
                    cwd:
                        repositoryPath,
                    stdio:
                        "pipe"
                }
            );

            return {
                success: true
            };

        } catch (error) {

            return {
                success: false,
                error:
                    error.message
            };
        }
    }
}

module.exports =
    BuildValidationService;