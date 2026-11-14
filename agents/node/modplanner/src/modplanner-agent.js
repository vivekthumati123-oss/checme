import path from "node:path";
import { BaseAgent, createAgentResult } from "@l2/agent-core";
import { ArtifactStore, digest } from "@l2/agent-runtime";
import { generatePlan } from "./planner.js";
import { validatePlan } from "./validate.js";
import { buildPreview, requireApprovedPreview } from "./jira.js";
import { linkKeys } from "./link-keys.js";

export class ModPlannerAgent extends BaseAgent {
  async validate(request) {
    if (!["plan", "preview", "create", "link"].includes(request.payload.mode)) throw new Error("ModPlanner mode must be plan, preview, create or link");
    if (!/^[A-Za-z0-9_-]+$/.test(request.payload.runId ?? "")) throw new Error("--run-id is required and must contain letters, numbers, underscores or hyphens");
    if (request.payload.mode === "create" && !request.payload.apply) throw new Error("Jira creation requires explicit --apply after preview approval");
    if (request.payload.mode === "create" && process.env.GITHUB_ACTIONS === "true" && process.env.PLANNING_APPROVAL_GATE !== "reviewed-environment") throw new Error("Actions Jira creation requires the protected planning workflow");
  }

  async perform(request, context) {
    const config = this.binding.resolveConfig(request.payload);
    const workspace = path.resolve(config.workspace ?? context.workspace);
    const store = context.artifacts ?? new ArtifactStore({ workspace, directory: `.l2/modplanner/${config.runId}`, context });
    return store.locked(async () => {
      if (config.mode === "plan") {
        if (await store.read("jira-created.json") !== null || await store.read("migration-plan.json") !== null) throw new Error("Run already has state; select a new run ID without deleting its receipt");
        const platformStore = new ArtifactStore({ workspace: this.binding.root, directory: `.l2/modplanner/${config.runId}`, context });
        const assessment = config.assessment ?? JSON.parse(config.assessmentPath
          ? await store.readInput(config.assessmentPath)
          : await platformStore.readInput("agents/node/modplanner/samples/assessment-sample.json"));
        const plan = await generatePlan({ assessment, runtime: context.runtime, systemPrompt: this.composePrompt().build().systemPrompt, workspace, logger: context.logger });
        if (!request.dryRun) {
          await store.write("assessment.json", assessment, { overwrite: false });
          await store.write("migration-plan.json", plan, { overwrite: false });
        }
        return createAgentResult(request, { summary: `Planned ${plan.modules.length} modules; ${plan.modules.reduce((sum, module) => sum + module.effortDays, 0)} effort days.`, data: { plan },
          artifacts: request.dryRun ? [] : [{ type: "file", path: store.relative("migration-plan.json") }] });
      }
      const plan = await store.json("migration-plan.json");
      const assessment = await store.json("assessment.json");
      const problems = validatePlan(plan, assessment);
      if (problems.length) throw new Error(`Stored plan is invalid: ${problems.join("; ")}`);
      if (config.mode === "link") {
        const linked = linkKeys(plan, await store.json("jira-created.json"));
        if (!request.dryRun) await store.write("migration-plan.json", linked);
        return createAgentResult(request, { summary: "Linked existing receipt; no Jira requests made.", data: { plan: linked } });
      }
      if (await store.read("jira-created.json") !== null) throw new Error("Receipt already exists; use link or reconcile incomplete state, never create again");
      const expected = buildPreview(plan, { project: config.project, runId: config.runId });
      if (config.mode === "preview" || request.dryRun) {
        if (!request.dryRun) await store.write("preview.json", expected);
        return createAgentResult(request, { summary: `Preview: 1 Epic and ${expected.stories.length} Stories; no Jira requests made.`, data: { preview: expected },
          artifacts: request.dryRun ? [] : [{ type: "file", path: store.relative("preview.json") }] });
      }
      const preview = await store.json("preview.json");
      if (!preview) throw new Error("Run preview before requesting creation");
      requireApprovedPreview(preview, expected, config);
      const decision = context.policy.authorize({ action: "work-item.create" });
      if (decision.requiresApproval && !(config.apply && config.digest === preview.digest)) throw new Error("Work-item approval is missing");
      context.policy.authorize({ action: "work-item.read" });
      const platformStore = new ArtifactStore({ workspace: this.binding.root, directory: `.l2/modplanner/${config.runId}`, context });
      const legacy = context.legacyIndex ?? JSON.parse(await platformStore.readInput("docs/migration-archive/index.json"));
      if (legacy.modplanner.some((item) => item.application === plan.application && item.project === preview.project)) throw new Error("Archived Jira state exists for this application/project; reconcile it rather than recreate tickets");
      const scope = context.scopeArtifacts ?? new ArtifactStore({ workspace, directory: `.l2/modplanner/application-${digest({ application: plan.application, project: preview.project }).slice(0, 24)}`, context });
      return scope.locked(async () => {
        const existing = await context.workItems.searchAll("jira", `project = "${preview.project}" AND labels = "${preview.applicationTag}"`);
        if (existing.length) throw new Error("Jira already contains this application run; reconcile existing issues before any new creation");
        const receipt = { version: 2, runId: config.runId, previewDigest: preview.digest, application: plan.application, project: preview.project, status: "creating-epic", epic: null, stories: [] };
        await store.write("jira-created.json", receipt, { overwrite: false });
        try {
          const epic = await context.workItems.createWorkItem("jira", preview.epic);
          receipt.epic = epic.id.replace(/^jira:/, "");
          await store.write("jira-created.json", receipt);
          for (const story of preview.stories) {
            receipt.status = "creating-story";
            receipt.pendingModuleId = story.moduleId;
            await store.write("jira-created.json", receipt);
            const created = await context.workItems.createWorkItem("jira", { ...story, parentId: epic.id });
            receipt.stories.push({ moduleId: story.moduleId, key: created.id.replace(/^jira:/, ""), summary: story.title });
            delete receipt.pendingModuleId;
            await store.write("jira-created.json", receipt);
          }
          receipt.status = "complete";
          await store.write("jira-created.json", receipt);
        } catch (error) {
          receipt.status = "needs-reconciliation";
          await store.write("jira-created.json", receipt);
          throw new Error(`Creation interrupted; preserve receipt and reconcile Jira before retrying. ${error.message}`);
        }
        return createAgentResult(request, { summary: `Created ${receipt.epic} and ${receipt.stories.length} Stories. Run link next.`, data: { receipt }, artifacts: [{ type: "file", path: store.relative("jira-created.json") }] });
      });
    });
  }
}