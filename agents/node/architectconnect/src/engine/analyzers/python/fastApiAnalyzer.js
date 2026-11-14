// ==================================================
// FASTAPI ANALYZER
// FR-AC-003 + FR-AC-005
// ==================================================


// ==================================================
// FILE CONTENT
// ==================================================

function getFileContent(item) {
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


// ==================================================
// EXTRACT QUOTED VALUE
// ==================================================
//
// Example:
//
// prefix="/users",
//
// returns:
//
// /users
//
// Supports:
// prefix="/users"
// prefix='/users'
//
// ==================================================

function extractQuotedValue(line) {
  if (
    typeof line !== "string"
  ) {
    return null;
  }

  const doubleQuoteIndex =
    line.indexOf('"');

  const singleQuoteIndex =
    line.indexOf("'");

  let quote = null;
  let startIndex = -1;

  if (
    doubleQuoteIndex >= 0 &&
    (
      singleQuoteIndex < 0 ||
      doubleQuoteIndex <
        singleQuoteIndex
    )
  ) {
    quote = '"';
    startIndex =
      doubleQuoteIndex;
  } else if (
    singleQuoteIndex >= 0
  ) {
    quote = "'";
    startIndex =
      singleQuoteIndex;
  }

  if (
    !quote ||
    startIndex < 0
  ) {
    return null;
  }

  const endIndex =
    line.indexOf(
      quote,
      startIndex + 1
    );

  if (endIndex < 0) {
    return null;
  }

  return line.slice(
    startIndex + 1,
    endIndex
  );
}


// ==================================================
// EXTRACT APIRouter PREFIX
// ==================================================

function extractRouterPrefix(content) {
  if (
    typeof content !== "string"
  ) {
    return "";
  }

  const lines =
    content.split(/\r?\n/);

  let insideRouterBlock = false;

  for (const line of lines) {
    const trimmed =
      line.trim();

    // Detect beginning of:
    //
    // router = APIRouter(
    //
    if (
      trimmed.includes(
        "APIRouter("
      )
    ) {
      insideRouterBlock = true;
    }

    if (!insideRouterBlock) {
      continue;
    }

    // Detect:
    //
    // prefix="/users",
    //
    if (
      trimmed.startsWith(
        "prefix="
      ) ||
      trimmed.startsWith(
        "prefix ="
      )
    ) {
      const prefix =
        extractQuotedValue(
          trimmed
        );

      if (prefix) {
        return prefix;
      }
    }

    // Stop after APIRouter configuration.
    //
    // This works for the current repository style.
    if (
      insideRouterBlock &&
      trimmed === ")"
    ) {
      insideRouterBlock = false;
    }
  }

  return "";
}


// ==================================================
// NORMALIZE ROUTE PATH
// ==================================================

function normalizeRoutePath(
  prefix,
  routePath
) {
  const safePrefix =
    typeof prefix === "string"
      ? prefix.trim()
      : "";

  const safeRoutePath =
    typeof routePath === "string"
      ? routePath.trim()
      : "";

  // ----------------------------------------------
  // No router prefix
  // ----------------------------------------------

  if (!safePrefix) {
    return safeRoutePath || "/";
  }

  // ----------------------------------------------
  // Router root
  //
  // prefix = /users
  // route  = /
  //
  // result = /users/
  // ----------------------------------------------

  if (
    safeRoutePath === "/" ||
    safeRoutePath === ""
  ) {
    return safePrefix.endsWith("/")
      ? safePrefix
      : `${safePrefix}/`;
  }

  // ----------------------------------------------
  // Normalize prefix
  // ----------------------------------------------

  const normalizedPrefix =
    safePrefix.endsWith("/")
      ? safePrefix.slice(
          0,
          -1
        )
      : safePrefix;

  // ----------------------------------------------
  // Normalize route
  // ----------------------------------------------

  const normalizedRoute =
    safeRoutePath.startsWith("/")
      ? safeRoutePath
      : `/${safeRoutePath}`;

  return (
    normalizedPrefix +
    normalizedRoute
  );
}


// ==================================================
// GET HANDLER AFTER DECORATOR
// ==================================================

function getFunctionAfterDecorator(
  content,
  startIndex
) {
  if (
    typeof content !== "string"
  ) {
    return null;
  }

  const remaining =
    content.slice(
      startIndex
    );

  const functionRegex =
    /\b(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

  const match =
    functionRegex.exec(
      remaining
    );

  if (!match) {
    return null;
  }

  return match[1];
}


// ==================================================
// MAIN FASTAPI ANALYZER
// ==================================================

function analyzeFastApi(contents) {
  const routes = [];
  const sourceFiles = [];

  // ==================================================
  // SAFETY
  // ==================================================

  if (!Array.isArray(contents)) {
    return {
      detected: false,
      framework: null,
      sourceFiles: [],
      routes: []
    };
  }

  // ==================================================
  // PROCESS FILES
  // ==================================================

  for (const item of contents) {
    const originalPath =
      String(
        item.path ||
        item.name ||
        ""
      ).replace(
        /\\/g,
        "/"
      );

    const normalizedPath =
      originalPath.toLowerCase();

    // ----------------------------------------------
    // Python files only
    // ----------------------------------------------

    if (
      !normalizedPath.endsWith(
        ".py"
      )
    ) {
      continue;
    }

    const content =
      getFileContent(item);

    if (!content) {
      continue;
    }

    // ==================================================
    // FASTAPI DETECTION
    // ==================================================

    const usesFastApi =
      /from\s+fastapi\s+import/i.test(
        content
      ) ||
      /import\s+fastapi/i.test(
        content
      ) ||
      /\bFastAPI\s*\(/i.test(
        content
      ) ||
      /\bAPIRouter\s*\(/i.test(
        content
      );

    if (!usesFastApi) {
      continue;
    }

    sourceFiles.push(
      originalPath
    );

    // ==================================================
    // ROUTER PREFIX
    // ==================================================

    const routerPrefix =
      extractRouterPrefix(
        content
      );

    // ==================================================
    // ROUTE DETECTION
    // ==================================================

    const routeRegex =
      /@(app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(["'])([^"']+)\3/gi;

    let match;

    while (
      (match =
        routeRegex.exec(
          content
        )) !== null
    ) {
      const routeObject =
        match[1].toLowerCase();

      const method =
        match[2].toUpperCase();

      const declaredPath =
        match[4];

      // ----------------------------------------------
      // Resolve final route
      // ----------------------------------------------

      const effectivePath =
        routeObject === "router"
          ? normalizeRoutePath(
              routerPrefix,
              declaredPath
            )
          : declaredPath;

      // ----------------------------------------------
      // Handler
      // ----------------------------------------------

      const handler =
        getFunctionAfterDecorator(
          content,
          routeRegex.lastIndex
        );

      // ----------------------------------------------
      // Store route
      // ----------------------------------------------

      routes.push({
        method,

        path:
          effectivePath,

        declaredPath,

        handler,

        routeObject,

        prefix:
          routeObject === "router"
            ? routerPrefix ||
              null
            : null,

        source:
          originalPath
      });
    }
  }

  // ==================================================
  // UNIQUE SOURCE FILES
  // ==================================================

  const uniqueSourceFiles = [
    ...new Set(
      sourceFiles
    )
  ];

  // ==================================================
  // RETURN
  // ==================================================

  return {
    detected:
      uniqueSourceFiles.length > 0,

    framework:
      uniqueSourceFiles.length > 0
        ? "FastAPI"
        : null,

    sourceFiles:
      uniqueSourceFiles,

    routes
  };
}


export { analyzeFastApi };
