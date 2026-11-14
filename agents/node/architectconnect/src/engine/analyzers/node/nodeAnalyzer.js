import { analyzeExpress as analyzeExpress } from "./expressAnalyzer.js";import { analyzeNodeComponents as analyzeNodeComponents } from "./componentAnalyzer.js";import { analyzeNodeDependencies as analyzeNodeDependencies } from "./dependencyAnalyzer.js";


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
// HANDLER -> COMPONENT NAME
// ==================================================

function handlerToComponentName(
  handler
) {
  if (
    typeof handler !==
      "string" ||
    !handler
  ) {
    return null;
  }

  const objectName =
    handler.split(".")[0];

  if (!objectName) {
    return null;
  }

  return objectName
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
// MAIN ANALYZER
// ==================================================
function analyzeNode(
contents,
application = null
)  {   const applicationRoot =
    application &&
    application.root
      ? application.root
      : null;
  if (
    !Array.isArray(contents)
  ) {
    contents = [];
  }


  // ==================================================
  // NODE SOURCE FILES
  // ==================================================

  const nodeFiles =
    contents.filter(
      (item) => {
        const path =
          normalizePath(
            item.path ||
            item.name ||
            ""
          ).toLowerCase();

        return (
          path.endsWith(".js") ||
          path.endsWith(".jsx") ||
          path.endsWith(".mjs") ||
          path.endsWith(".cjs") ||
          path.endsWith(".ts") ||
          path.endsWith(".tsx")
        );
      }
    );


  // ==================================================
  // PACKAGE FILES
  // ==================================================

  const packageFiles =
    contents.filter(
      (item) => {
        const path =
          normalizePath(
            item.path ||
            item.name ||
            ""
          ).toLowerCase();

        return path.endsWith(
          "package.json"
        );
      }
    );


  // ==================================================
  // EXPRESS ANALYSIS
  // ==================================================

  const express =
    analyzeExpress(
      contents
    );


  // ==================================================
  // COMPONENT ANALYSIS
  // ==================================================

  const components =
  analyzeNodeComponents(
    contents,
    applicationRoot
  );


  // ==================================================
  // NODE DETECTION
  // ==================================================

  const backendNodeFiles =
    nodeFiles.filter(
      (item) =>
        containsPathSegment(
          item.path ||
          item.name,
          "backend"
        )
    );

  const detected =
    express.detected ||
    backendNodeFiles.length >
      0;


  // ==================================================
  // CODE DEPENDENCIES
  // ==================================================

  const codeDependencies =
  analyzeNodeDependencies(
    contents,
    applicationRoot
  );


  // ==================================================
  // API -> CONTROLLER
  // ==================================================

  const routeDependencies =
    [];

  if (
    Array.isArray(
      express.routes
    )
  ) {
    for (
      const route of
      express.routes
    ) {
      if (
        !route.handler
      ) {
        continue;
      }

      const controllerName =
        handlerToComponentName(
          route.handler
        );

      if (
        !controllerName
      ) {
        continue;
      }

      const controllerExists =
        components.some(
          (component) =>
            component &&
            component.type ===
              "controller" &&
            component.name ===
              controllerName
        );

      if (
        !controllerExists
      ) {
        continue;
      }

      routeDependencies.push({
        from:
          `${route.method} ${route.path}`,

        to:
          controllerName,

        fromType:
          "api",

        toType:
          "controller",

        application:
          "Backend API",

        type:
          "api_dependency",

        relationship:
          "handled_by",

        evidence:
          route.handler,

        source:
          route.source
      });
    }
  }


  // ==================================================
  // COMBINE DEPENDENCIES
  // ==================================================

  const allDependencies = [
    ...routeDependencies,
    ...(
      Array.isArray(
        codeDependencies
      )
        ? codeDependencies
        : []
    )
  ];


  // ==================================================
  // SOURCE FILES
  // ==================================================

  const backendSourceFiles =
    Array.isArray(
      express.sourceFiles
    ) &&
    express.sourceFiles.length >
      0
      ? express.sourceFiles
      : backendNodeFiles.map(
          (item) =>
            item.path ||
            item.name
        );


  // ==================================================
  // RETURN
  // ==================================================

  return {
    detected,

    application:
      detected
        ? "Backend API"
        : null,

    language:
      detected
        ? "JavaScript"
        : null,

    runtime:
      detected
        ? "Node.js"
        : null,

    framework:
      express.detected
        ? "Express"
        : null,

    sourceFiles:
      backendSourceFiles,

    packageFiles:
      packageFiles.map(
        (item) =>
          item.path ||
          item.name
      ),

    routes:
      Array.isArray(
        express.routes
      )
        ? express.routes
        : [],

    components:
      Array.isArray(
        components
      )
        ? components
        : [],

    dependencies:
      allDependencies
  };
}


export { analyzeNode };
