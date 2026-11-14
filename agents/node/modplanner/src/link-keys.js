export function linkKeys(plan, receipt) {
  if (!receipt?.epic || !Array.isArray(receipt.stories)) throw new Error("Receipt has no epic; reconcile incomplete creation first");
  const used = new Set();
  const modules = plan.modules.map((module) => {
    const matches = receipt.stories.filter((story) => story.moduleId === module.id || (!story.moduleId && (story.key === module.jiraKey || /^\d+\. Migrate /.test(story.summary ?? "") && story.summary.replace(/^\d+\. Migrate /, "") === module.id)));
    if (matches.length !== 1 || !/^[A-Z][A-Z0-9_]+-\d+$/.test(matches[0].key ?? "") || used.has(matches[0].key)) throw new Error(`No unique Jira mapping for ${module.id}; reconcile receipt without recreating tickets`);
    used.add(matches[0].key);
    return { ...module, jiraKey: matches[0].key };
  });
  return { ...plan, epicKey: receipt.epic, modules };
}