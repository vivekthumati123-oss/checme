const {
    CopilotClient,
    approveAll
} = require(
    "@github/copilot-sdk"
);

class CodeGenerationService {

    async generateCode(
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

console.log(
    "\nSESSION CREATED\n"
);

        let response = "";

        session.on(
            "error",
            error => {

                console.log(
                    "\nCOPILOT SESSION ERROR\n"
                );

                console.error(
                    error
                );
            }
        );

    session.on(
    "assistant.message",
    event => {

        console.log(
            "\nASSISTANT EVENT RECEIVED\n"
        );

        console.dir(
            event,
            {
                depth: null
            }
        );

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

session.on(
    "session.idle",
    () => {

        console.log(
            "\nSESSION IDLE\n"
        );
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
        console.log(
    "\nPROMPT SENT\n"
);

        await done;

        await session.disconnect();

        await client.stop();

        console.log(
            "\nRAW CODE GENERATION RESPONSE\n"
        );

        console.log(
            response
        );

        console.log(
            "\nRAW RESPONSE LENGTH\n"
        );

        console.log(
            response.length
        );

        const jsonStart =
            response.indexOf("{");

        const jsonEnd =
            response.lastIndexOf("}");

        if (
            jsonStart === -1 ||
            jsonEnd === -1
        ) {

            console.log(
                "\nFULL RAW RESPONSE\n"
            );

            console.log(
                response
            );

            throw new Error(
                "No JSON found in Copilot response"
            );
        }

        const jsonString =
            response.substring(
                jsonStart,
                jsonEnd + 1
            );

        try {

            return JSON.parse(
                jsonString
            );

        } catch (error) {

            console.log(
                "\nFAILED JSON STRING\n"
            );

            console.log(
                jsonString
            );

            throw error;
        }
    }
}

module.exports =
    CodeGenerationService;