// ==================================================
// ARCHITECTCONNECT GENERIC COMPONENT DISCOVERY
//
// Purpose:
//
// Infer architectural component roles from:
//
// - application entry points
// - source dependency graph
// - incoming dependencies
// - outgoing dependencies
// - path/name evidence
//
// Does NOT require:
//
// controllers/
// services/
// repositories/
// routers/
//
// ==================================================


// ==================================================
// NORMALIZE PATH
// ==================================================

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}


// ==================================================
// FILE NAME
// ==================================================

function getFileName(filePath) {
  const normalized =
    normalizePath(filePath);

  return normalized
    .split("/")
    .pop() || "";
}


// ==================================================
// DISPLAY NAME
// ==================================================

function toDisplayName(filePath) {
  const fileName =
    getFileName(filePath);

  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(
      /\b\w/g,
      (char) => char.toUpperCase()
    );
}


// ==================================================
// ENTRY POINT DETECTION
// ==================================================

function isEntryPoint(filePath) {
  const fileName =
    getFileName(filePath)
      .toLowerCase();

  return (
    fileName === "server.js" ||
    fileName === "server.ts" ||
    fileName === "index.js" ||
    fileName === "index.ts" ||
    fileName === "main.py" ||
    fileName === "app.py"
  );
}


// ==================================================
// PATH HINTS
//
// These are supporting evidence only.
// They are NOT mandatory application structures.
// ==================================================

function getPathHints(filePath) {
  const normalized =
    `/${normalizePath(
      filePath
    ).toLowerCase()}/`;

  return {
    request:
      normalized.includes("/http/") ||
      normalized.includes("/endpoints/") ||
      normalized.includes("/routes/") ||
      normalized.includes("/routers/") ||
      normalized.includes("/controllers/"),

    business:
      normalized.includes("/business/") ||
      normalized.includes("/logic/") ||
      normalized.includes("/domain/") ||
      normalized.includes("/services/"),

    data:
      normalized.includes("/data/") ||
      normalized.includes("/storage/") ||
      normalized.includes("/persistence/") ||
      normalized.includes("/repositories/")
  };
}


// ==================================================
// BUILD GRAPH INFORMATION
// ==================================================

function buildGraphInfo(
  sourceFiles,
  relationships
) {
  const graph =
    new Map();

  for (
    const sourceFile of sourceFiles
  ) {
    graph.set(
      sourceFile,
      {
        incoming: [],
        outgoing: []
      }
    );
  }

  if (
    !Array.isArray(
      relationships
    )
  ) {
    return graph;
  }

  for (
    const relationship of relationships
  ) {
    if (
      !relationship ||
      !relationship.resolved ||
      !relationship.from ||
      !relationship.to
    ) {
      continue;
    }

    const from =
      normalizePath(
        relationship.from
      );

    const to =
      normalizePath(
        relationship.to
      );

    if (!graph.has(from)) {
      graph.set(
        from,
        {
          incoming: [],
          outgoing: []
        }
      );
    }

    if (!graph.has(to)) {
      graph.set(
        to,
        {
          incoming: [],
          outgoing: []
        }
      );
    }

    graph
      .get(from)
      .outgoing
      .push(to);

    graph
      .get(to)
      .incoming
      .push(from);
  }

  return graph;
}


// ==================================================
// CLASSIFY COMPONENT
// ==================================================

function classifyComponent(
  filePath,
  graphInfo
) {
  const hints =
    getPathHints(
      filePath
    );

  const incoming =
    Array.isArray(
      graphInfo.incoming
    )
      ? graphInfo.incoming
      : [];

  const outgoing =
    Array.isArray(
      graphInfo.outgoing
    )
      ? graphInfo.outgoing
      : [];

  const evidence = [];


  // ==================================================
  // ENTRYPOINT
  // ==================================================

  if (
    isEntryPoint(
      filePath
    )
  ) {
    evidence.push(
      "Application entry-point filename detected."
    );

    if (
      outgoing.length > 0
    ) {
      evidence.push(
        "Entrypoint imports internal application modules."
      );
    }

    return {
      role:
        "entrypoint",

      confidence:
        outgoing.length > 0
          ? 0.95
          : 0.85,

      evidence
    };
  }


  // ==================================================
  // REQUEST HANDLER
  // ==================================================

  if (
    hints.request
  ) {
    evidence.push(
      "Request/endpoint-oriented path evidence detected."
    );

    if (
      incoming.length > 0
    ) {
      evidence.push(
        "Component is imported by another internal application module."
      );
    }

    if (
      outgoing.length > 0
    ) {
      evidence.push(
        "Component delegates to another internal application module."
      );
    }

    return {
      role:
        "request_handler",

      confidence:
        incoming.length > 0 &&
        outgoing.length > 0
          ? 0.95
          : 0.8,

      evidence
    };
  }


  // ==================================================
  // BUSINESS COMPONENT
  // ==================================================

  if (
    hints.business
  ) {
    evidence.push(
      "Business/domain-oriented path evidence detected."
    );

    if (
      incoming.length > 0 &&
      outgoing.length > 0
    ) {
      evidence.push(
        "Component sits between upstream and downstream internal modules."
      );
    }

    return {
      role:
        "business_component",

      confidence:
        incoming.length > 0 &&
        outgoing.length > 0
          ? 0.95
          : 0.8,

      evidence
    };
  }


  // ==================================================
  // DATA COMPONENT
  // ==================================================

  if (
    hints.data
  ) {
    evidence.push(
      "Data/storage-oriented path evidence detected."
    );

    if (
      incoming.length > 0
    ) {
      evidence.push(
        "Component is consumed by an upstream internal module."
      );
    }

    if (
      outgoing.length === 0
    ) {
      evidence.push(
        "Component is a downstream leaf in the internal dependency graph."
      );
    }

    return {
      role:
        "data_component",

      confidence:
        incoming.length > 0 &&
        outgoing.length === 0
          ? 0.95
          : 0.8,

      evidence
    };
  }


  // ==================================================
  // GRAPH-BASED FALLBACK
  // ==================================================
  //
  // No semantic directory name was recognized.
  // Use dependency topology as weaker evidence.
  // ==================================================

  if (
    incoming.length > 0 &&
    outgoing.length > 0
  ) {
    evidence.push(
      "Component has both incoming and outgoing internal dependencies."
    );

    return {
      role:
        "internal_component",

      confidence:
        0.65,

      evidence
    };
  }


  if (
    incoming.length > 0 &&
    outgoing.length === 0
  ) {
    evidence.push(
      "Component is a downstream leaf in the dependency graph."
    );

    return {
      role:
        "internal_component",

      confidence:
        0.55,

      evidence
    };
  }


  if (
    incoming.length === 0 &&
    outgoing.length > 0
  ) {
    evidence.push(
      "Component initiates internal dependencies."
    );

    return {
      role:
        "internal_component",

      confidence:
        0.55,

      evidence
    };
  }


  evidence.push(
    "Insufficient repository dependency evidence for a specialized role."
  );

  return {
    role:
      "internal_component",

    confidence:
      0.4,

    evidence
  };
}


// ==================================================
// MAIN COMPONENT DISCOVERY
// ==================================================

function discoverComponents({
  files = [],
  relationships = [],
  application = null
} = {}) {
  if (
    !Array.isArray(files)
  ) {
    return [];
  }


  // ==================================================
  // SOURCE FILES
  // ==================================================

  const sourceFiles =
    files
      .map(
        (item) =>
          normalizePath(
            typeof item === "string"
              ? item
              : (
                  item &&
                  (
                    item.path ||
                    item.name
                  )
                )
          )
      )
      .filter(Boolean)
      .filter(
        (filePath) => {
          const lower =
            filePath.toLowerCase();

          return (
            lower.endsWith(".js") ||
            lower.endsWith(".jsx") ||
            lower.endsWith(".mjs") ||
            lower.endsWith(".cjs") ||
            lower.endsWith(".ts") ||
            lower.endsWith(".tsx") ||
            lower.endsWith(".py")
          );
        }
      );


  // ==================================================
  // GRAPH
  // ==================================================

  const graph =
    buildGraphInfo(
      sourceFiles,
      relationships
    );


  // ==================================================
  // COMPONENTS
  // ==================================================

  const components = [];

  for (
    const filePath of sourceFiles
  ) {
    const graphInfo =
      graph.get(
        filePath
      ) || {
        incoming: [],
        outgoing: []
      };

    const classification =
      classifyComponent(
        filePath,
        graphInfo
      );

    components.push({
      name:
        toDisplayName(
          filePath
        ),

      source:
        filePath,

      role:
        classification.role,

      confidence:
        classification.confidence,

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

      incomingDependencies:
        graphInfo.incoming,

      outgoingDependencies:
        graphInfo.outgoing,

      evidence:
        classification.evidence
    });
  }


  return components;
}


// ==================================================
// EXPORT
// ==================================================

export { discoverComponents };
