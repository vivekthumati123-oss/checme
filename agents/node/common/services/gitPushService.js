const { execSync } =
    require("child_process");

class GitPushService {

    pushBranch(
        repositoryPath,
        branchName
    ) {

        try {

            execSync(
                `git push -u origin ${branchName}`,
                {
                    cwd:
                        repositoryPath
                }
            );

            return {
                success: true,
                branchName
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
    GitPushService;