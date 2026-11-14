import fs from "node:fs";
import path from "node:path";

export class ImplementationPlanExportService {
    constructor(
        outputPath =
           process.env
    .IMPLEMENTATION_PLAN_OUTPUT_PATH ||
"implementation-plan.json"
    ) {
        this.outputPath =
            outputPath;
    }

    export(
        implementationPlan
    ) {
        fs.mkdirSync(
            path.dirname(
                this.outputPath
            ),
            {
                recursive: true
            }
        );

        fs.writeFileSync(
            this.outputPath,
            JSON.stringify(
                implementationPlan,
                null,
                2
            )
        );

        console.log(
            `\nIMPLEMENTATION PLAN EXPORTED: ${this.outputPath}\n`
        );
    }
}