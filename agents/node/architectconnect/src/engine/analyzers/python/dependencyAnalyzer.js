// ==================================================
// PYTHON DEPENDENCY ANALYZER
// FR-AC-005
//
// Detects:
//
// Router -> Service
// Service -> Repository
//
// Repository-layout independent.
// ==================================================


// ==================================================
// DISPLAY NAME
// ==================================================

function toDisplayName(name) {
  return String(name || "")
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
// GET FILE CONTENT
// ==================================================

function getFileContent(item) {
  if (!item) {
    return "";
  }

  if (
    typeof item.content ===
    "string"
  ) {
    return item.content;
  }

  if (
    typeof item.text ===
    "string"
  ) {
    return item.text;
  }

  return "";
}


// ==================================================
// SOURCE COMPONENT TYPE
// ==================================================

function getSourceComponentType(
  path
) {
  const normalizedPath =
    normalizePath(
      path
    ).toLowerCase();

  if (
    normalizedPath.includes(
      "/routers/"
    )
  ) {
    return "router";
  }

  if (
    normalizedPath.includes(
      "/services/"
    )
  ) {
    return "service";
  }

  if (
    normalizedPath.includes(
      "/repositories/"
    )
  ) {
    return "repository";
  }

  return null;
}


// ==================================================
// SOURCE COMPONENT NAME
// ==================================================

function getSourceComponentName(
  path,
  type
) {
  const fileName =
    normalizePath(
      path
    )
      .split("/")
      .pop();

  const displayName =
    toDisplayName(
      fileName
    );

  if (
    type === "router"
  ) {
    return `${displayName} Router`;
  }

  return displayName;
}


// ==================================================
// TARGET COMPONENT
// ==================================================

function getTargetComponent(
  modulePath
) {
  if (
    typeof modulePath !==
      "string" ||
    !modulePath
  ) {
    return null;
  }

  const normalizedPath =
    modulePath
      .replace(
        /\./g,
        "/"
      )
      .toLowerCase();

  const moduleName =
    modulePath
      .split(".")
      .pop();

  if (!moduleName) {
    return null;
  }

  if (
    normalizedPath.includes(
      "/services/"
    )
  ) {
    return {
      type:
        "service",

      name:
        toDisplayName(
          moduleName
        )
    };
  }

  if (
    normalizedPath.includes(
      "/repositories/"
    )
  ) {
    return {
      type:
        "repository",

      name:
        toDisplayName(
          moduleName
        )
    };
  }

  if (
    normalizedPath.includes(
      "/routers/"
    )
  ) {
    return {
      type:
        "router",

      name:
        `${toDisplayName(
          moduleName
        )} Router`
    };
  }

  return null;
}


// ==================================================
// MAIN ANALYZER
// ==================================================

function analyzePythonDependencies(
  contents,
  applicationRoot = null
)  {
  const dependencies = [];

  if (
    !Array.isArray(contents)
  ) {
    return dependencies;
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

    const normalizedPath =
      originalPath
        .toLowerCase();

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
      !normalizedPath.endsWith(
        ".py"
      )
    ) {
      continue;
    }

    const sourceType =
      getSourceComponentType(
        originalPath
      );

    if (!sourceType) {
      continue;
    }

    const sourceName =
      getSourceComponentName(
        originalPath,
        sourceType
      );

    const content =
      getFileContent(
        item
      );

    if (!content) {
      continue;
    }

    const lines =
      content.split(
        /\r?\n/
      );

    for (
      let lineIndex = 0;
      lineIndex <
        lines.length;
      lineIndex++
    ) {
      const trimmedLine =
        lines[
          lineIndex
        ].trim();

      if (
        !trimmedLine.startsWith(
          "from "
        )
      ) {
        continue;
      }

      const match =
        trimmedLine.match(
          /^from\s+([^\s]+)\s+import\s+/
        );

      if (!match) {
        continue;
      }

      const modulePath =
        match[1];

      const target =
        getTargetComponent(
          modulePath
        );

      if (!target) {
        continue;
      }

      if (
        sourceName ===
        target.name
      ) {
        continue;
      }

      dependencies.push({
        from:
          sourceName,

        to:
          target.name,

        fromType:
          sourceType,

        toType:
          target.type,

        application:
          "Python API",

        type:
          "code_dependency",

        relationship:
          "uses",

        evidence:
          trimmedLine,

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

  const uniqueDependencies =
    [];

  const seen =
    new Set();

  for (
    const dependency of
    dependencies
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

  return uniqueDependencies;
}


export { analyzePythonDependencies };
