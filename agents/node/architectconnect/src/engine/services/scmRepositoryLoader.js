import { selectArchitectureFiles } from "./architectureFileSelector.js";

export function normalizeContents(files) {
  return files.map((file) => {
    const filePath = String(file.path ?? file.name ?? "").replace(/\\/g, "/");
    return {
      name: filePath.split("/").pop() || file.name || "", path: filePath,
      type: file.type ?? "file", size: file.size, sha: file.sha,
      content: typeof file.content === "string" ? file.content : "",
    };
  });
}

export async function loadRepository(repositoryUrl, { client } = {}) {
  if (!client) throw new Error("An SCM Bridge client must be supplied to load a repository.");
  const context = await client.getArchitectureContext(repositoryUrl);
  const selectedPaths = selectArchitectureFiles(context.tree);
  const files = await client.getFiles(repositoryUrl, selectedPaths, context.ref);
  const contents = normalizeContents(files);
  const received = new Set(contents.map((file) => file.path));
  return {
    ...context, selectedPaths, contents,
    packageContent: contents.find((file) => file.path.toLowerCase() === "package.json")?.content ?? "",
    missingPaths: selectedPaths.filter((filePath) => !received.has(filePath)),
  };
}