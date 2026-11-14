const {
    CopilotClient,
    approveAll
} = require(
    "@github/copilot-sdk"
);

class CopilotTaskGenerationService {

    async generateTasks(
        prompt
    ) {

        const client =
            new CopilotClient();

        await client.start();

        const session =
            await client.createSession({
                model: "gpt-5",
                onPermissionRequest:
                    approveAll
            });

        let response = "";

        session.on(
            "assistant.message",
            event => {

                if (
                    event &&
                    event.data &&
                    event.data.content
                ) {

                    response +=
                        event.data.content;
                }
            }
        );

        const done =
            new Promise(
                resolve => {

                    session.on(
                        "session.idle",
                        () => resolve()
                    );
                }
            );

        await session.send({
            prompt
        });

        await done;

        await session.disconnect();

        await client.stop();

        console.log(
            "\nRAW COPILOT RESPONSE\n"
        );

        console.log(
            response
        );

        const jsonStart =
            response.indexOf("{");

        const jsonEnd =
            response.lastIndexOf("}");

        if (
            jsonStart === -1 ||
            jsonEnd === -1
        ) {

            throw new Error(
                "No JSON found in Copilot response"
            );
        }

        const jsonString =
            response.substring(
                jsonStart,
                jsonEnd + 1
            );

        return JSON.parse(
            jsonString
        );
    }
}

module.exports =
    CopilotTaskGenerationService;