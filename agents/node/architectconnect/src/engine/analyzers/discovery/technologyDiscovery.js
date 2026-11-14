import { normalizePath } from "./pathUtils.js";


function getContent(item) {
  if (!item) {
    return "";
  }

  if (typeof item.content === "string") {
    return item.content;
  }

  if (typeof item.text === "string") {
    return item.text;
  }

  return "";
}


function parseJson(content) {
  if (
    typeof content !== "string" ||
    !content.trim()
  ) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}


function discoverNodeTechnology(
  files
) {
  const result = {
    detected: false,
    language: null,
    runtime: null,
    framework: null,
    type: null,
    confidence: 0,
    evidence: []
  };

  if (!Array.isArray(files)) {
    return result;
  }

  const packageFile =
    files.find((item) => {
      const path =
        normalizePath(
          item.path ||
          item.name
        ).toLowerCase();

      return path.endsWith(
        "package.json"
      );
    });

  if (!packageFile) {
    return result;
  }

  result.detected = true;
  result.language = "JavaScript";
  result.runtime = "Node.js";
  result.confidence = 0.6;

  result.evidence.push({
    path:
      packageFile.path ||
      packageFile.name,
    reason:
      "package.json detected"
  });

  const packageJson =
    parseJson(
      getContent(
        packageFile
      )
    );

  if (!packageJson) {
    return result;
  }

  const dependencies = {
    ...(
      packageJson.dependencies ||
      {}
    ),
    ...(
      packageJson.devDependencies ||
      {}
    )
  };

  if (dependencies.typescript) {
    result.language =
      "TypeScript";

    result.evidence.push({
      path:
        packageFile.path ||
        packageFile.name,
      reason:
        "TypeScript dependency detected"
    });
  }

  if (dependencies.express) {
    result.framework =
      "Express";

    result.type =
      "backend";

    result.confidence =
      0.95;

    result.evidence.push({
      path:
        packageFile.path ||
        packageFile.name,
      reason:
        "Express dependency detected"
    });
  }

  if (dependencies.react) {
    result.framework =
      "React";

    result.type =
      "frontend";

    result.confidence =
      0.95;

    result.evidence.push({
      path:
        packageFile.path ||
        packageFile.name,
      reason:
        "React dependency detected"
    });
  }

  return result;
}


function discoverPythonTechnology(
  files
) {
  const result = {
    detected: false,
    language: null,
    runtime: null,
    framework: null,
    type: null,
    confidence: 0,
    evidence: []
  };

  if (!Array.isArray(files)) {
    return result;
  }

  const pythonFiles =
    files.filter((item) => {
      const path =
        normalizePath(
          item.path ||
          item.name
        ).toLowerCase();

      return path.endsWith(".py");
    });

  const dependencyFiles =
    files.filter((item) => {
      const path =
        normalizePath(
          item.path ||
          item.name
        ).toLowerCase();

      return (
        path.endsWith(
          "requirements.txt"
        ) ||
        path.endsWith(
          "pyproject.toml"
        ) ||
        path.endsWith(
          "pipfile"
        ) ||
        path.endsWith(
          "setup.py"
        )
      );
    });

  if (
    pythonFiles.length === 0 &&
    dependencyFiles.length === 0
  ) {
    return result;
  }

  result.detected = true;
  result.language = "Python";
  result.runtime = "Python";
  result.confidence = 0.6;

  let combinedContent = "";

  for (const file of files) {
    combinedContent +=
      "\n" +
      getContent(file);
  }

  const normalized =
    combinedContent.toLowerCase();

  if (
    normalized.includes(
      "fastapi"
    ) ||
    normalized.includes(
      "apirouter("
    )
  ) {
    result.framework =
      "FastAPI";

    result.type =
      "backend";

    result.confidence =
      0.95;
  } else if (
    normalized.includes(
      "django"
    )
  ) {
    result.framework =
      "Django";

    result.type =
      "backend";

    result.confidence =
      0.95;
  } else if (
    normalized.includes(
      "flask"
    )
  ) {
    result.framework =
      "Flask";

    result.type =
      "backend";

    result.confidence =
      0.95;
  }

  return result;
}


export {
  discoverNodeTechnology,
  discoverPythonTechnology
};
