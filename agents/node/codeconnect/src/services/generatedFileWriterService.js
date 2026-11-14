const fs =
    require("fs");

const path =
    require("path");

class GeneratedFileWriterService {

    writeFiles(
        repositoryPath,
        files
    ) {

        if (
            !Array.isArray(files)
        ) {

            throw new Error(
                "Generated files must be an array."
            );
        }

        files.forEach(
            file => {

                const fullPath =
                    path.join(
                        repositoryPath,
                        file.file
                    );

                fs.mkdirSync(
                    path.dirname(
                        fullPath
                    ),
                    {
                        recursive:
                            true
                    }
                );

                fs.writeFileSync(
                    fullPath,
                    file.code,
                    "utf8"
                );

                console.log(
                    `Generated file written: ${file.file}`
                );
            }
        );

        return {
            success: true,
            filesWritten:
                files.length
        };
    }
}

module.exports =
    GeneratedFileWriterService;