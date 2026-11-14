function analyzeExpress(contents) {
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
      ).replace(/\\/g, "/");

    const path =
      originalPath.toLowerCase();

    const isSourceFile =
      path.endsWith(".js") ||
      path.endsWith(".jsx") ||
      path.endsWith(".mjs") ||
      path.endsWith(".cjs") ||
      path.endsWith(".ts") ||
      path.endsWith(".tsx");

    if (!isSourceFile) {
      continue;
    }

    const content =
      typeof item.content === "string"
        ? item.content
        : typeof item.text === "string"
          ? item.text
          : "";

    if (!content) {
      continue;
    }

    // ==================================================
    // EXPRESS DETECTION
    // ==================================================

    const usesExpress =
      /require\s*\(\s*["']express["']\s*\)/i.test(
        content
      ) ||
      /import\s+.*\s+from\s+["']express["']/i.test(
        content
      ) ||
      /\bexpress\s*\(\s*\)/i.test(
        content
      ) ||
      /\bexpress\.Router\s*\(\s*\)/i.test(
        content
      );

    if (!usesExpress) {
      continue;
    }

    sourceFiles.push(
      originalPath
    );

    // ==================================================
    // EXPRESS ROUTE DETECTION
    // ==================================================

    const routeRegex =
      /\b(app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(["'`])([^"'`]+)\3\s*,/gi;

    let match;

    while (
      (match =
        routeRegex.exec(
          content
        )) !== null
    ) {
      const routeObject =
        match[1];

      const method =
        match[2].toUpperCase();

      const routePath =
        match[4];

      let handler = null;

      // ==================================================
      // FIND CURRENT ROUTE DECLARATION ONLY
      // ==================================================
      //
      // We start immediately after:
      //
      // app.get("/users",
      //
      // Then find the end of THIS route.
      //
      // The next route should never be inspected.
      //
      // ==================================================

      const remainingContent =
        content.slice(
          routeRegex.lastIndex
        );

      // Find the next Express route so we can bound
      // the current route section.
      const nextRouteRegex =
        /\b(?:app|router)\s*\.\s*(?:get|post|put|patch|delete|options|head)\s*\(/i;

      const nextRouteMatch =
        nextRouteRegex.exec(
          remainingContent
        );

      let currentRouteSection;

      if (
        nextRouteMatch &&
        typeof nextRouteMatch.index ===
          "number"
      ) {
        currentRouteSection =
          remainingContent.slice(
            0,
            nextRouteMatch.index
          );
      } else {
        currentRouteSection =
          remainingContent;
      }

      // Limit pathological files.
      currentRouteSection =
        currentRouteSection.slice(
          0,
          1000
        );

      // ==================================================
      // CONTROLLER HANDLER DETECTION
      // ==================================================

      const controllerHandlerRegex =
        /\b([A-Za-z_$][\w$]*Controller)\s*\.\s*([A-Za-z_$][\w$]*)/;

      const controllerMatch =
        controllerHandlerRegex.exec(
          currentRouteSection
        );

      if (controllerMatch) {
        handler =
          `${controllerMatch[1]}.${controllerMatch[2]}`;
      }

      // ==================================================
      // ADD ROUTE
      // ==================================================

      routes.push({
        method,

        path:
          routePath,

        handler,

        routeObject,

        source:
          originalPath
      });
    }
  }

  // ==================================================
  // RETURN
  // ==================================================

  return {
    detected:
      sourceFiles.length > 0,

    framework:
      sourceFiles.length > 0
        ? "Express"
        : null,

    sourceFiles,

    routes
  };
}

export { analyzeExpress };
