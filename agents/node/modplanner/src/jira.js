import { digest } from "@l2/agent-runtime";

export function buildPreview(plan, { project, runId }) {
  if (!/^[A-Z][A-Z0-9_]+$/.test(project ?? "")) throw new Error("A Jira project key is required (--project or JIRA_PROJECT)");
  const applicationTag = `modplanner-app-${digest({ application: plan.application, project }).slice(0, 24)}`;
  const runTag = `modplanner-run-${digest({ application: plan.application, project, runId }).slice(0, 24)}`;
  const tags = ["modplanner", applicationTag, runTag];
  const modules = [...plan.modules].sort((left, right) => left.order - right.order);
  const preview = {
    version: 1, provider: "jira", project, runId, planDigest: digest(plan), applicationTag, runTag,
    epic: { project, type: "Epic", title: `Modernize ${plan.application}`, tags,
      description: `${plan.summary}\nTotal estimated effort: ${modules.reduce((sum, module) => sum + module.effortDays, 0)} days\nCreated by ModPlanner.` },
    stories: modules.map((module) => ({ moduleId: module.id, project, type: "Story", title: `${module.order}. Migrate ${module.id}`,
      tags: [...tags, `modplanner-module-${digest(module.id).slice(0, 24)}`],
      description: `Risk: ${module.riskScore}/10 - ${module.riskReason}\nEstimated effort: ${module.effortDays} days\nDepends on: ${module.dependsOn.join(", ") || "nothing"}\nTasks:\n${module.tasks.map((task) => `- ${task}`).join("\n")}`,
    })),
  };
  return { ...preview, digest: digest(preview) };
}

export function requireApprovedPreview(preview, expected, confirmation) {
  const { digest: storedDigest, ...payload } = preview;
  if (!confirmation.apply || confirmation.digest !== storedDigest || storedDigest !== expected.digest || digest(payload) !== storedDigest) throw new Error("Creation requires --apply and the unchanged reviewed --digest; generate/review a new preview if it changed");
}