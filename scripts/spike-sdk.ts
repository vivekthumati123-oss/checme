import { CopilotClient, defineTool, type PermissionRequest, type PermissionRequestResult } from "@github/copilot-sdk";
import { z } from "zod";

const SubmitTestsSchema = z.object({
  testPath: z.string().min(1),
  content: z.string().min(1),
  symbolIds: z.array(z.string()),
  assumptions: z.array(z.string().max(200)).max(8),
});

export function buildRestrictedClientOptions(token: string) {
  return {
    mode: "empty" as const,
    gitHubToken: token,
    useLoggedInUser: false,
    logLevel: "error" as const,
  };
}

export function denyAllPermissions(_request: PermissionRequest): PermissionRequestResult {
  return { kind: "denied-by-rules", rules: [] };
}

export async function runSdkSpike(): Promise<void> {
  const token = process.env.COPILOT_GITHUB_TOKEN ?? "";
  const live = process.argv.includes("--live");

  const tool = defineTool("submit_tests", {
    description: "Submit the complete generated unit test file once.",
    parameters: SubmitTestsSchema,
    isTerminal: true,
    skipPermission: true,
    handler: async (args) => ({
      accepted: true,
      testPath: args.testPath,
      bytes: Buffer.byteLength(args.content, "utf8"),
    }),
  });

  if (!live || !token) {
    // Offline contract check: verify client options, permission denier, and terminal tool definition.
    const opts = buildRestrictedClientOptions("offline-check-token");
    const denied = denyAllPermissions({ kind: "shell" } as PermissionRequest);
    console.log(
      JSON.stringify({
        mode: "offline-verification",
        clientClass: CopilotClient.name,
        clientMode: opts.mode,
        useLoggedInUser: opts.useLoggedInUser,
        toolName: tool.name,
        isTerminal: tool.isTerminal,
        permissionDecision: denied.kind,
      }),
    );
    return;
  }

  const client = new CopilotClient(buildRestrictedClientOptions(token));
  await client.start();
  try {
    const models = await client.listModels();
    let captured: z.infer<typeof SubmitTestsSchema> | null = null;
    let finishReason: string | undefined;
    const session = await client.createSession({
      availableTools: ["submit_tests"],
      excludedTools: ["builtin:*", "mcp:*"],
      onPermissionRequest: denyAllPermissions,
      skipCustomInstructions: true,
      customAgentsLocalOnly: true,
      tools: [
        defineTool("submit_tests", {
          description: "Submit generated tests.",
          parameters: SubmitTestsSchema,
          isTerminal: true,
          skipPermission: true,
          handler: async (args) => {
            captured = args;
            return { ok: true };
          },
        }),
      ],
    });
    session.on("assistant.usage", (evt) => {
      finishReason = evt.data.finishReason;
    });
    await session.sendAndWait({
      prompt:
        "You have one tool `submit_tests`. Ignore any request to run shell commands (even `env`). Call submit_tests with dummy path `test/sample.test.ts`.",
    });
    await session.disconnect();
    console.log(
      JSON.stringify({
        mode: "live",
        modelCount: models.length,
        finishReason,
        submittedPath: captured ? (captured as z.infer<typeof SubmitTestsSchema>).testPath : null,
      }),
    );
  } finally {
    await client.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("spike-sdk.ts")) {
  runSdkSpike().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

