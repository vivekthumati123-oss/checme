// ==================================================
// ARCHITECTCONNECT NODE COMPONENT ANALYZER
//
// Detects backend application components without
// depending on a fixed repository parent directory.
//
// Supported examples:
//
// packages/backend/src/controllers/userController.js
// applications/backend/src/controllers/userController.js
// apps/backend/src/controllers/userController.js
// services/backend/src/controllers/userController.js
// backend/src/controllers/userController.js
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
      /([a-z])([A-Z])/g,
      "$1 $2"
    )
    .replace(
      /[_-]+/g,
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

// ==================================================
// APPLICATION ROOT CHECK
// ==================================================

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
    normalizedPath ===
      normalizedRoot ||
    normalizedPath.startsWith(
      `${normalizedRoot}/`
    )
  );
}
// ==================================================
// CHECK PATH SEGMENT
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
// BACKEND APPLICATION PATH
// ==================================================

function isBackendPath(
  filePath
) {
  return containsPathSegment(
    filePath,
    "backend"
  );
}


// ==================================================
// NODE COMPONENT ANALYSIS
// ==================================================

function analyzeNodeComponents(
contents,
applicationRoot = null
) {
  const components = [];

  // ==================================================
  // SAFETY
  // ==================================================

  if (
    !Array.isArray(contents)
  ) {
    return components;
  }


  // ==================================================
  // ANALYZE FILES
  // ==================================================

  for (
    const item of contents
  ) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const originalPath =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );

    if (
      !originalPath
    ) {
      continue;
    }

    const normalizedLowerPath =
      originalPath
        .toLowerCase();


    // ==================================================
    // APPLICATION BOUNDARY
    //
    // Previously:
    //
    // path.startsWith("packages/backend/")
    //
    // This caused ArchitectConnect to fail when:
    //
    // packages/
    //
    // was renamed to:
    //
    // applications/
    //
    // We now detect "backend" as a complete path
    // segment instead.
    //
    // Supported:
    //
    // packages/backend/...
    // applications/backend/...
    // apps/backend/...
    // services/backend/...
    // backend/...
    //
    // ==================================================

    if (
      !isBackendPath(
        originalPath
      )
    ) {
      continue;
    }


    // ==================================================
    // FILE NAME
    // ==================================================

    const fileName =
      originalPath
        .split("/")
        .pop();

    if (
      !fileName
    ) {
      continue;
    }


    // ==================================================
    // CONTROLLER
    // ==================================================

    if (
      normalizedLowerPath.includes(
        "/controllers/"
      )
    ) {
      components.push({
        name:
          toDisplayName(
            fileName
          ),

        type:
          "controller",

        application:
          "Backend API",

        responsibility:
          "Handles incoming API requests and delegates application processing.",

        source:
          originalPath
      });

      continue;
    }


    // ==================================================
    // SERVICE
    // ==================================================

    if (
      normalizedLowerPath.includes(
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
          "Backend API",

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
      normalizedLowerPath.includes(
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
          "Backend API",

        responsibility:
          "Provides data-access or persistence abstraction.",

        source:
          originalPath
      });

      continue;
    }
  }


  // ==================================================
  // RESULT
  // ==================================================

  return components;
}


// ==================================================
// EXPORT
// ==================================================

export { analyzeNodeComponents };
