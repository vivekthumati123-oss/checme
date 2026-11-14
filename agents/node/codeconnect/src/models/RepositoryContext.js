class RepositoryContext {

    constructor(
        pattern,
        controllers,
        services,
        repositories,
        routes
    ) {

        this.pattern =
            pattern;

        this.controllers =
            controllers;

        this.services =
            services;

        this.repositories =
            repositories;

        this.routes =
            routes;
    }
}

module.exports =
    RepositoryContext;