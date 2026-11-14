class CodeGenerationRequest {

    constructor(
        task,
        repositoryContext
    ) {

        this.task =
            task;

        this.repositoryContext =
            repositoryContext;
    }
}

module.exports =
    CodeGenerationRequest;