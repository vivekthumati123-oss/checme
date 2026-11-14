const Estimate =
    require("../domain/Estimate");

class EstimationService {

    generateEstimates(tasks) {

        return tasks.map(task => {

            let points = 3;

            if (
                task.title
                    .toLowerCase()
                    .includes("analyze")
            ) {
                points = 1;
            }

            if (
                task.title
                    .toLowerCase()
                    .includes("implement")
            ) {
                points = 5;
            }

            if (
                task.title
                    .toLowerCase()
                    .includes("test")
            ) {
                points = 2;
            }

            return new Estimate(
                task.id,
                points,
                "80%"
            );
        });
    }
}

module.exports =
    EstimationService;