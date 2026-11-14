import path from "node:path";
import { BaseAgent, automationTask, createAgentResult } from "@l2/agent-core";
import { ArtifactStore, digest } from "@l2/agent-runtime";
import { parseStructuredOutput } from "@l2/copilot-runtime";
import { analyzeRequirements, captureRequirements } from "./requirement-analyzer.js";
import { validateDocument, renderDocument, applyAnswers } from "./fsd-document.js";

export class RequirementsHubAgent extends BaseAgent {
  async validate(request) {
    if (!["list", "generate", "finalize"].includes(request.payload.mode)) throw new Error("RequirementsHub mode must be list, generate or finalize");
    if (request.payload.mode !== "list" && !/^[A-Z][A-Z0-9_]+-\d+$/.test(request.payload.epicKey ?? "")) throw new Error("Supply exactly one Jira epic with --epic or EPIC_KEY");
    if (request.payload.mode === "list" && !/^[A-Z][A-Z0-9_]+$/.test(request.payload.project ?? "")) throw new Error("Epic listing requires --project or JIRA_PROJECT");
    if (!/^[A-Za-z0-9_-]+$/.test(request.payload.revision ?? "draft")) throw new Error("Revision must contain letters, numbers, underscores or hyphens");
  }

  async perform(request, context) {
    const config = this.binding.resolveConfig(request.payload);
    if (config.mode === "list") {
      context.policy.authorize({ action: "work-item.read" });
      const epics = await context.workItems.searchAll("jira", `project = "${config.project}" AND issuetype = Epic ORDER BY key ASC`);
      return createAgentResult(request, { summary: `Found ${epics.length} epics. Select one epic key.`, data: { epics } });
    }
    const revision = config.revision ?? "draft";
    const store = context.artifacts ?? new ArtifactStore({ workspace: path.resolve(config.workspace ?? context.workspace), directory: `.l2/requirementshub/${config.epicKey}`, context });
    const filename = `FSD-${config.epicKey}${revision === "draft" ? "" : `-${revision}`}.md`;
    return store.locked(async () => {
      if (config.mode === "finalize") {
        const snapshot = await store.json(`snapshot-${revision}.json`);
        const draft = await store.read(filename);
        if (!snapshot || !draft || digest(draft) !== snapshot.draftDigest) throw new Error("Matching immutable draft and source snapshot are required for finalization");
        if (snapshot.source?.epic?.jiraKey !== config.epicKey || !Array.isArray(snapshot.source?.requirements) || validateDocument(snapshot.document, snapshot.source.requirements).length || renderDocument(snapshot.document, snapshot.source) !== draft) throw new Error("Source snapshot no longer reproduces the immutable draft; restore the matching snapshot");
        const answers = config.answers ?? JSON.parse(await store.readInput(config.answersPath));
        const applied = applyAnswers(snapshot.document, answers, snapshot.source.requirements);
        const finalName = filename.replace(/\.md$/, "-final.md");
        const markdown = renderDocument(applied.document, snapshot.source);
        if (!request.dryRun) {
          await store.write(finalName, markdown, { overwrite: false });
          await store.write(`answers-${revision}.json`, { answers, resolved: applied.resolved, draftDigest: snapshot.draftDigest }, { overwrite: false });
        }
        return createAgentResult(request, { summary: `Applied ${applied.resolved.length} answers; ${applied.document.openQuestions.length} questions remain. Draft preserved.`,
          data: { resolved: applied.resolved, openQuestions: applied.document.openQuestions, markdown }, artifacts: request.dryRun ? [] : [{ type: "file", path: store.relative(finalName) }] });
      }
      if (await store.read(filename) !== null || await store.read(`snapshot-${revision}.json`) !== null) throw new Error("Draft revision already exists; use --revision with a fresh name");
      context.policy.authorize({ action: "work-item.read" });
      const epic = await context.workItems.getWorkItem(`jira:${config.epicKey}`);
      if (epic.type.toLowerCase() !== "epic") throw new Error("Selected Jira issue is not an Epic");
      const children = await context.workItems.getEpicChildren(`jira:${config.epicKey}`);
      if (!children.length) throw new Error("Epic has no direct child requirements");
      const captured = captureRequirements(children, await store.json("fr-ids.json") ?? {});
      const source = { epic: { jiraKey: config.epicKey, title: epic.title, description: epic.description }, requirements: captured.requirements };
      const response = await context.runtime.run({ agentId: this.id, systemPrompt: this.composePrompt().build().systemPrompt, workingDirectory: config.workspace ?? context.workspace, timeoutMs: 180000,
        userPrompt: automationTask({ operation: "generate-fsd", source, analysis: analyzeRequirements(children) }),
      });
      const document = response.structuredOutput ?? parseStructuredOutput(response.content);
      const problems = validateDocument(document, source.requirements);
      if (problems.length) throw new Error(`Invalid FSD response: ${problems.join("; ")}`);
      const markdown = renderDocument(document, source);
      if (!request.dryRun) {
        await store.write("fr-ids.json", captured.ids);
        await store.write(filename, markdown, { overwrite: false });
        await store.write(`snapshot-${revision}.json`, { source, document, draftDigest: digest(markdown) }, { overwrite: false });
      }
      return createAgentResult(request, { summary: `FSD generated: ${source.requirements.length} requirements; ${document.openQuestions.length} open questions.`,
        data: { requirementCount: source.requirements.length, openQuestions: document.openQuestions, markdown }, artifacts: request.dryRun ? [] : [{ type: "file", path: store.relative(filename) }] });
    });
  }
}