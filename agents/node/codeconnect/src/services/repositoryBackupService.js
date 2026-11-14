const fs =
    require("fs");

const path =
    require("path");

class RepositoryBackupService {

    backupFiles(
        repositoryPath,
        files
    ) {

        const backups = [];

        files.forEach(
            file => {

                const fullPath =
                    path.join(
                        repositoryPath,
                        file.file
                    );

                if (
                    fs.existsSync(
                        fullPath
                    )
                ) {

                    backups.push({
                        file:
                            file.file,

                        content:
                            fs.readFileSync(
                                fullPath,
                                "utf8"
                            )
                    });
                }
            }
        );

        return backups;
    }

    restoreFiles(
        repositoryPath,
        backups
    ) {

        backups.forEach(
            backup => {

                const fullPath =
                    path.join(
                        repositoryPath,
                        backup.file
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
                    backup.content,
                    "utf8"
                );

                console.log(
                    `Restored file: ${backup.file}`
                );
            }
        );

        return {
            success: true,
            filesRestored:
                backups.length
        };
    }
}

module.exports =
    RepositoryBackupService;