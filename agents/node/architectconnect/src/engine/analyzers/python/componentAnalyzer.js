// ==================================================
// PYTHON COMPONENT ANALYZER
//
// Repository-layout independent.
//
// Supports:
//
// packages/python-api/...
// applications/python-api/...
// apps/python-api/...
// services/python-api/...
// python-api/...
//
// ==================================================


// ==================================================
// DISPLAY NAME
// ==================================================

function toDisplayName(fileName) {
  return String(fileName || "")
    .replace(
      /\.[^.]+$/,
      ""
    )
    .replace(
      /_/g,
      " "
    )
    .replace(
      /-/g,
      " "
    )
    .replace(
      /\b\w/g,
      (char) =>
        char.toUpperCase()
    );
}


// ==================================================
// NORMALIZE PATH
// ==================================================

function normalizePath(value) {
  return String(value || "")
    .replace(
      /\\/g,
      "/"
    )
    .replace(
      /^\/+|\/+$/g,
      ""
    );
}
function isInsideApplicationRoot(
  filePath,
  applicationRoot
) {
  if (!applicationRoot) {
    return null;
  }

  const normalizedPath =
    normalizePath(
      filePath
    ).toLowerCase();

  const normalizedRoot =
    normalizePath(
      applicationRoot
    ).toLowerCase();

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(
      `${normalizedRoot}/`
    )
  );
}

// ==================================================
// PATH SEGMENT CHECK
// ==================================================

function containsPathSegment(
  filePath,
  segment
) {
  const normalizedPath =
    `/${normalizePath(
      filePath
    ).toLowerCase()}/`;

  const normalizedSegment =
    `/${normalizePath(
      segment
    ).toLowerCase()}/`;

  return normalizedPath.includes(
    normalizedSegment
  );
}


// ==================================================
// PYTHON API PATH
// ==================================================

function isPythonApiPath(
  filePath
) {
  return containsPathSegment(
    filePath,
    "python-api"
  );
}


// ==================================================
// MAIN COMPONENT ANALYSIS
// ==================================================

function analyzePythonComponents(
  contents,
  applicationRoot = null
) {
  const components = [];

  if (
    !Array.isArray(contents)
  ) {
    return components;
  }

  for (
    const item of contents
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      continue;
    }

    const originalPath =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );

    const path =
      originalPath.toLowerCase();

    const insideDiscoveredRoot =
  isInsideApplicationRoot(
    originalPath,
    applicationRoot
  );

if (
  applicationRoot &&
  !insideDiscoveredRoot
) {
  continue;
}

if (
  !applicationRoot &&
  !isPythonApiPath(
    originalPath
  )
) {
  continue;
}

    if (
      !path.endsWith(
        ".py"
      )
    ) {
      continue;
    }

    const fileName =
      originalPath
        .split("/")
        .pop();

    if (!fileName) {
      continue;
    }


    // ==================================================
    // ROUTER
    // ==================================================

    if (
      path.includes(
        "/routers/"
      )
    ) {
      components.push({
        name:
          `${toDisplayName(
            fileName
          )} Router`,

        type:
          "router",

        application:
          "Python API",

        responsibility:
          "Defines FastAPI routes and delegates request processing.",

        source:
          originalPath
      });

      continue;
    }


    // ==================================================
    // SERVICE
    // ==================================================

    if (
      path.includes(
        "/services/"
      )
    ) {
      components.push({
        name:
          toDisplayName(
            fileName
          ),

        type:
          "service",

        application:
          "Python API",

        responsibility:
          "Provides application or business service logic.",

        source:
          originalPath
      });

      continue;
    }


    // ==================================================
    // REPOSITORY
    // ==================================================

    if (
      path.includes(
        "/repositories/"
      )
    ) {
      components.push({
        name:
          toDisplayName(
            fileName
          ),

        type:
          "repository",

        application:
          "Python API",

        responsibility:
          "Provides data-access or persistence abstraction.",

        source:
          originalPath
      });
    }
  }

  return components;
}


export { analyzePythonComponents };
