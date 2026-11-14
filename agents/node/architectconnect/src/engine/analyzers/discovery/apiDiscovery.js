// ==================================================
// ARCHITECTCONNECT DYNAMIC API DISCOVERY
//
// Purpose:
//
// Discover APIs from dynamically discovered
// applications without depending on repository
// directory names.
//
// Initial supported frameworks:
//
// Express
// FastAPI
//
// ==================================================


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
// NORMALIZE PATH
// ==================================================

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}


// ==================================================
// JAVASCRIPT FILE CHECK
// ==================================================

function isJavaScriptFile(filePath) {
  const normalized =
    normalizePath(
      filePath
    ).toLowerCase();

  return (
    normalized.endsWith(".js") ||
    normalized.endsWith(".jsx") ||
    normalized.endsWith(".mjs") ||
    normalized.endsWith(".cjs") ||
    normalized.endsWith(".ts") ||
    normalized.endsWith(".tsx")
  );
}


// ==================================================
// PYTHON FILE CHECK
// ==================================================

function isPythonFile(filePath) {
  return normalizePath(
    filePath
  )
    .toLowerCase()
    .endsWith(".py");
}


// ==================================================
// HTTP METHOD
// ==================================================

function normalizeHttpMethod(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}


// ==================================================
// EXPRESS ROUTE DISCOVERY
// ==================================================
//
// Supports:
//
// app.get("/users", users.getUsers)
//
// app.get("/health", (req, res) => ...)
//
// router.post("/users", handler)
//
// ==================================================

function discoverExpressApis(
  application,
  files
) {
  const apis = [];

  if (!Array.isArray(files)) {
    return apis;
  }

  for (const item of files) {
    if (!item) {
      continue;
    }

    const sourcePath =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );

    if (
      !sourcePath ||
      !isJavaScriptFile(
        sourcePath
      )
    ) {
      continue;
    }

    const content =
      getFileContent(
        item
      );

    if (!content) {
      continue;
    }


    // ==================================================
    // EXPRESS ROUTE REGEX
    // ==================================================
    //
    // Groups:
    //
    // 1 -> app / router
    // 2 -> HTTP method
    // 3 -> quote character
    // 4 -> route path
    //
    // ==================================================

    const routeRegex =
      /\b(app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(["'])(.*?)\3\s*,/gi;

    let match;

    while (
      (
        match =
          routeRegex.exec(
            content
          )
      ) !== null
    ) {
      const routeObject =
        match[1];

      const method =
        normalizeHttpMethod(
          match[2]
        );

      const routePath =
        match[4] || "/";


      // ==================================================
      // HANDLER DISCOVERY
      // ==================================================
      //
      // The regex stops immediately after:
      //
      // app.get("/users",
      //
      // so inspect the remaining source for a named
      // handler.
      //
      // ==================================================

      const remainingSource =
        content.slice(
          routeRegex.lastIndex
        );

      const handlerMatch =
        remainingSource.match(
          /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)/
        );

      const handler =
        handlerMatch &&
        handlerMatch[1]
          ? handlerMatch[1]
          : null;


      // ==================================================
      // ADD API
      // ==================================================

      apis.push({
        applicationId:
          application &&
          application.id
            ? application.id
            : null,

        applicationRoot:
          application &&
          application.root
            ? application.root
            : null,

        applicationType:
          application &&
          application.type
            ? application.type
            : null,

        framework:
          "Express",

        runtime:
          "Node.js",

        method,

        path:
          routePath,

        handler,

        routeObject,

        source:
          sourcePath,

        confidence:
          0.95,

        evidence:
          match[0]
            .replace(
              /\s+/g,
              " "
            )
            .trim()
      });
    }
  }

  return apis;
}


// ==================================================
// FASTAPI ROUTER PREFIX DISCOVERY
// ==================================================
//
// Supports:
//
// router = APIRouter(prefix="/risk")
//
// router = APIRouter(
//   prefix="/users"
// )
//
// ==================================================

function discoverFastApiRouterPrefix(
  content
) {
  if (
    typeof content !== "string"
  ) {
    return null;
  }


  // ==================================================
  // DOUBLE QUOTES
  // ==================================================

  const doubleQuoteMatch =
    content.match(
      /APIRouter\s*\([\s\S]*?prefix\s*=\s*"([^"]+)"/
    );

  if (
    doubleQuoteMatch &&
    doubleQuoteMatch[1]
  ) {
    return doubleQuoteMatch[1];
  }


  // ==================================================
  // SINGLE QUOTES
  // ==================================================

  const singleQuoteMatch =
    content.match(
      /APIRouter\s*\([\s\S]*?prefix\s*=\s*'([^']+)'/
    );

  if (
    singleQuoteMatch &&
    singleQuoteMatch[1]
  ) {
    return singleQuoteMatch[1];
  }


  return null;
}

// ==================================================
// FASTAPI MOUNTED ROUTER PREFIX DISCOVERY
// ==================================================
//
// Supports:
//
// from app.endpoints.risk import router as risk_router
//
// app.include_router(
//   risk_router,
//   prefix="/risk"
// )
//
// and:
//
// app.include_router(risk_router, prefix="/risk")
//
// Returns a map:
//
// source file -> mounted prefix
//
// Example:
//
// engines/risk-engine/app/endpoints/risk.py
// ->
// /risk
//
// ==================================================

function discoverFastApiMountedRouterPrefixes(
  files
) {
  const prefixesBySource =
    new Map();

  if (!Array.isArray(files)) {
    return prefixesBySource;
  }


  // ==================================================
  // BUILD NORMALIZED PYTHON FILE LOOKUP
  // ==================================================

  const pythonFiles =
    files.filter(
      (item) => {
        if (!item) {
          return false;
        }

        const filePath =
          normalizePath(
            item.path ||
            item.name ||
            ""
          );

        return (
          filePath &&
          isPythonFile(
            filePath
          )
        );
      }
    );


  // ==================================================
  // INSPECT FILES FOR IMPORT + INCLUDE_ROUTER
  // ==================================================

  for (
    const item of pythonFiles
  ) {
    const content =
      getFileContent(
        item
      );

    if (!content) {
      continue;
    }


    // ==================================================
    // IMPORTED ROUTER ALIASES
    // ==================================================
    //
    // Example:
    //
    // from app.endpoints.risk import router as risk_router
    //
    // alias:
    // risk_router
    //
    // module:
    // app.endpoints.risk
    //
    // ==================================================

    const importedRouters =
      new Map();


    const importRegex =
      /from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import\s+router(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/g;


    let importMatch;


    while (
      (
        importMatch =
          importRegex.exec(
            content
          )
      ) !== null
    ) {
      const moduleName =
        importMatch[1];

      const alias =
        importMatch[2] ||
        "router";


      importedRouters.set(
        alias,
        moduleName
      );
    }


    if (
      importedRouters.size === 0
    ) {
      continue;
    }


    // ==================================================
    // INCLUDE_ROUTER CALLS
    // ==================================================
    //
    // Supports both single-line and multiline calls.
    //
    // ==================================================

    const includeRouterRegex =
      /include_router\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,[\s\S]*?prefix\s*=\s*(["'])(.*?)\2[\s\S]*?\)/g;


    let includeMatch;


    while (
      (
        includeMatch =
          includeRouterRegex.exec(
            content
          )
      ) !== null
    ) {
      const routerAlias =
        includeMatch[1];

      const prefix =
        includeMatch[3] ||
        null;


      if (!prefix) {
        continue;
      }


      const moduleName =
        importedRouters.get(
          routerAlias
        );


      if (!moduleName) {
        continue;
      }


      // ==================================================
      // RESOLVE MODULE TO SOURCE FILE
      // ==================================================
      //
      // app.endpoints.risk
      //
      // becomes:
      //
      // app/endpoints/risk.py
      //
      // ==================================================

      const moduleSuffix =
        `${moduleName.replace(
          /\./g,
          "/"
        )}.py`;


      const matchingFile =
        pythonFiles.find(
          (candidate) => {
            const candidatePath =
              normalizePath(
                candidate.path ||
                candidate.name ||
                ""
              );

            return (
              candidatePath ===
                moduleSuffix ||
              candidatePath.endsWith(
                `/${moduleSuffix}`
              )
            );
          }
        );


      if (!matchingFile) {
        continue;
      }


      const sourcePath =
        normalizePath(
          matchingFile.path ||
          matchingFile.name ||
          ""
        );


      prefixesBySource.set(
        sourcePath,
        prefix
      );
    }
  }


  return prefixesBySource;
}

// ==================================================
// JOIN API PATHS
// ==================================================

function joinApiPaths(
  prefix,
  routePath
) {
  const normalizedPrefix =
    String(
      prefix || ""
    )
      .trim()
      .replace(
        /\/+$/g,
        ""
      );

  const normalizedRoute =
    String(
      routePath || ""
    )
      .trim();


  if (!normalizedPrefix) {
    return (
      normalizedRoute ||
      "/"
    );
  }


  if (
    !normalizedRoute ||
    normalizedRoute === "/"
  ) {
    return (
      `${normalizedPrefix}/`
    );
  }


  if (
    normalizedRoute.startsWith("/")
  ) {
    return (
      normalizedPrefix +
      normalizedRoute
    );
  }


  return (
    normalizedPrefix +
    "/" +
    normalizedRoute
  );
}


// ==================================================
// FASTAPI HANDLER DISCOVERY
// ==================================================
//
// Example:
//
// @router.get("/")
// def get_risk():
//
// Returns:
//
// get_risk
//
// ==================================================

function findPythonHandler(
  content,
  startIndex
) {
  if (
    typeof content !== "string"
  ) {
    return null;
  }

  const remainder =
    content.slice(
      startIndex
    );

  const handlerMatch =
    remainder.match(
      /\b(?:async\s+def|def)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/
    );

  if (
    handlerMatch &&
    handlerMatch[1]
  ) {
    return handlerMatch[1];
  }

  return null;
}


// ==================================================
// FASTAPI ROUTE DISCOVERY
// ==================================================
//
// Supports:
//
// @app.get("/")
//
// @app.get("/health")
//
// @router.get("/")
//
// @router.post("/users")
//
// ==================================================

function discoverFastApiApis(
  application,
  files
) {
  const apis = [];

  if (!Array.isArray(files)) {
    return apis;
  }
  // ==================================================
  // MOUNTED ROUTER PREFIXES
  // ==================================================

  const mountedRouterPrefixes =
    discoverFastApiMountedRouterPrefixes(
      files
    );
  for (const item of files) {
    if (!item) {
      continue;
    }

    const sourcePath =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );

    if (
      !sourcePath ||
      !isPythonFile(
        sourcePath
      )
    ) {
      continue;
    }

    const content =
      getFileContent(
        item
      );

    if (!content) {
      continue;
    }


    // ==================================================
    // ROUTER PREFIX
    // ==================================================

    const routerPrefix =
      discoverFastApiRouterPrefix(
        content
      );


    // ==================================================
    // FASTAPI DECORATOR REGEX
    // ==================================================
    //
    // Groups:
    //
    // 1 -> app / router
    // 2 -> HTTP method
    // 3 -> quote
    // 4 -> declared route path
    //
    // ==================================================

    const decoratorRegex =
      /@(app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(["'])(.*?)\3[^)]*\)/gi;

    let match;

    while (
      (
        match =
          decoratorRegex.exec(
            content
          )
      ) !== null
    ) {
      const routeObject =
        match[1];

      const method =
        normalizeHttpMethod(
          match[2]
        );

      const declaredPath =
        match[4] || "/";


      // ==================================================
      // ROUTER PREFIX
      // ==================================================

      const mountedPrefix =
  mountedRouterPrefixes.get(
    sourcePath
  ) ||
  null;


const prefix =
  routeObject === "router"
    ? (
        routerPrefix ||
        mountedPrefix
      )
    : null;


      // ==================================================
      // COMPLETE ROUTE
      // ==================================================

      const routePath =
        joinApiPaths(
          prefix,
          declaredPath
        );


      // ==================================================
      // HANDLER
      // ==================================================

      const handler =
        findPythonHandler(
          content,
          decoratorRegex.lastIndex
        );


      // ==================================================
      // ADD API
      // ==================================================

      apis.push({
        applicationId:
          application &&
          application.id
            ? application.id
            : null,

        applicationRoot:
          application &&
          application.root
            ? application.root
            : null,

        applicationType:
          application &&
          application.type
            ? application.type
            : null,

        framework:
          "FastAPI",

        runtime:
          "Python",

        method,

        path:
          routePath,

        declaredPath,

        prefix,

        handler,

        routeObject,

        source:
          sourcePath,

        confidence:
          0.95,

        evidence:
          match[0]
            .replace(
              /\s+/g,
              " "
            )
            .trim()
      });
    }
  }

  return apis;
}


// ==================================================
// REMOVE DUPLICATE APIS
// ==================================================

function removeDuplicateApis(
  apis
) {
  const uniqueApis = [];

  const seen =
    new Set();


  for (
    const api of apis
  ) {
    if (!api) {
      continue;
    }

    const key =
      [
        api.applicationId,
        api.method,
        api.path,
        api.source
      ].join("|");


    if (
      seen.has(key)
    ) {
      continue;
    }


    seen.add(key);


    uniqueApis.push(
      api
    );
  }


  return uniqueApis;
}


// ==================================================
// MAIN API DISCOVERY
// ==================================================

function discoverApis({
  application = null,
  files = []
} = {}) {
  if (
    !application ||
    !Array.isArray(files)
  ) {
    return [];
  }


  let apis = [];


  // ==================================================
  // EXPRESS
  // ==================================================

  if (
    application.framework ===
    "Express"
  ) {
    apis =
      discoverExpressApis(
        application,
        files
      );
  }


  // ==================================================
  // FASTAPI
  // ==================================================

  if (
    application.framework ===
    "FastAPI"
  ) {
    apis =
      discoverFastApiApis(
        application,
        files
      );
  }


  // ==================================================
  // RETURN UNIQUE APIS
  // ==================================================

  return removeDuplicateApis(
    apis
  );
}


// ==================================================
// EXPORT
// ==================================================

export { discoverApis };
