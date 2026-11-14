import { BaseAgent, createAgentResult } from "@l2/agent-core";
import { writeArtifacts } from "./artifact-writer.js";
import { createArchitectureService } from "./engine/services/architectConnectService.js";
import { createScmBridgeClient, validateRepositoryUrl } from "./engine/services/scmBridgeClient.js";
import { generateMermaid } from "./engine/mermaidGenerator.js";
import { loadLocalRepository } from "./engine/services/localRepositoryLoader.js";
import { isSafeRepositoryPath } from "./engine/services/architectureFileSelector.js";
import { parseGitHubRepository } from "./engine/services/githubRepositoryLoader.js";
import { validateDiagrams } from "./diagram-validator.js";

export class ArchitectConnectAgent extends BaseAgent {
  async validate(request) {
    const sources = [Boolean(request.payload.repositoryUrl), Boolean(request.payload.localPath), Boolean(request.payload.githubDirect), Array.isArray(request.payload.contents)];
    if (sources.filter(Boolean).length !== 1) throw new Error("Choose exactly one repositoryUrl, localPath, githubDirect, or normalized contents source.");
    if (request.payload.repositoryUrl) validateRepositoryUrl(request.payload.repositoryUrl);
    if (request.payload.githubDirect) parseGitHubRepository(request.payload.githubDirect);
    if (request.payload.contents?.some((file) => !file || !isSafeRepositoryPath(file.path ?? file.name))) {
      throw new Error("Repository contents must contain file records with safe, non-credential paths.");
    }
  }

  async perform(request, context) {
    const decision = context.policy.authorize({ action: "repository.read" });
    if (decision.requiresApproval) throw new Error("Repository analysis requires external approval.");
    const config = this.binding.resolveConfig(request.payload);
    const client = request.payload.repositoryUrl ? createScmBridgeClient({ baseUrl: config.scmBridgeUrl ?? "http://localhost:3000" }) : undefined;
    const service = createArchitectureService({ client, logger: context.logger });
    const local = request.payload.localPath ? await loadLocalRepository(request.payload.localPath) : null;
    const github = request.payload.githubDirect ? parseGitHubRepository(request.payload.githubDirect) : null;
    const result = github ? await service.analyzeGitHubRepository(github.owner, github.repo) : request.payload.repositoryUrl
      ? await service.analyzeScmRepository(request.payload.repositoryUrl)
      : service.analyzeRepositoryContents(local?.contents ?? request.payload.contents, local?.packageContent ?? request.payload.packageContent ?? "", local?.metadata ?? request.payload.metadata ?? {});
    const diagram = generateMermaid(result.selectedFindings);
    const content = `${result.hld}\n\n## Selected Architecture Diagram\n\n\`\`\`mermaid\n${diagram.content}\n\`\`\`\n`;
    const outputDirectory = config.outputDirectory ?? "docs/hld/architectconnect";
    const reportPath = `${outputDirectory}/ArchitectureReport.md`;
    const files = [
      { path: reportPath, content },
      { path: `${outputDirectory}/architecture.dsl`, content: result.dsl },
      { path: `${outputDirectory}/ArchitectureDecisions.json`, content: `${JSON.stringify(result.adrs, null, 2)}\n` },
    ];
    const dryRun = request.dryRun || request.payload.apply !== true;
    let grammar = { mermaidGrammar: "unverified", structurizrGrammar: "unverified", notes: [] };
    if (config.validateDiagrams || config.requireValidated) {
      await writeArtifacts({ files, policy: context.policy, hooks: context.hooks, dryRun: true });
      grammar = await validateDiagrams({ mermaid: diagram.content, dsl: result.dsl }, { hooks: context.hooks });
      if ([grammar.mermaidGrammar, grammar.structurizrGrammar].includes("invalid")) throw new Error("Generated architecture failed diagram grammar validation. No reports were written.");
      if (config.requireValidated && [grammar.mermaidGrammar, grammar.structurizrGrammar].some((status) => status !== "valid")) {
        throw new Error("Both diagram grammars must be validated before writing. Configure the missing validator and retry.");
      }
    }
    const warnings = [grammar.mermaidGrammar === "valid" && grammar.structurizrGrammar === "valid"
      ? "Diagram grammar validated; semantic review is required."
      : grammar.mermaidGrammar === "valid" ? "Diagram grammar is only partially validated; semantic review is required."
        : "Structurizr and Mermaid output generated but not grammar-validated; semantic review is required.", ...grammar.notes];
    if (diagram.omittedRelationships) warnings.push(`${diagram.omittedRelationships} ambiguous or unresolved relationships omitted from Mermaid; retained in findings and DSL.`);
    if (result.acquisition?.missingPaths.length) warnings.push(`${result.acquisition.missingPaths.length} selected source files could not be loaded. Analysis is incomplete.`);
    if (result.acquisition?.treeTruncated) warnings.push("GitHub returned a truncated repository tree. Analysis is incomplete.");
    const summary = `${dryRun ? "Dry run: prepared" : "Saved"} ${files.length} artifacts using ${result.findings.selectedArchitecture?.source ?? "legacy"} architecture.`;
    const data = {
        path: reportPath, content, summary,
        source: result.source ?? local?.source ?? { type: "contents", repository: result.repository, branch: result.branch },
        selection: result.findings.selectedArchitecture,
        findings: result.findings, acquisition: result.acquisition ?? null,
        validation: { generated: true, saved: !dryRun, ...grammar, semanticReview: "required" },
    };
    await writeArtifacts({ files: [{ path: `${outputDirectory}/analysis.json`, content: JSON.stringify(data) }], policy: context.policy, hooks: context.hooks, dryRun: true });
    const artifacts = await writeArtifacts({ files, workspace: context.workspace, policy: context.policy, hooks: context.hooks, dryRun });
    return createAgentResult(request, { summary, artifacts, warnings, data });
  }
}