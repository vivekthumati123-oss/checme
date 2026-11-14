// ==================================================
// ARCHITECTCONNECT
// DYNAMIC ARCHITECTURE PROJECTION
//
// Converts the rich discovery graph into a clean,
// user-facing architecture model.
//
// Raw source relationship:
//
// userController.js
//   -> imports
// userService.js
//
// Projected architecture relationship:
//
// User Controller
//   -> uses
// User Service
//
// Entrypoint wiring is excluded when a stronger
// architecture relationship exists.
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
// BUILD COMPONENT SOURCE INDEX
// ==================================================

function buildComponentIndex(
  components
) {
  const index =
    new Map();

  if (
    !Array.isArray(components)
  ) {
    return index;
  }

  for (
    const component of components
  ) {
    if (
      !component ||
      !component.source
    ) {
      continue;
    }

    const source =
      normalizePath(
        component.source
      );

    if (!source) {
      continue;
    }

    index.set(
      source,
      component
    );
  }

  return index;
}


// ==================================================
// PROJECT APPLICATIONS
// ==================================================

function projectApplications(
  applications
) {
  if (
    !Array.isArray(applications)
  ) {
    return [];
  }

  return applications.map(
    (application) => ({
      id:
        application.id ||
        null,

      root:
        application.root ||
        null,

      type:
        application.type ||
        null,

      language:
        application.language ||
        null,

      runtime:
        application.runtime ||
        null,

      framework:
        application.framework ||
        null,

      confidence:
        application.confidence ||
        null,

      evidence:
        Array.isArray(
          application.evidence
        )
          ? application.evidence
          : []
    })
  );
}


// ==================================================
// PROJECT APIS
// ==================================================

function projectApis(
  apis
) {
  if (
    !Array.isArray(apis)
  ) {
    return [];
  }

  return apis.map(
    (api) => ({
      applicationId:
        api.applicationId ||
        null,

      applicationRoot:
        api.applicationRoot ||
        null,

      framework:
        api.framework ||
        null,

      runtime:
        api.runtime ||
        null,

      method:
        api.method ||
        null,

      path:
        api.path ||
        null,

      handler:
        api.handler ||
        null,

      source:
        api.source ||
        null,

      confidence:
        api.confidence ||
        null,

      evidence:
        api.evidence ||
        null
    })
  );
}


// ==================================================
// PROJECT COMPONENTS
// ==================================================

function projectComponents(
  components
) {
  if (
    !Array.isArray(components)
  ) {
    return [];
  }

  return components.map(
    (component) => ({
      name:
        component.name ||
        null,

      type:
        component.role ||
        "internal_component",

      applicationId:
        component.applicationId ||
        null,

      applicationRoot:
        component.applicationRoot ||
        null,

      framework:
        component.framework ||
        null,

      runtime:
        component.runtime ||
        null,

      language:
        component.language ||
        null,

      source:
        component.source ||
        null,

      confidence:
        component.confidence ||
        null,

      evidence:
        Array.isArray(
          component.evidence
        )
          ? component.evidence
          : []
    })
  );
}


// ==================================================
// PROJECT SOURCE IMPORT RELATIONSHIP
// ==================================================

function projectSourceRelationship(
  relationship,
  componentIndex
) {
  if (
    !relationship ||
    relationship.type !==
      "source_import" ||
    !relationship.from ||
    !relationship.to
  ) {
    return null;
  }

  const sourceComponent =
    componentIndex.get(
      normalizePath(
        relationship.from
      )
    );

  const targetComponent =
    componentIndex.get(
      normalizePath(
        relationship.to
      )
    );

  if (
    !sourceComponent ||
    !targetComponent
  ) {
    return null;
  }


  // ==================================================
  // EXCLUDE ENTRYPOINT WIRING
  // ==================================================
  //
  // Examples:
  //
  // Server -> User Controller
  // Main -> Users
  //
  // These are useful source-level facts but are not
  // projected as business architecture relationships.
  //
  // ==================================================

  if (
    sourceComponent.role ===
    "entrypoint"
  ) {
    return null;
  }


  return {
    from:
      sourceComponent.name,

    to:
      targetComponent.name,

    fromType:
      sourceComponent.role,

    toType:
      targetComponent.role,

    applicationId:
      relationship.applicationId ||
      sourceComponent.applicationId ||
      null,

    applicationRoot:
      relationship.applicationRoot ||
      sourceComponent.applicationRoot ||
      null,

    framework:
      relationship.framework ||
      sourceComponent.framework ||
      null,

    runtime:
      relationship.runtime ||
      sourceComponent.runtime ||
      null,

    language:
      relationship.language ||
      sourceComponent.language ||
      null,

    type:
      "architecture_dependency",

    relationship:
      "uses",

    confidence:
      Math.min(
        sourceComponent.confidence ||
          1,
        targetComponent.confidence ||
          1
      ),

    evidence:
      relationship.evidence ||
      null,

    sourceFrom:
      relationship.from,

    sourceTo:
      relationship.to
  };
}


// ==================================================
// PROJECT API RELATIONSHIP
// ==================================================

function projectApiRelationship(
  relationship
) {
  if (
    !relationship ||
    relationship.type !==
      "api_dependency" ||
    relationship.relationship !==
      "handled_by"
  ) {
    return null;
  }

  return {
    from:
      relationship.from,

    to:
      relationship.to,

    fromType:
      "api",

    toType:
      relationship.toType ||
      "request_handler",

    applicationId:
      relationship.applicationId ||
      null,

    applicationRoot:
      relationship.applicationRoot ||
      null,

    framework:
      relationship.framework ||
      null,

    runtime:
      relationship.runtime ||
      null,

    language:
      relationship.language ||
      null,

    type:
      "api_dependency",

    relationship:
      "handled_by",

    confidence:
      relationship.confidence ||
      null,

    evidence:
      relationship.evidence ||
      null,

    source:
      relationship.apiSource ||
      null,

    componentSource:
      relationship.componentSource ||
      null,

    handler:
      relationship.handler ||
      null
  };
}


// ==================================================
// REMOVE DUPLICATE RELATIONSHIPS
// ==================================================

function removeDuplicateRelationships(
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
    relationship.fromType,
    relationship.toType,
    relationship.relationship,
    relationship.sourceFrom ||
      relationship.source ||
      "",
    relationship.sourceTo ||
      relationship.componentSource ||
      ""
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
// PROJECT RELATIONSHIPS
// ==================================================

function projectRelationships(
  relationships,
  components
) {
  if (
    !Array.isArray(relationships)
  ) {
    return [];
  }

  const componentIndex =
    buildComponentIndex(
      components
    );

  const projected = [];

  for (
    const relationship of
    relationships
  ) {
    if (!relationship) {
      continue;
    }


    // ==================================================
    // SOURCE IMPORT
    // ==================================================

    if (
      relationship.type ===
      "source_import"
    ) {
      const projectedRelationship =
        projectSourceRelationship(
          relationship,
          componentIndex
        );

      if (projectedRelationship) {
        projected.push(
          projectedRelationship
        );
      }

      continue;
    }


    // ==================================================
    // API DEPENDENCY
    // ==================================================

    if (
      relationship.type ===
      "api_dependency"
    ) {
      const projectedRelationship =
        projectApiRelationship(
          relationship
        );

      if (projectedRelationship) {
        projected.push(
          projectedRelationship
        );
      }
    }
  }

  return removeDuplicateRelationships(
    projected
  );
}


// ==================================================
// MAIN ARCHITECTURE PROJECTION
// ==================================================

function projectArchitecture({
  applications = [],
  apis = [],
  components = [],
  relationships = []
} = {}) {
  const projectedApplications =
    projectApplications(
      applications
    );

  const projectedApis =
    projectApis(
      apis
    );

  const projectedComponents =
    projectComponents(
      components
    );

  const projectedRelationships =
    projectRelationships(
      relationships,
      components
    );

  return {
    applications:
      projectedApplications,

    apis:
      projectedApis,

    components:
      projectedComponents,

    relationships:
      projectedRelationships,

    summary: {
      applications:
        projectedApplications.length,

      apis:
        projectedApis.length,

      components:
        projectedComponents.length,

      relationships:
        projectedRelationships.length
    }
  };
}


// ==================================================
// EXPORT
// ==================================================

export { projectArchitecture };
