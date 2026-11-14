import { normalizePath, getDirectory, getFilesInsideRoot } from "./pathUtils.js";import { discoverNodeTechnology, discoverPythonTechnology } from "./technologyDiscovery.js";


// ==================================================
// APPLICATION ID
// ==================================================

function createApplicationId(
  root,
  runtime
) {
  const safeRoot =
    normalizePath(root)
      .replace(
        /[^a-zA-Z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      )
      .toLowerCase();

  const safeRuntime =
    String(runtime || "app")
      .replace(
        /[^a-zA-Z0-9]+/g,
        "-"
      )
      .toLowerCase();

  return `${safeRuntime}-${safeRoot || "root"}`;
}


// ==================================================
// DISCOVER NODE ROOTS
// ==================================================

function getFileContent(item) {
  if (!item) {
    return "";
  }

  if (
    typeof item.content === "string"
  ) {
    return item.content;
  }

  if (
    typeof item.text === "string"
  ) {
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


function isWorkspaceContainer(
  packageFile
) {
  if (!packageFile) {
    return false;
  }

  const packageJson =
    parseJson(
      getFileContent(
        packageFile
      )
    );

  if (!packageJson) {
    return false;
  }

  return (
    packageJson.private === true &&
    Array.isArray(
      packageJson.workspaces
    ) &&
    packageJson.workspaces.length > 0
  );
}
function discoverNodeRoots(
  contents
) {
  const roots = [];

  if (
    !Array.isArray(contents)
  ) {
    return roots;
  }

  for (
    const item of contents
  ) {
    const path =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );

    if (
      !path
        .toLowerCase()
        .endsWith(
          "package.json"
        )
    ) {
      continue;
    }

    const root =
      getDirectory(
        path
      );


    // ==================================================
    // ROOT WORKSPACE CONTAINER
    // ==================================================
    //
    // If the root package.json represents a private
    // workspace container, do not classify the entire
    // repository as another Node application.
    //
    // Nested workspace package.json files remain
    // eligible application roots.
    //
    // ==================================================

    if (
      root === "" &&
      isWorkspaceContainer(
        item
      )
    ) {
      continue;
    }


    if (
      !roots.includes(
        root
      )
    ) {
      roots.push(
        root
      );
    }
  }

  return roots;
}


// ==================================================
// DISCOVER PYTHON ROOTS
// ==================================================

function discoverPythonRoots(
  contents
) {
  const roots = [];

  const projectFiles = [
    "requirements.txt",
    "pyproject.toml",
    "pipfile",
    "setup.py"
  ];

  for (const item of contents) {
    const path =
      normalizePath(
        item.path ||
        item.name
      );

    const lower =
      path.toLowerCase();

    const match =
      projectFiles.some(
        (name) =>
          lower.endsWith(name)
      );

    if (!match) {
      continue;
    }

    const root =
      getDirectory(path);

    if (!roots.includes(root)) {
      roots.push(root);
    }
  }

  return roots;
}


// ==================================================
// MAIN APPLICATION DISCOVERY
// ==================================================

function discoverApplications(
  contents
) {
  if (!Array.isArray(contents)) {
    return [];
  }

  const applications = [];


  // ==================================================
  // NODE APPLICATIONS
  // ==================================================

  const nodeRoots =
    discoverNodeRoots(
      contents
    );

  for (const root of nodeRoots) {
    const files =
      getFilesInsideRoot(
        contents,
        root
      );

    const technology =
      discoverNodeTechnology(
        files
      );

    if (!technology.detected) {
      continue;
    }

    applications.push({
      id:
        createApplicationId(
          root,
          technology.runtime
        ),

      root,

      language:
        technology.language,

      runtime:
        technology.runtime,

      framework:
        technology.framework,

      type:
        technology.type,

      confidence:
        technology.confidence,

      evidence:
        technology.evidence,

      files:
        files.map(
          (item) =>
            item.path ||
            item.name
        )
    });
  }


  // ==================================================
  // PYTHON APPLICATIONS
  // ==================================================

  const pythonRoots =
    discoverPythonRoots(
      contents
    );

  for (
    const root of pythonRoots
  ) {
    const files =
      getFilesInsideRoot(
        contents,
        root
      );

    const technology =
      discoverPythonTechnology(
        files
      );

    if (!technology.detected) {
      continue;
    }

    const alreadyExists =
      applications.some(
        (application) =>
          application.root ===
            root &&
          application.runtime ===
            technology.runtime
      );

    if (alreadyExists) {
      continue;
    }

    applications.push({
      id:
        createApplicationId(
          root,
          technology.runtime
        ),

      root,

      language:
        technology.language,

      runtime:
        technology.runtime,

      framework:
        technology.framework,

      type:
        technology.type,

      confidence:
        technology.confidence,

      evidence:
        technology.evidence,

      files:
        files.map(
          (item) =>
            item.path ||
            item.name
        )
    });
  }


  return applications;
}


export { discoverApplications };
