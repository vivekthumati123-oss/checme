const { Octokit } =
    require("@octokit/rest");

require("dotenv")
    .config();

class GitHubConnector {

    constructor() {

        this.octokit =
            new Octokit({
                auth:
                    process.env.GITHUB_TOKEN
            });

        this.owner =
            process.env.GITHUB_OWNER;

        this.repo =
            process.env.GITHUB_REPO;

        console.log(
            "OWNER:",
            this.owner
        );

        console.log(
            "REPO:",
            this.repo
        );
    }
async getRepositoryTree() {

    const response =
        await this.octokit.repos.getContent({

            owner:
                this.owner,

            repo:
                this.repo,

            path:
                ""
        });

    return response.data;
}
    async getFileContent(
        filePath
    ) {

        const response =
            await this.octokit.repos.getContent({

                owner:
                    this.owner,

                repo:
                    this.repo,

                path:
                    filePath
            });

        return Buffer
            .from(
                response.data.content,
                "base64"
            )
            .toString(
                "utf8"
            );
    }
}

module.exports =
    GitHubConnector;