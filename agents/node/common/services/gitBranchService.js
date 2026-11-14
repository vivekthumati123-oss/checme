const { execSync } =
    require("child_process");

class GitBranchService {

    createBranch(
        repositoryPath,
        branchName
    ) {

        try {

            execSync(
                `git checkout -b ${branchName}`,
                {
                    cwd:
                        repositoryPath
                }
            );

            return {
                success: true,
                branchName,
                created: true
            };

        } catch (error) {

            try {

                execSync(
                    `git checkout ${branchName}`,
                    {
                        cwd:
                            repositoryPath
                    }
                );

                return {
                    success: true,
                    branchName,
                    created: false
                };

            } catch (checkoutError) {

                return {
                    success: false,
                    error:
                        checkoutError.message
                };
            }
        }
    }
}

module.exports =
    GitBranchService;