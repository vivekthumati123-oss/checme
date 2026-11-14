const { execSync } =
    require("child_process");

class GitCommitService {

    commitChanges(
        repositoryPath,
        commitMessage
    ) {

        try {

            const status =
                execSync(
                    "git status --porcelain",
                    {
                        cwd: repositoryPath,
                        encoding: "utf8"
                    }
                );

            if (
                !status.trim()
            ) {

                return {
                    success: true,
                    message:
                        "No changes to commit"
                };
            }

            execSync(
                "git add .",
                {
                    cwd: repositoryPath
                }
            );

            const result =
                execSync(
                    `git commit -m "${commitMessage}"`,
                    {
                        cwd: repositoryPath,
                        encoding: "utf8"
                    }
                );

            return {
                success: true,
                commitMessage,
                output: result
            };

        } catch (error) {

            return {
                success: false,
                error: error.message,
                output:
                    error.stdout
                        ? error.stdout.toString()
                        : ""
            };
        }
    }
}

module.exports =
    GitCommitService;