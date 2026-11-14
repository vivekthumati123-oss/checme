const fs =
    require("fs");

const path =
    require("path");

class RepositoryContentService {

    readFile(
        repositoryPath,
        relativePath
    ) {

        const fullPath =
            path.join(
                repositoryPath,
                relativePath
            );

        return fs.readFileSync(
            fullPath,
            "utf8"
        );
    }

    getRepositoryExample(
        repositoryPath,
        repositoryProfile
    ) {

        const file =
            repositoryProfile.repositories[0];

        if (!file) {

            return null;
        }

        return this.readFile(
            repositoryPath,
            file
        );
    }

    getServiceExample(
        repositoryPath,
        repositoryProfile
    ) {

        const file =
            repositoryProfile.services[0];

        if (!file) {

            return null;
        }

        return this.readFile(
            repositoryPath,
            file
        );
    }

    getControllerExample(
        repositoryPath,
        repositoryProfile
    ) {

        const file =
            repositoryProfile.controllers[0];

        if (!file) {

            return null;
        }

        return this.readFile(
            repositoryPath,
            file
        );
    }

 getRelevantFiles(
    task,
    repositoryProfile
) {

    return [

        ...repositoryProfile.repositories,

        ...repositoryProfile.services,

        ...repositoryProfile.controllers,

        ...repositoryProfile.routes
    ];
}

    getRelevantFileContents(
        repositoryPath,
        task,
        repositoryProfile
    ) {

        const files =
            this.getRelevantFiles(
                task,
                repositoryProfile
            );

        return files.map(
            file => ({
                file,
                content:
                    this.readFile(
                        repositoryPath,
                        file
                    )
            })
        );
    }
}

module.exports =
    RepositoryContentService;