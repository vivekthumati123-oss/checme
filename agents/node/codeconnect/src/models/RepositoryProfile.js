class RepositoryProfile {

    constructor() {

        this.language =
            "";

        this.framework =
            "";

        this.architecture =
            "";

        this.testFramework =
            "";

        this.orm =
            "";

        this.packageManager =
            "";

        this.examples = {

            controller:
                null,

            service:
                null,

            repository:
                null,

            test:
                null
        };
    }
}

module.exports =
    RepositoryProfile;