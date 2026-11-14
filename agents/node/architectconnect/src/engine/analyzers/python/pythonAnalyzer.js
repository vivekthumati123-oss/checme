import { analyzeFastApi as analyzeFastApi } from "./fastApiAnalyzer.js";import { analyzePythonComponents as analyzePythonComponents } from "./componentAnalyzer.js";import { analyzePythonDependencies as analyzePythonDependencies } from "./dependencyAnalyzer.js";

// ==================================================
// PYTHON APPLICATION ANALYZER
//
// FR-AC-003
// - FastAPI application detection
// - API route detection
//
// FR-AC-004
// - Router detection
// - Service detection
// - Repository detection
//
// FR-AC-005
// - API -> Router
// - Router -> Service
// - Service -> Repository
// ==================================================

function analyzePythonApplication(
contents,
application = null
) {   const applicationRoot =
    application &&
    application.root
      ? application.root
      : null;
  // ==================================================
  // SAFETY
  // ==================================================

  if (!Array.isArray(contents)) {
    contents = [];
  }

  // ==================================================
  // FIND PYTHON SOURCE FILES
  // ==================================================

  const pythonFiles =
    contents.filter((item) => {
      const path =
        String(
          item.path ||
          item.name ||
          ""
        )
          .replace(/\\/g, "/")
          .toLowerCase();

      return path.endsWith(".py");
    });

  // ==================================================
  // FIND PYTHON DEPENDENCY / PROJECT FILES
  // ==================================================

  const dependencyFiles =
    contents.filter((item) => {
      const path =
        String(
          item.path ||
          item.name ||
          ""
        )
          .replace(/\\/g, "/")
          .toLowerCase();

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
          "pipfile.lock"
        ) ||
        path.endsWith(
          "poetry.lock"
        ) ||
        path.endsWith(
          "uv.lock"
        ) ||
        path.endsWith(
          "setup.py"
        ) ||
        path.endsWith(
          "setup.cfg"
        )
      );
    });

  // ==================================================
  // PYTHON DETECTION
  // ==================================================

  const detected =
    pythonFiles.length > 0 ||
    dependencyFiles.length > 0;

  // ==================================================
  // FASTAPI ANALYSIS
  // FR-AC-003
  // ==================================================

  const fastApi =
    analyzeFastApi(
      contents
    );

  // ==================================================
  // COMPONENT ANALYSIS
  // FR-AC-004
  // ==================================================
  //
  // Detects:
  //
  // routers/
  // services/
  // repositories/
  //
  // ==================================================

  const components =
  analyzePythonComponents(
    contents,
    applicationRoot
  );

  // ==================================================
  // CODE DEPENDENCY ANALYSIS
  // FR-AC-005
  // ==================================================
  //
  // Expected:
  //
  // Users Router
  //      |
  //      | uses
  //      v
  // User Service
  //
  // User Service
  //      |
  //      | uses
  //      v
  // User Repository
  //
  // ==================================================

  const codeDependencies =
analyzePythonDependencies(
contents,
applicationRoot
);

  // ==================================================
  // API -> ROUTER DEPENDENCIES
  // FR-AC-005
  // ==================================================
  //
  // Expected:
  //
  // GET /users/
  //      |
  //      | handled_by
  //      v
  // Users Router
  //
  // ==================================================

  const routeDependencies = [];

  if (
    Array.isArray(
      fastApi.routes
    )
  ) {
    for (
      const route of
      fastApi.routes
    ) {
      // ----------------------------------------------
      // Only APIRouter routes should map to Router
      // components.
      //
      // Normal routes:
      //
      // @app.get("/")
      // @app.get("/health")
      //
      // do not map to Users Router.
      // ----------------------------------------------

      if (
        route.routeObject !==
        "router"
      ) {
        continue;
      }

      // ----------------------------------------------
      // Match route to router component using the
      // actual repository source path.
      //
      // Route:
      //
      // packages/python-api/app/routers/users.py
      //
      // Component:
      //
      // packages/python-api/app/routers/users.py
      //
      // ----------------------------------------------

      const routerComponent =
        components.find(
          (component) =>
            component &&
            component.type ===
              "router" &&
            component.source ===
              route.source
        );

      if (!routerComponent) {
        continue;
      }

      // ----------------------------------------------
      // Create the API -> Router dependency
      // ----------------------------------------------

      routeDependencies.push({
        from:
          `${route.method} ${route.path}`,

        to:
          routerComponent.name,

        fromType:
          "api",

        toType:
          "router",

        application:
          "Python API",

        type:
          "api_dependency",

        relationship:
          "handled_by",

        evidence:
          route.handler
            ? route.handler
            : (
                `@router.${route.method.toLowerCase()}` +
                `("${route.declaredPath}")`
              ),

        source:
          route.source
      });
    }
  }

  // ==================================================
  // COMBINE ALL DEPENDENCIES
  // FR-AC-005
  // ==================================================
  //
  // Final expected architecture:
  //
  // GET /users/
  //      |
  //      | handled_by
  //      v
  // Users Router
  //      |
  //      | uses
  //      v
  // User Service
  //      |
  //      | uses
  //      v
  // User Repository
  //
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
  // SOURCE FILE LIST
  // ==================================================

  const sourceFiles =
    pythonFiles.map(
      (file) =>
        file.path ||
        file.name
    );

  // ==================================================
  // DEPENDENCY FILE LIST
  // ==================================================

  const dependencyFilePaths =
    dependencyFiles.map(
      (file) =>
        file.path ||
        file.name
    );

  // ==================================================
  // RETURN PYTHON APPLICATION ANALYSIS
  // ==================================================

  return {
    detected,

    application:
      detected
        ? "Python API"
        : null,

    language:
      detected
        ? "Python"
        : null,

    runtime:
      detected
        ? "Python"
        : null,

    framework:
      fastApi &&
      fastApi.detected
        ? "FastAPI"
        : null,

    // ================================================
    // SOURCE FILES
    // ================================================

    sourceFiles,

    // ================================================
    // PYTHON PROJECT / DEPENDENCY FILES
    // ================================================

    dependencyFiles:
      dependencyFilePaths,

    // ================================================
    // API ROUTES
    // FR-AC-003
    // ================================================

    routes:
      fastApi &&
      Array.isArray(
        fastApi.routes
      )
        ? fastApi.routes
        : [],

    // ================================================
    // APPLICATION COMPONENTS
    // FR-AC-004
    // ================================================

    components:
      Array.isArray(
        components
      )
        ? components
        : [],

    // ================================================
    // APPLICATION DEPENDENCIES
    // FR-AC-005
    // ================================================

    dependencies:
      allDependencies
  };
}

export { analyzePythonApplication };
