const MANIFESTS = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "pipfile", "pipfile.lock",
  "poetry.lock", "uv.lock", "setup.py", "setup.cfg", "pom.xml", "build.gradle",
  "build.gradle.kts", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
]);

export function isArchitectureRelevant(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  const name = normalized.split("/").pop();
  return Boolean(name && (MANIFESTS.has(name) || /\.(js|jsx|ts|tsx|mjs|cjs|py|tf|tfvars|bicep|yaml|yml)$/.test(normalized)));
}

export function isSafeRepositoryPath(filePath) {
  if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized)
    && !normalized.split("/").includes("..")
    && !/(^|\/)(\.git|node_modules|dist|build|\.env(?:\.[^/]*)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_rsa[^/]*|id_ed25519[^/]*)(\/|$)/i.test(normalized)
    && !/\.(pem|key|pfx|p12)$/i.test(normalized);
}

export function selectArchitectureFiles(tree) {
  if (!Array.isArray(tree)) return [];
  return tree.filter((item) => item && item.type === "file" && isSafeRepositoryPath(item.path) && isArchitectureRelevant(item.path))
    .map((item) => item.path.replace(/\\/g, "/"));
}