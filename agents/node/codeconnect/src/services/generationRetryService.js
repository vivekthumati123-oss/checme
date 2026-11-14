class GenerationRetryService {

    shouldRetry(
        validationResult
    ) {

        return (
            validationResult &&
            !validationResult.success 
        ); 
     }
 buildRetryRequest(
        request,
        validationErrors
    ) {

        return {

            validationErrors,

            repositoryContext:
                request.repositoryContext,

            task:
                request.task
        };
    }

    getMaxRetries() {

        return 1;
    }
}

module.exports =
    GenerationRetryService;