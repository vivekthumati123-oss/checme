// ==================================================
// ARCHITECTCONNECT
// API -> COMPONENT RELATIONSHIP DISCOVERY
//
// Purpose:
//
// Connect dynamically discovered APIs to dynamically
// discovered request-handler components.
//
// Examples:
//
// GET /users
//     -> handled_by
// User Controller
//
// GET /users/
//     -> handled_by
// Users
//
// Evidence used:
//
// - application identity
// - API source
// - API handler
// - component source
// - component role
// - source import relationships
//
// Important:
//
// ArchitectConnect must not invent API -> component
// relationships when repository evidence is weak.
//
// ==================================================


// ==================================================
// NORMALIZE PATH
// ==================================================

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}


// ==================================================
// GET BASE NAME WITHOUT EXTENSION
// ==================================================

function getBaseName(filePath) {
  const normalized =
    String(filePath || "")
      .replace(/\\/g, "/");

  const fileName =
    normalized
      .split("/")
      .pop() || "";

  return fileName
    .replace(/\.[^.]+$/, "");
}


// ==================================================
// NORMALIZE IDENTIFIER
// ==================================================
//
// Examples:
//
// userController
// User Controller
// user_controller
//
// become:
//
// usercontroller
//
// ==================================================

function normalizeIdentifier(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}


// ==================================================
// SAME APPLICATION
// ==================================================

function belongsToApplication(
  item,
  application
) {
  if (
    !item ||
    !application
  ) {
    return false;
  }


  // ==================================================
  // APPLICATION ID
  // ==================================================

  if (
    item.applicationId &&
    application.id
  ) {
    return (
      item.applicationId ===
      application.id
    );
  }


  // ==================================================
  // APPLICATION ROOT
  // ==================================================

  const itemRoot =
    normalizePath(
      item.applicationRoot
    );

  const applicationRoot =
    normalizePath(
      application.root
    );


  if (
    itemRoot &&
    applicationRoot
  ) {
    return (
      itemRoot ===
      applicationRoot
    );
  }


  return true;
}


// ==================================================
// FIND REQUEST HANDLER BY SAME SOURCE
// ==================================================
//
// Strong evidence.
//
// FastAPI example:
//
// API:
//
// GET /users/
// source:
// app/routers/users.py
//
// Component:
//
// Users
// source:
// app/routers/users.py
// role:
// request_handler
//
// ==================================================

function findComponentBySource(
  api,
  components
) {
  if (!api) {
    return null;
  }


  const apiSource =
    normalizePath(
      api.source
    );


  if (!apiSource) {
    return null;
  }


  const matches =
    components.filter(
      (component) =>
        component &&
        component.role ===
          "request_handler" &&
        normalizePath(
          component.source
        ) ===
          apiSource
    );


  if (
    matches.length === 1
  ) {
    return matches[0];
  }


  return null;
}


// ==================================================
// FIND REQUEST HANDLER FROM HANDLER NAME
// ==================================================
//
// Express example:
//
// API handler:
//
// userController.getUsers
//
// Component:
//
// User Controller
//
// Component source:
//
// userController.js
//
// ==================================================

function findComponentByHandler(
  api,
  components
) {
  if (
    !api ||
    !api.handler ||
    !Array.isArray(components)
  ) {
    return null;
  }


  // ==================================================
  // HANDLER
  // ==================================================
  //
  // Examples:
  //
  // users.getUsers
  // userController.getUsers
  //
  // ==================================================

  const handler =
    String(
      api.handler
    ).trim();


  if (!handler) {
    return null;
  }


  // ==================================================
  // HANDLER OBJECT
  // ==================================================
  //
  // users.getUsers
  //
  // becomes:
  //
  // users
  //
  // userController.getUsers
  //
  // becomes:
  //
  // userController
  //
  // ==================================================

  const handlerObject =
    handler
      .split(".")[0]
      .trim();


  if (!handlerObject) {
    return null;
  }


  const normalizedHandlerObject =
    normalizeIdentifier(
      handlerObject
    );

  // ==================================================
  // FIND REQUEST HANDLER COMPONENT
  // ==================================================

  const matches =
    components.filter(
      (component) => {
        if (
          !component ||
          component.role !==
            "request_handler"
        ) {
          return false;
        }


        // ==============================================
        // COMPONENT DISPLAY NAME
        // ==============================================

        const normalizedComponentName =
          normalizeIdentifier(
            component.name
          );


        // ==============================================
        // COMPONENT FILE NAME
        // ==============================================

        const componentBaseName =
          getBaseName(
            component.source
          );


        const normalizedComponentBaseName =
          normalizeIdentifier(
            componentBaseName
          );


        // ==============================================
        // EXACT MATCH
        // ==============================================

        if (
          normalizedComponentName ===
            normalizedHandlerObject ||
          normalizedComponentBaseName ===
            normalizedHandlerObject
        ) {
          return true;
        }


        // ==============================================
        // CONTROLLER SUFFIX NORMALIZATION
        // ==============================================
        //
        // Handler:
        //
        // userController.getUsers
        //
        // Component:
        //
        // User Controller
        //
        // Also supports:
        //
        // users.getUsers
        //
        // Component:
        //
        // Users
        //
        // ==============================================

        const handlerWithoutController =
          normalizedHandlerObject.replace(
            /controller$/,
            ""
          );


        const componentWithoutController =
          normalizedComponentName.replace(
            /controller$/,
            ""
          );


        const fileWithoutController =
          normalizedComponentBaseName.replace(
            /controller$/,
            ""
          );


        return (
          handlerWithoutController &&
          (
            handlerWithoutController ===
              componentWithoutController ||
            handlerWithoutController ===
              fileWithoutController
          )
        );
      }
    );


  // ==================================================
  // ONLY ACCEPT UNAMBIGUOUS MATCH
  // ==================================================

  if (
    matches.length === 1
  ) {
    return matches[0];
  }


  return null;
}



// ==================================================
// FIND REQUEST HANDLER FROM IMPORT GRAPH
// ==================================================
//
// This is weaker evidence than direct handler matching.
//
// Example:
//
// server.js
//     -> imports
// userController.js
//
// Only use this fallback when an API already has an
// explicit named handler.
//
// ==================================================

function findComponentFromImports(
  api,
  components,
  sourceRelationships
) {
  if (!api) {
    return null;
  }


  const apiSource =
    normalizePath(
      api.source
    );


  if (!apiSource) {
    return null;
  }


  // ==================================================
  // IMPORTED FILES
  // ==================================================

  const importedTargets =
    sourceRelationships
      .filter(
        (relationship) =>
          relationship &&
          relationship.resolved ===
            true &&
          normalizePath(
            relationship.from
          ) ===
            apiSource &&
          relationship.to
      )
      .map(
        (relationship) =>
          normalizePath(
            relationship.to
          )
      );


  if (
    importedTargets.length === 0
  ) {
    return null;
  }


  // ==================================================
  // MATCH REQUEST HANDLER
  // ==================================================

  const matches =
    components.filter(
      (component) =>
        component &&
        component.role ===
          "request_handler" &&
        importedTargets.includes(
          normalizePath(
            component.source
          )
        )
    );


  if (
    matches.length === 1
  ) {
    return matches[0];
  }


  return null;
}


// ==================================================
// FIND HANDLER COMPONENT
// ==================================================
//
// Evidence priority:
//
// 1. Same source request-handler
// 2. Explicit Express handler
// 3. Express import graph fallback
// 4. Otherwise no relationship
//
// ==================================================

function findHandlerComponent(
  api,
  components,
  sourceRelationships
) {
  if (!api) {
    return null;
  }


  // ==================================================
  // 1. SAME-SOURCE REQUEST HANDLER
  // ==================================================
  //
  // Strongest generic evidence.
  //
  // FastAPI:
  //
  // @router.get("/")
  // def read_users():
  //
  // API source and request-handler component source
  // are the same file.
  //
  // ==================================================

  const sourceComponent =
    findComponentBySource(
      api,
      components
    );


  if (sourceComponent) {
    return {
      component:
        sourceComponent,

      confidence:
        0.98,

      evidence:
        "API and request-handler component share the same source file."
    };
  }


  // ==================================================
  // 2. EXPRESS EXPLICIT NAMED HANDLER
  // ==================================================
  //
  // Example:
  //
  // app.get(
  //   "/users",
  //   userController.getUsers
  // )
  //
  // ==================================================

  if (
    api.framework === "Express" &&
    api.handler
  ) {

    const handlerComponent =
      findComponentByHandler(
        api,
        components
      );


    if (handlerComponent) {
      return {
        component:
          handlerComponent,

        confidence:
          0.98,

        evidence:
          `API handler "${api.handler}" matches the discovered request-handler component.`
      };
    }


    // ==================================================
    // 3. EXPRESS IMPORT GRAPH FALLBACK
    // ==================================================
    //
    // An explicit Express handler exists, but direct
    // identifier matching failed.
    //
    // In that case, use the source import graph as
    // secondary supporting evidence.
    //
    // ==================================================

    const importedComponent =
      findComponentFromImports(
        api,
        components,
        sourceRelationships
      );


    if (importedComponent) {
      return {
        component:
          importedComponent,

        confidence:
          0.9,

        evidence:
          "Named Express API handler is associated with a request-handler component imported by the API source."
      };
    }
  }


  // ==================================================
  // FASTAPI ENTRYPOINT ROUTES
  // ==================================================
  //
  // Example:
  //
  // @app.get("/")
  // def root():
  //
  // @app.get("/health")
  // def health():
  //
  // main.py may import a router, but that does NOT mean
  // the imported router handles these entrypoint APIs.
  //
  // If there was no same-source request_handler above,
  // do not create a handled_by relationship.
  //
  // ==================================================

  if (
    api.framework === "FastAPI"
  ) {
    return null;
  }


  // ==================================================
  // NO SUFFICIENT EVIDENCE
  // ==================================================

  return null;
}


// ==================================================
// REMOVE DUPLICATES
// ==================================================

function removeDuplicates(
  relationships
) {
  const result = [];

  const seen =
    new Set();


  for (
    const relationship of
    relationships
  ) {

    if (!relationship) {
      continue;
    }


    const key =
      [
        relationship.applicationId,
        relationship.from,
        relationship.to,
        relationship.relationship
      ].join("|");


    if (
      seen.has(key)
    ) {
      continue;
    }


    seen.add(key);


    result.push(
      relationship
    );
  }


  return result;
}


// ==================================================
// MAIN DISCOVERY
// ==================================================

function discoverApiComponentRelationships({
  application = null,
  apis = [],
  components = [],
  relationships = []
} = {}) {

  // ==================================================
  // SAFETY
  // ==================================================

  if (
    !application ||
    !Array.isArray(apis) ||
    !Array.isArray(components) ||
    !Array.isArray(relationships)
  ) {
    return [];
  }


  // ==================================================
  // APPLICATION APIS
  // ==================================================

  const applicationApis =
    apis.filter(
      (api) =>
        belongsToApplication(
          api,
          application
        )
    );


  // ==================================================
  // APPLICATION COMPONENTS
  // ==================================================

  const applicationComponents =
    components.filter(
      (component) =>
        belongsToApplication(
          component,
          application
        )
    );


  // ==================================================
  // APPLICATION SOURCE RELATIONSHIPS
  // ==================================================

  const applicationRelationships =
    relationships.filter(
      (relationship) =>
        belongsToApplication(
          relationship,
          application
        )
    );


  // ==================================================
  // DISCOVER API -> COMPONENT LINKS
  // ==================================================

  const discovered = [];


  for (
    const api of
    applicationApis
  ) {

    if (!api) {
      continue;
    }


    const match =
      findHandlerComponent(
        api,
        applicationComponents,
        applicationRelationships
      );


    // ==================================================
    // NO RELIABLE COMPONENT MATCH
    // ==================================================
    //
    // Do not manufacture architectural relationships
    // when repository evidence is insufficient.
    //
    // ==================================================

    if (
      !match ||
      !match.component
    ) {
      continue;
    }


    const component =
      match.component;


    // ==================================================
    // CREATE API DEPENDENCY
    // ==================================================

    discovered.push({
      from:
        `${api.method} ${api.path}`,

      to:
        component.name,

      fromType:
        "api",

      toType:
        component.role,

      applicationId:
        application.id ||
        null,

      applicationRoot:
        application.root ||
        null,

      applicationType:
        application.type ||
        null,

      framework:
        application.framework ||
        null,

      runtime:
        application.runtime ||
        null,

      type:
        "api_dependency",

      relationship:
        "handled_by",

      confidence:
        match.confidence,

      evidence:
        match.evidence,

      apiSource:
        api.source ||
        null,

      componentSource:
        component.source ||
        null,

      handler:
        api.handler ||
        null
    });
  }


  // ==================================================
  // RETURN UNIQUE RELATIONSHIPS
  // ==================================================

  return removeDuplicates(
    discovered
  );
}


// ==================================================
// EXPORT
// ==================================================

export { discoverApiComponentRelationships };
