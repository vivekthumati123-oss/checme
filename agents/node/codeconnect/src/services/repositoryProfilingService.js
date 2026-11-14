const fs =
    require("fs");

const path =
    require("path");

class RepositoryProfilingService {

    profile(
        repositoryPath
    ) {

        const profile = {

            language:
                "Unknown",

            framework:
                "Unknown",

            orm:
                "Unknown",

            testFramework:
                "Unknown",

            architecture:
                "Custom",

            packageManager:
                "Unknown",

            controllers: [],

            services: [],

            repositories: [],

            routes: [],

            models: [],

            examples: {

    controller:
        null,

    service:
        null,

    repository:
        null,

    test:
        null
},

symbols: {

    repositories: [],

    services: [],

    controllers: [],

    models: [],

    routes: [],

    connectors: []
}
        };

        this.detectPackageInformation(
            repositoryPath,
            profile
        );

        this.scanRepository(
            repositoryPath,
            repositoryPath,
            profile
        );

        this.detectArchitecture(
            profile
        );

       this.extractExamples(
    repositoryPath,
    profile
);

profile.symbols.repositories =
    [...new Set(profile.symbols.repositories)];

profile.symbols.services =
    [...new Set(profile.symbols.services)];

profile.symbols.controllers =
    [...new Set(profile.symbols.controllers)];

profile.symbols.models =
    [...new Set(profile.symbols.models)];

profile.symbols.routes =
    [...new Set(profile.symbols.routes)];

profile.symbols.connectors =
    [...new Set(profile.symbols.connectors)];

return profile;
    }

    detectPackageInformation(
        repositoryPath,
        profile
    ) {

        const packageJsonPath =
            path.join(
                repositoryPath,
                "package.json"
            );

        if (
            !fs.existsSync(
                packageJsonPath
            )
        ) {

            return;
        }

        const packageJson =
            JSON.parse(
                fs.readFileSync(
                    packageJsonPath,
                    "utf8"
                )
            );

        profile.language =
            "JavaScript";

        profile.packageManager =
            "npm";

        const dependencies = {

            ...(packageJson.dependencies || {}),

            ...(packageJson.devDependencies || {})
        };

        if (
            dependencies.express
        ) {

            profile.framework =
                "Express";
        }

        if (
            dependencies.knex
        ) {

            profile.orm =
                "Knex";
        }

        if (
            dependencies.sequelize
        ) {

            profile.orm =
                "Sequelize";
        }

        if (
            dependencies.typeorm
        ) {

            profile.orm =
                "TypeORM";
        }

        if (
            dependencies.jest
        ) {

            profile.testFramework =
                "Jest";
        }

        if (
            dependencies.mocha
        ) {

            profile.testFramework =
                "Mocha";
        }
    }

    scanRepository(
        repositoryPath,
        currentPath,
        profile
    ) {

        const items =
            fs.readdirSync(
                currentPath,
                {
                    withFileTypes:
                        true
                }
            );

        for (
            const item
            of items
        ) {

            const fullPath =
                path.join(
                    currentPath,
                    item.name
                );

            if (
                item.isDirectory()
            ) {

                if (
                    item.name ===
                    "node_modules"
                ) {

                    continue;
                }

                this.scanRepository(
                    repositoryPath,
                    fullPath,
                    profile
                );

                continue;
            }

            const relativePath =
                path.relative(
                    repositoryPath,
                    fullPath
                );

          const lower =
    relativePath
        .toLowerCase();

const symbolName =
    path.basename(
        relativePath,
        path.extname(
            relativePath
        )
    
    );
if (
    lower.includes(
        "controller"
    )
) {

    profile.controllers
        .push(
            relativePath
        );

    profile.symbols.controllers
        .push(
            symbolName
        );
}

          if (
    lower.includes(
        "service"
    )
) {

    profile.services
        .push(
            relativePath
        );

    profile.symbols.services
        .push(
            symbolName
        );
}

           if (
    lower.includes(
        "repository"
    )
) {

    profile.repositories
        .push(
            relativePath
        );

    profile.symbols.repositories
        .push(
            symbolName
        );
}

           if (
    lower.includes(
        "route"
    )
) {

    profile.routes
        .push(
            relativePath
        );

    profile.symbols.routes
        .push(
            symbolName
        );
}

            if (
    lower.includes(
        "model"
    )
) {

    profile.models
        .push(
            relativePath
        );

    profile.symbols.models
        .push(
            symbolName
        );
}
if (
    lower.includes(
        "connector"
    )
) {

    profile.symbols.connectors
        .push(
            symbolName
        );
}
        }
    }
    

    detectArchitecture(
        profile
    ) {

        if (

            profile.controllers.length &&

            profile.services.length &&

            profile.repositories.length

        ) {

            profile.architecture =
                "Controller-Service-Repository";

            return;
        }

        if (

            profile.controllers.length &&

            profile.services.length

        ) {

            profile.architecture =
                "Controller-Service";

            return;
        }

        profile.architecture =
            "Custom";
    }

    extractExamples(
        repositoryPath,
        profile
    ) {

        const readExample =
            filePath => {

                if (
                    !filePath
                ) {

                    return null;
                }

                const fullPath =
                    path.join(
                        repositoryPath,
                        filePath
                    );

                return fs.readFileSync(
                    fullPath,
                    "utf8"
                );
            };

        profile.examples.controller =
            readExample(
                profile.controllers[0]
            );

        profile.examples.service =
            readExample(
                profile.services[0]
            );

        profile.examples.repository =
            readExample(
                profile.repositories[0]
            );
    }
}

module.exports =
    RepositoryProfilingService;