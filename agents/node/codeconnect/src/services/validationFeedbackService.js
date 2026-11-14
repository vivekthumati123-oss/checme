class ValidationFeedbackService {

    extractErrors(
        validationResult
    ) {

        if (
            !validationResult
        ) {

            return "";
        }

        if (
            validationResult.success
        ) {

            return "";
        }

        return (
            validationResult.error ||
            "Unknown validation error."
        );
    }
}

module.exports =
    ValidationFeedbackService;