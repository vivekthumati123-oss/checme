// ==================================================
// NODE DEPENDENCY ANALYZER
// FR-AC-005: Identify Dependencies
//
// Detects:
//
// Controller -> Service
// Service -> Repository
//
// Relationships are derived from actual require(...)
// statements found in repository source files.
//
// Repository-layout independent.
// ==================================================


// ==================================================
// DISPLAY NAME
// ==================================================

function toDisplayName(fileName) {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(
      /\b\w/g,
      (char) => char.toUpperCase()
    );
}


// ==================================================
// NORMALIZE PATH
// ==================================================

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
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
    `/${normalizePath(filePath).toLowerCase()}/`;

  const normalizedSegment =
    `/${normalizePath(segment).toLowerCase()}/`;

  return normalizedPath.includes(
    normalizedSegment
  );
}


// ==================================================
// BACKEND APPLICATION PATH
// ==================================================

function isBackendPath(filePath) {
  return containsPathSegment(
    filePath,
    "backend"
  );
}


// ==================================================
// FILE CONTENT
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


// ==================================================
// SOURCE COMPONENT TYPE
// ==================================================

function getComponentType(path) {
  const normalized =
    normalizePath(path)
      .toLowerCase();

  if (
    normalized.includes(
      "/controllers/"
    )
  ) {
    return "controller";
  }

  if (
    normalized.includes(
      "/services/"
    )
  ) {
    return "service";
  }

  if (
    normalized.includes(
      "/repositories/"
    )
  ) {
    return "repository";
  }

  return null;
}


// ==================================================
// TARGET COMPONENT TYPE
// ==================================================

function getDependencyType(
  dependencyPath
) {
  const normalized =
    normalizePath(
      dependencyPath
    ).toLowerCase();

  if (
    normalized.includes(
      "controllers/"
    )
  ) {
    return "controller";
  }

  if (
    normalized.includes(
      "services/"
    )
  ) {
    return "service";
  }

  if (
    normalized.includes(
      "repositories/"
    )
  ) {
    return "repository";
  }

  return null;
}


// ==================================================
// EXTRACT REQUIRE PATH
// ==================================================
//
// Examples:
//
// require("../services/userService")
//
// returns:
//
// ../services/userService
//
// require('../repositories/userRepository')
//
// returns:
//
// ../repositories/userRepository
//
// ==================================================
function extractRequirePath(line) {
  if (
    typeof line !== "string"
  ) {
    return null;
  }

  const requireIndex =
    line.indexOf("require(");

  if (
    requireIndex === -1
  ) {
    return null;
  }

  const remaining =
    line.slice(
      requireIndex +
      "require(".length
    );

  const doubleQuoteStart =
    remaining.indexOf('"');

  const singleQuoteStart =
    remaining.indexOf("'");

  let quote = null;
  let quoteStart = -1;

  if (
    doubleQuoteStart >= 0 &&
    (
      singleQuoteStart < 0 ||
      doubleQuoteStart <
        singleQuoteStart
    )
  ) {
    quote = '"';
    quoteStart =
      doubleQuoteStart;
  } else if (
    singleQuoteStart >= 0
  ) {
    quote = "'";
    quoteStart =
      singleQuoteStart;
  }

  if (
    !quote ||
    quoteStart < 0
  ) {
    return null;
  }

  const quoteEnd =
    remaining.indexOf(
      quote,
      quoteStart + 1
    );

  if (
    quoteEnd < 0
  ) {
    return null;
  }

  return remaining.slice(
    quoteStart + 1,
    quoteEnd
  );
}
// ==================================================
// MAIN DEPENDENCY ANALYZER
// ==================================================

function analyzeNodeDependencies(
contents,
applicationRoot = null
) {
  const dependencies = [];

  if (
    !Array.isArray(contents)
  ) {
    return dependencies;
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

    if (!originalPath) {
      continue;
    }


    // ==================================================
    // BACKEND APPLICATION BOUNDARY
    //
    // Supported:
    //
    // packages/backend/...
    // applications/backend/...
    // apps/backend/...
    // services/backend/...
    // backend/...
    // ==================================================

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
  !isBackendPath(
    originalPath
  )
) {
  continue;
}


    // ==================================================
    // SOURCE COMPONENT TYPE
    // ==================================================

    const sourceType =
      getComponentType(
        originalPath
      );

    if (!sourceType) {
      continue;
    }


    // ==================================================
    // SOURCE CONTENT
    // ==================================================

    const content =
      getFileContent(
        item
      );

    if (!content) {
      continue;
    }


    // ==================================================
    // SOURCE COMPONENT NAME
    // ==================================================

    const sourceFileName =
      originalPath
        .split("/")
        .pop();

    if (!sourceFileName) {
      continue;
    }

    const sourceName =
      toDisplayName(
        sourceFileName
      );


    // ==================================================
    // PROCESS FILE LINE BY LINE
    // ==================================================

    const lines =
      content.split(/\r?\n/);

    for (
      let lineIndex = 0;
      lineIndex < lines.length;
      lineIndex++
    ) {
      const line =
        lines[lineIndex];

      const dependencyPath =
        extractRequirePath(
          line
        );

      if (!dependencyPath) {
        continue;
      }


      // ==================================================
      // TARGET COMPONENT TYPE
      // ==================================================

      const targetType =
        getDependencyType(
          dependencyPath
        );

      if (!targetType) {
        continue;
      }


      // ==================================================
      // TARGET COMPONENT NAME
      // ==================================================

      const targetFileName =
        normalizePath(
          dependencyPath
        )
          .split("/")
          .pop();

      if (!targetFileName) {
        continue;
      }

      const targetName =
        toDisplayName(
          targetFileName
        );


      // ==================================================
      // PREVENT SELF-RELATIONSHIP
      // ==================================================

      if (
        sourceName === targetName
      ) {
        continue;
      }


      // ==================================================
      // VALID ARCHITECTURAL RELATIONSHIPS
      //
      // Controller -> Service
      // Service -> Repository
      // ==================================================

      const validRelationship =
        (
          sourceType === "controller" &&
          targetType === "service"
        ) ||
        (
          sourceType === "service" &&
          targetType === "repository"
        );

      if (!validRelationship) {
        continue;
      }


      // ==================================================
      // STORE RELATIONSHIP
      // ==================================================

      dependencies.push({
        from:
          sourceName,

        to:
          targetName,

        fromType:
          sourceType,

        toType:
          targetType,

        application:
          "Backend API",

        type:
          "code_dependency",

        relationship:
          "uses",

        evidence:
          line.trim(),

        source:
          originalPath,

        line:
          lineIndex + 1
      });
    }
  }


  // ==================================================
  // REMOVE DUPLICATES
  // ==================================================

  const uniqueDependencies = [];

  const seen =
    new Set();

  for (
    const dependency of dependencies
  ) {
    const key =
      [
        dependency.application,
        dependency.from,
        dependency.to,
        dependency.relationship,
        dependency.source
      ].join("|");

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    uniqueDependencies.push(
      dependency
    );
  }


  // ==================================================
  // RETURN RESULT
  // ==================================================

  return uniqueDependencies;
}


// ==================================================
// EXPORT
// ==================================================

export { analyzeNodeDependencies };
