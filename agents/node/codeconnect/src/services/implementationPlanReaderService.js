import fs from "node:fs";

export class ImplementationPlanReaderService {

    readPlan(
        filePath
    ) {

        return JSON.parse(
            fs.readFileSync(
                filePath,
                "utf8"
            )
        );
    }
}