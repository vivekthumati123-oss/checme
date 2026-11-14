const trace = () => {};

import { selectArchitecture as selectArchitecture } from "./analyzers/discovery/architectureSelector.js";import { projectArchitecture as projectArchitecture } from "./analyzers/discovery/architectureProjection.js";import { discoverApiComponentRelationships as discoverApiComponentRelationships } from "./analyzers/discovery/apiComponentRelationshipDiscovery.js";import { discoverApis as discoverApis } from "./analyzers/discovery/apiDiscovery.js";import { discoverApplications as discoverApplications } from "./analyzers/discovery/applicationDiscovery.js";import { analyzeNode as analyzeNode } from "./analyzers/node/nodeAnalyzer.js";import { analyzePythonApplication as analyzePythonApplication } from "./analyzers/python/pythonAnalyzer.js";import { analyzeGaps as analyzeGaps } from "./analyzers/gapsAnalyzer.js";import { analyzeJavaScriptImports as analyzeJavaScriptImports } from "./analyzers/dependencies/javascriptImportAnalyzer.js";import { analyzePythonImports as analyzePythonImports } from "./analyzers/dependencies/pythonImportAnalyzer.js";import { discoverComponents as discoverComponents } from "./analyzers/discovery/componentDiscovery.js";

function scanRepository(
  contents,
  packageContent = ""
) {
  // ==================================================
  // ARCHITECTURE FINDINGS
  // ==================================================

const findings = {
  frontend: [],
  backend: [],

  languages: [],
  frameworks: [],

  applications: [],

discoveredApplications: [],


discoveredApis: [],

discoveredComponents: [],

discoveredRelationships: [],


architectureProjection:
  null,
selectedArchitecture:
null,

apis: [],


  nodeAnalysis: null,
  pythonApplicationAnalysis: null,

  relationships: [],

  gaps: [],
  assumptions: [],

  deployment: [],
  deploymentArchitecture: [],

  tools: [],

  architecture: "",

  runtime: "",
  buildTool: "",

  runtimes: [],
  buildTools: [],

  components: [],

  python: {
    detected: false,
    confidence: 0,
    sourceFiles: [],
    dependencyFiles: [],
    frameworks: [],
    evidence: []
  },

  recommendations: [],
  architectureScore: 0
};

  // ==================================================
  // SAFETY / NORMALIZATION
  // ==================================================

  if (!Array.isArray(contents)) {
    contents = [];
  }

  if (
    typeof packageContent !== "string"
  ) {
    packageContent = "";
  }

  const normalizedPackageContent =
    packageContent.toLowerCase();

  // ==================================================
  // REPOSITORY FILE INFORMATION
  // ==================================================

  const fileNames =
    contents.map((item) =>
      String(
        item.name || ""
      )
        .replace(/\\/g, "/")
        .toLowerCase()
    );

  const filePaths =
    contents.map((item) =>
      String(
        item.path ||
        item.name ||
        ""
      )
        .replace(/\\/g, "/")
        .toLowerCase()
    );

  // ==================================================
  // DEBUG: REPOSITORY FILES
  // ==================================================

  trace(
    "\n========== REPOSITORY FILES =========="
  );

  contents.forEach((item) => {
    trace(
      item.path ||
      item.name
    );
  });

  trace(
    "======================================\n"
  );

  // ==================================================
  // HELPERS
  // ==================================================

  // --------------------------------------------------
  // ADD UNIQUE VALUE
  // --------------------------------------------------

  function addUnique(
    array,
    value
  ) {
    if (
      value &&
      !array.includes(value)
    ) {
      array.push(value);
    }
  }


  // --------------------------------------------------
  // ADD RECOMMENDATION
  // --------------------------------------------------

  function addRecommendation(
    value
  ) {
    addUnique(
      findings.recommendations,
      value
    );
  }


  // --------------------------------------------------
  // GET FILE CONTENT
  // --------------------------------------------------

  function getFileContent(
    item
  ) {
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


  // --------------------------------------------------
  // CHECK PATH SEGMENT
  // --------------------------------------------------
  //
  // This avoids depending on a fixed parent directory.
  //
  // Examples:
  //
  // applications/backend/src/server.js
  // packages/backend/src/server.js
  // apps/backend/src/server.js
  // services/backend/src/server.js
  //
  // containsPathSegment(path, "backend")
  // returns true for all of the examples above.
  //
  // --------------------------------------------------

  function containsPathSegment(
    filePath,
    segment
  ) {
    const normalizedPath =
      `/${
        String(
          filePath || ""
        )
          .replace(
            /\\/g,
            "/"
          )
          .replace(
            /^\/+|\/+$/g,
            ""
          )
          .toLowerCase()
      }/`;

    const normalizedSegment =
      `/${
        String(
          segment || ""
        )
          .replace(
            /\\/g,
            "/"
          )
          .replace(
            /^\/+|\/+$/g,
            ""
          )
          .toLowerCase()
      }/`;

    return normalizedPath.includes(
      normalizedSegment
    );
  }
  


  // ==================================================
  // FR-AC-003:
  // APPLICATION ANALYSIS
  // ==================================================
  // ==================================================
// DYNAMIC APPLICATION DISCOVERY
// ==================================================

const discoveredApplications =
  discoverApplications(
    contents
  );

findings.discoveredApplications =
  Array.isArray(
    discoveredApplications
  )
    ? discoveredApplications
    : [];
    // ==================================================
  // DYNAMIC COMPONENT & RELATIONSHIP DISCOVERY
  // ==================================================
  //
  // Purpose:
  //
  // Analyze each dynamically discovered application
  // independently.
  //
  // JavaScript / TypeScript applications:
  //   -> JavaScript import graph
  //
  // Python applications:
  //   -> Python import graph
  //
  // The resulting import graph is then used by
  // componentDiscovery to infer architectural
  // components.
  //
  // IMPORTANT:
  //
  // These results are stored separately from the
  // existing production components and relationships.
  //
  // Existing:
  //
  // findings.components
  // findings.relationships
  //
  // Dynamic:
  //
  // findings.discoveredComponents
  // findings.discoveredRelationships
  //
  // ==================================================


  const discoveredApis = [];

const discoveredComponents = [];

const discoveredRelationships = [];


  // ==================================================
  // PROCESS EACH DISCOVERED APPLICATION
  // ==================================================

  for (
    const application of
    findings.discoveredApplications
  ) {

    // ==================================================
    // APPLICATION VALIDATION
    // ==================================================

    if (
      !application ||
      !application.root
    ) {
      continue;
    }

        // ==================================================
    // DYNAMIC API DISCOVERY
    // ==================================================

    
    // ==================================================
    // NORMALIZE APPLICATION ROOT
    // ==================================================

    const applicationRoot =
      String(
        application.root ||
        ""
      )
        .replace(
          /\\/g,
          "/"
        )
        .replace(
          /^\/+|\/+$/g,
          ""
        );


    if (!applicationRoot) {
      continue;
    }


    // ==================================================
    // SELECT APPLICATION FILES
    // ==================================================
    //
    // Example:
    //
    // application.root:
    //
    // applications/backend
    //
    // Selected:
    //
    // applications/backend/package.json
    // applications/backend/src/server.js
    // applications/backend/src/...
    //
    // Other application files are excluded.
    //
    // ==================================================

    const applicationFiles =
      contents.filter(
        (item) => {

          if (!item) {
            return false;
          }


          const filePath =
            String(
              item.path ||
              item.name ||
              ""
            )
              .replace(
                /\\/g,
                "/"
              )
              .replace(
                /^\/+|\/+$/g,
                ""
              );


          if (!filePath) {
            return false;
          }


          return (
            filePath ===
              applicationRoot ||
            filePath.startsWith(
              `${applicationRoot}/`
            )
          );
        }
      );


    // ==================================================
    // NO APPLICATION FILES
    // ==================================================

    if (
      applicationFiles.length ===0
    ) {
      continue;
    }

        // ==================================================
    // DYNAMIC API DISCOVERY
    // ==================================================

    const applicationApis =
      discoverApis({
        application,

        files:
          applicationFiles
      });

    if (
      Array.isArray(
        applicationApis
      )
    ) {
      discoveredApis.push(
        ...applicationApis
      );
    }


    // ==================================================
    // APPLICATION DEPENDENCY GRAPH
    // ==================================================

    let applicationRelationships =
      [];


    // ==================================================
    // NODE.JS / JAVASCRIPT / TYPESCRIPT
    // ==================================================
    //
    // Examples:
    //
    // Express
    // React
    // generic Node.js applications
    //
    // ==================================================

    if (
      application.runtime ===
      "Node.js"
    ) {

      const javascriptRelationships =
        analyzeJavaScriptImports(
          applicationFiles
        );


      if (
        Array.isArray(
          javascriptRelationships
        )
      ) {
        applicationRelationships =
          javascriptRelationships;
      }
    }


    // ==================================================
    // PYTHON
    // ==================================================
    //
    // Examples:
    //
    // FastAPI
    // Flask
    // Django
    // generic Python applications
    //
    // ==================================================

    if (
      application.runtime ===
      "Python"
    ) {

      const pythonRelationships =
        analyzePythonImports(
          applicationFiles,
          applicationRoot
        );


      if (
        Array.isArray(
          pythonRelationships
        )
      ) {
        applicationRelationships =
          pythonRelationships;
      }
    }


    // ==================================================
    // ENRICH RELATIONSHIPS WITH APPLICATION CONTEXT
    // ==================================================

    const enrichedRelationships =
      applicationRelationships.map(
        (relationship) => ({
          ...relationship,

          applicationId:
            application.id ||
            null,

          applicationRoot:
            applicationRoot,

          applicationType:
            application.type ||
            null,

          framework:
            application.framework ||
            null,

          runtime:
            application.runtime ||
            null,

          language:
            application.language ||
            null
        })
      );


    // ==================================================
    // STORE DYNAMIC RELATIONSHIPS
    // ==================================================

    discoveredRelationships.push(
      ...enrichedRelationships
    );


    // ==================================================
    // COMPONENT DISCOVERY
    // ==================================================
    //
    // Uses:
    //
    // application files
    // +
    // actual source dependency graph
    // +
    // application evidence
    //
    // to infer component roles.
    //
    // ==================================================

    const applicationComponents =
      discoverComponents({
        files:
          applicationFiles,

        relationships:
          enrichedRelationships,

        application
      });


    // ==================================================
    // ENRICH COMPONENTS
    // ==================================================

    const enrichedComponents =
      Array.isArray(
        applicationComponents
      )
        ? applicationComponents.map(
            (component) => ({
              ...component,

              applicationId:
                component.applicationId ||
                application.id ||
                null,

              applicationRoot:
                component.applicationRoot ||
                applicationRoot,

              applicationType:
                application.type ||
                null,

              framework:
                application.framework ||
                null,

              runtime:
                application.runtime ||
                null,

              language:
                application.language ||
                null
            })
          )
        : [];

            // ==================================================
    // API -> COMPONENT RELATIONSHIPS
    // ==================================================

    const apiComponentRelationships =
      discoverApiComponentRelationships({
        application,

        apis:
          applicationApis,

        components:
          enrichedComponents,

        relationships:
          enrichedRelationships
      });


    // ==================================================
    // ENRICH API -> COMPONENT RELATIONSHIPS
    // ==================================================

    const enrichedApiComponentRelationships =
      Array.isArray(
        apiComponentRelationships
      )
        ? apiComponentRelationships.map(
            (relationship) => ({
              ...relationship,

              applicationId:
                relationship.applicationId ||
                application.id ||
                null,

              applicationRoot:
                relationship.applicationRoot ||
                applicationRoot,

              applicationType:
                application.type ||
                null,

              framework:
                application.framework ||
                null,

              runtime:
                application.runtime ||
                null,

              language:
                application.language ||
                null
            })
          )
        : [];


    // ==================================================
    // STORE API -> COMPONENT RELATIONSHIPS
    // ==================================================

    discoveredRelationships.push(
      ...enrichedApiComponentRelationships
    );

    // ==================================================
    // STORE DYNAMIC COMPONENTS
    // ==================================================

    discoveredComponents.push(
      ...enrichedComponents
    );
  }


  // ==================================================
  // REMOVE DUPLICATE DYNAMIC RELATIONSHIPS
  // ==================================================

  const uniqueDiscoveredRelationships =
    [];

  const seenRelationships =
    new Set();


  for (
    const relationship of
    discoveredRelationships
  ) {

    const key =
      [
        relationship.applicationId,
        relationship.from,
        relationship.to ||
          relationship.importPath ||
          relationship.module,
        relationship.relationship
      ].join("|");


    if (
      seenRelationships.has(
        key
      )
    ) {
      continue;
    }


    seenRelationships.add(
      key
    );


    uniqueDiscoveredRelationships.push(
      relationship
    );
  }


  // ==================================================
  // REMOVE DUPLICATE DYNAMIC COMPONENTS
  // ==================================================

  const uniqueDiscoveredComponents =
    [];

  const seenComponents =
    new Set();


  for (
    const component of
    discoveredComponents
  ) {

    const key =
      [
        component.applicationId,
        component.source,
        component.role
      ].join("|");


    if (
      seenComponents.has(
        key
      )
    ) {
      continue;
    }


    seenComponents.add(
      key
    );


    uniqueDiscoveredComponents.push(
      component
    );
  }


  // ==================================================
  // STORE DYNAMIC RESULTS
  // ==================================================

  // ==================================================
// STORE DYNAMIC RESULTS
// ==================================================

findings.discoveredApis =
  discoveredApis;

findings.discoveredComponents =
  uniqueDiscoveredComponents;

findings.discoveredRelationships =
  uniqueDiscoveredRelationships;

  trace(
  "\n========== DISCOVERED RELATIONSHIP OBJECTS =========="
);

trace(
  JSON.stringify(
    findings.discoveredRelationships,
    null,
    2
  )
);

trace(
  "=====================================================\n"
);

  // ==================================================
// DYNAMIC ARCHITECTURE PROJECTION
// ==================================================

findings.architectureProjection =
  projectArchitecture({
    applications:
      findings.discoveredApplications,

    apis:
      findings.discoveredApis,

    components:
      findings.discoveredComponents,

    relationships:
      findings.discoveredRelationships
  });

  
trace(
  "\n========== ARCHITECTURE PROJECTION SUMMARY =========="
);

trace(
  "Applications:",
  findings.architectureProjection.summary.applications
);

trace(
  "APIs:",
  findings.architectureProjection.summary.apis
);

trace(
  "Components:",
  findings.architectureProjection.summary.components
);

trace(
  "Relationships:",
  findings.architectureProjection.summary.relationships
);

trace(
  "====================================================\n"
);


  // ==================================================
  // DEBUG: DYNAMIC DISCOVERY SUMMARY
  // ==================================================

  trace(
    "\n========== DYNAMIC DISCOVERY SUMMARY =========="
  );


  trace(
  "Applications:",
  findings.discoveredApplications.length
);

trace(
  "APIs:",
  findings.discoveredApis.length
);

trace(
  "Components:",
  findings.discoveredComponents.length
);

trace(
  "Relationships:",
  findings.discoveredRelationships.length
);


  trace(
    "===============================================\n"
  );


  const nodeAnalysis =
    analyzeNode(
      contents
    );

  const pythonApplicationAnalysis =
    analyzePythonApplication(
      contents
    );

  findings.nodeAnalysis =
    nodeAnalysis;

  findings.pythonApplicationAnalysis =
    pythonApplicationAnalysis;

  // ==================================================
  // NODE APPLICATION
  // ==================================================

  if (
    nodeAnalysis &&
    nodeAnalysis.detected
  ) {
    findings.applications.push({
      name:
        nodeAnalysis.application ||
        "Node.js Application",

      type:
        "backend",

      language:
        nodeAnalysis.language ||
        "JavaScript",

      runtime:
        nodeAnalysis.runtime ||
        "Node.js",

      framework:
        nodeAnalysis.framework ||
        null,

      sourceFiles:
        Array.isArray(
          nodeAnalysis.sourceFiles
        )
          ? nodeAnalysis.sourceFiles
          : []
    });

    if (
      Array.isArray(
        nodeAnalysis.routes
      )
    ) {
      for (
        const route of
        nodeAnalysis.routes
      ) {
        findings.apis.push({
          application:
            nodeAnalysis.application ||
            "Node.js Application",

          framework:
            nodeAnalysis.framework ||
            null,

          method:
            route.method,

          path:
            route.path,

          handler:
            route.handler ||
            null,

          source:
            route.source
        });
      }
    }
  }

  // ==================================================
  // PYTHON APPLICATION
  // ==================================================

  if (
    pythonApplicationAnalysis &&
    pythonApplicationAnalysis.detected
  ) {
    findings.applications.push({
      name:
        pythonApplicationAnalysis.application ||
        "Python Application",

      type:
        "backend",

      language:
        pythonApplicationAnalysis.language ||
        "Python",

      runtime:
        pythonApplicationAnalysis.runtime ||
        "Python",

      framework:
        pythonApplicationAnalysis.framework ||
        null,

      sourceFiles:
        Array.isArray(
          pythonApplicationAnalysis.sourceFiles
        )
          ? pythonApplicationAnalysis.sourceFiles
          : []
    });

    if (
      Array.isArray(
        pythonApplicationAnalysis.routes
      )
    ) {
      for (
        const route of
        pythonApplicationAnalysis.routes
      ) {
        findings.apis.push({
          application:
            pythonApplicationAnalysis.application ||
            "Python Application",

          framework:
            pythonApplicationAnalysis.framework ||
            null,

          method:
            route.method,

          path:
            route.path,

          handler:
            route.handler ||
            null,

          source:
            route.source
        });
      }
    }
  }

  // ==================================================
  // FR-AC-005:
  // REPOSITORY RELATIONSHIPS
  // ==================================================

  const nodeRelationships =
    nodeAnalysis &&
    Array.isArray(
      nodeAnalysis.dependencies
    )
      ? nodeAnalysis.dependencies
      : [];

  const pythonRelationships =
    pythonApplicationAnalysis &&
    Array.isArray(
      pythonApplicationAnalysis.dependencies
    )
      ? pythonApplicationAnalysis.dependencies
      : [];

  findings.relationships = [
    ...nodeRelationships,
    ...pythonRelationships
  ];
// ==================================================
// ARCHITECTURE SELECTION
// ==================================================
//
// Dynamic projection is preferred when valid.
//
// Legacy architecture remains available as a safe
// fallback.
//
// IMPORTANT:
//
// This does not replace findings.applications,
// findings.apis, findings.components, or
// findings.relationships yet.
//
// ==================================================

findings.selectedArchitecture =
  selectArchitecture({
    projection:
      findings.architectureProjection,

    legacy: {
      applications:
        findings.applications,

      apis:
        findings.apis,

      components:
        findings.components,

      relationships:
        findings.relationships
    }
  });

  trace(
  "\n========== ARCHITECTURE SELECTION =========="
);

trace(
  "Selected source:",
  findings.selectedArchitecture.source
);

trace(
  "Fallback used:",
  findings.selectedArchitecture.fallbackUsed
    ? "YES"
    : "NO"
);

trace(
  "Reason:",
  findings.selectedArchitecture.reason
);

trace(
  "============================================\n"
);

// ==================================================
// SELECTED ARCHITECTURE VIEW
// ==================================================

const selectedArchitecture =
  findings.selectedArchitecture &&
  findings.selectedArchitecture.architecture
    ? findings.selectedArchitecture.architecture
    : {
        applications:
          findings.applications,

        apis:
          findings.apis,

        components:
          findings.components,

        relationships:
          findings.relationships
      };

      trace(
  "\n========== SELECTED ARCHITECTURE VIEW =========="
);

trace(
  "Source:",
  findings.selectedArchitecture
    ? findings.selectedArchitecture.source
    : "legacy"
);

trace(
  "Applications:",
  selectedArchitecture.applications.length
);

trace(
  "APIs:",
  selectedArchitecture.apis.length
);

trace(
  "Components:",
  selectedArchitecture.components.length
);

trace(
  "Relationships:",
  selectedArchitecture.relationships.length
);

trace(
  "================================================\n"
);
  // ==================================================
  // JAVASCRIPT DETECTION
  // ==================================================

  const hasJavaScriptFiles =
    filePaths.some(
      (file) =>
        file.endsWith(".js") ||
        file.endsWith(".jsx") ||
        file.endsWith(".mjs") ||
        file.endsWith(".cjs")
    );

  if (
    hasJavaScriptFiles ||
    fileNames.includes(
      "package.json"
    )
  ) {
    addUnique(
      findings.languages,
      "JavaScript"
    );
  }

  // ==================================================
  // TYPESCRIPT DETECTION
  // ==================================================

  const hasTypeScriptFiles =
    filePaths.some(
      (file) =>
        file.endsWith(".ts") ||
        file.endsWith(".tsx")
    );

  if (
    hasTypeScriptFiles ||
    normalizedPackageContent.includes(
      "typescript"
    )
  ) {
    addUnique(
      findings.languages,
      "TypeScript"
    );

    addUnique(
      findings.tools,
      "TypeScript"
    );
  }

  // ==================================================
  // PYTHON DETECTION
  // ==================================================

  const pythonFiles =
    filePaths.filter(
      (file) =>
        file.endsWith(".py")
    );

  const pythonDependencyFiles =
    filePaths.filter(
      (file) =>
        file.endsWith(
          "requirements.txt"
        ) ||
        file.endsWith(
          "pyproject.toml"
        ) ||
        file.endsWith(
          "pipfile"
        ) ||
        file.endsWith(
          "pipfile.lock"
        ) ||
        file.endsWith(
          "poetry.lock"
        ) ||
        file.endsWith(
          "uv.lock"
        ) ||
        file.endsWith(
          "setup.py"
        ) ||
        file.endsWith(
          "setup.cfg"
        )
    );

  if (
    pythonFiles.length > 0 ||
    pythonDependencyFiles.length > 0
  ) {
    findings.python.detected =
      true;

    findings.python.sourceFiles =
      pythonFiles;

    findings.python.dependencyFiles =
      pythonDependencyFiles;

    addUnique(
      findings.languages,
      "Python"
    );

    addUnique(
      findings.runtimes,
      "Python"
    );

    addUnique(
      findings.components,
      "Python Application"
    );

    if (
      pythonFiles.length > 0
    ) {
      findings.python.evidence.push(
        `${pythonFiles.length} Python source file(s) found`
      );
    }

    if (
      pythonDependencyFiles.length > 0
    ) {
      findings.python.evidence.push(
        `${pythonDependencyFiles.length} Python dependency/project file(s) found`
      );
    }

    if (
      pythonFiles.length > 0 &&
      pythonDependencyFiles.length > 0
    ) {
      findings.python.confidence =
        1.0;
    } else if (
      pythonFiles.length > 0
    ) {
      findings.python.confidence =
        0.8;
    } else {
      findings.python.confidence =
        0.6;
    }
  }

  // ==================================================
  // PYTHON DEPENDENCY CONTENT
  // ==================================================

  let pythonDependencyContent = "";

  for (
    const item of contents
  ) {
    const path =
      String(
        item.path ||
        item.name ||
        ""
      )
        .replace(/\\/g, "/")
        .toLowerCase();

    const isDependencyFile =
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
        "setup.py"
      ) ||
      path.endsWith(
        "setup.cfg"
      );

    if (isDependencyFile) {
      pythonDependencyContent +=
        "\n" +
        getFileContent(item);
    }
  }

  pythonDependencyContent =
    pythonDependencyContent.toLowerCase();

  // ==================================================
  // PYTHON SOURCE CONTENT
  // ==================================================

  let pythonSourceContent = "";

  for (
    const item of contents
  ) {
    const path =
      String(
        item.path ||
        item.name ||
        ""
      )
        .replace(/\\/g, "/")
        .toLowerCase();

    if (
      path.endsWith(".py")
    ) {
      pythonSourceContent +=
        "\n" +
        getFileContent(item);
    }
  }

  const normalizedPythonSource =
    pythonSourceContent.toLowerCase();

  // ==================================================
  // PYTHON FRAMEWORK DETECTION
  // ==================================================

  if (
    findings.python.detected
  ) {
    const hasFastApiDependency =
      pythonDependencyContent.includes(
        "fastapi"
      );

    const hasFastApiImport =
      normalizedPythonSource.includes(
        "from fastapi import"
      ) ||
      normalizedPythonSource.includes(
        "import fastapi"
      );

    const hasFastApiApplication =
      normalizedPythonSource.includes(
        "fastapi("
      );

    const hasApiRouter =
      normalizedPythonSource.includes(
        "apirouter("
      );

    if (
      hasFastApiDependency ||
      hasFastApiImport ||
      hasFastApiApplication ||
      hasApiRouter
    ) {
      addUnique(
        findings.python.frameworks,
        "FastAPI"
      );

      addUnique(
        findings.frameworks,
        "FastAPI"
      );

      addUnique(
        findings.backend,
        "FastAPI"
      );

      addUnique(
        findings.python.evidence,
        "FastAPI framework evidence found"
      );
    }

    // Django

    const hasDjangoDependency =
      pythonDependencyContent.includes(
        "django"
      );

    const hasDjangoSource =
      normalizedPythonSource.includes(
        "from django"
      ) ||
      normalizedPythonSource.includes(
        "import django"
      );

    const hasDjangoFiles =
      filePaths.some(
        (file) =>
          file.endsWith(
            "manage.py"
          ) ||
          file.endsWith(
            "settings.py"
          )
      );

    if (
      hasDjangoDependency ||
      hasDjangoSource ||
      hasDjangoFiles
    ) {
      addUnique(
        findings.python.frameworks,
        "Django"
      );

      addUnique(
        findings.frameworks,
        "Django"
      );

      addUnique(
        findings.backend,
        "Django"
      );

      addUnique(
        findings.python.evidence,
        "Django framework evidence found"
      );
    }

    // Flask

    const hasFlaskDependency =
      pythonDependencyContent.includes(
        "flask"
      );

    const hasFlaskSource =
      normalizedPythonSource.includes(
        "from flask import"
      ) ||
      normalizedPythonSource.includes(
        "import flask"
      );

    if (
      hasFlaskDependency ||
      hasFlaskSource
    ) {
      addUnique(
        findings.python.frameworks,
        "Flask"
      );

      addUnique(
        findings.frameworks,
        "Flask"
      );

      addUnique(
        findings.backend,
        "Flask"
      );

      addUnique(
        findings.python.evidence,
        "Flask framework evidence found"
      );
    }
  }

  // ==================================================
  // REACT DETECTION
  // ==================================================

  if (
    normalizedPackageContent.includes(
      "react"
    )
  ) {
    addUnique(
      findings.frontend,
      "React"
    );

    addUnique(
      findings.frameworks,
      "React"
    );
  }

  // ==================================================
  // EXPRESS DETECTION
  // ==================================================

  if (
    normalizedPackageContent.includes(
      "express"
    ) ||
    (
      nodeAnalysis &&
      nodeAnalysis.framework ===
        "Express"
    )
  ) {
    addUnique(
      findings.backend,
      "Express"
    );

    addUnique(
      findings.frameworks,
      "Express"
    );
  }

  // ==================================================
  // BABEL DETECTION
  // ==================================================

  if (
    normalizedPackageContent.includes(
      "@babel"
    )
  ) {
    addUnique(
      findings.tools,
      "Babel"
    );
  }

  // ==================================================
  // YARN DETECTION
  // ==================================================

  if (
    fileNames.includes(
      "yarn.lock"
    )
  ) {
    addUnique(
      findings.tools,
      "Yarn"
    );
  }

  // ==================================================
  // RUNTIME DETECTION
  // ==================================================

  if (
    fileNames.includes(
      "package.json"
    ) ||
    (
      nodeAnalysis &&
      nodeAnalysis.detected
    )
  ) {
    findings.runtime =
      "Node.js";

    addUnique(
      findings.runtimes,
      "Node.js"
    );
  }

  if (
    findings.python.detected &&
    !findings.runtime
  ) {
    findings.runtime =
      "Python";
  }

  // ==================================================
  // BUILD TOOL DETECTION
  // ==================================================

  if (
    fileNames.includes(
      "babel.config.js"
    ) ||
    fileNames.includes(
      "babel.config-ts.js"
    ) ||
    fileNames.includes(
      "babel.config-react-compiler.js"
    )
  ) {
    findings.buildTool =
      "Babel";

    addUnique(
      findings.buildTools,
      "Babel"
    );
  }

  if (
    filePaths.some(
      (file) =>
        file.endsWith(
          "pyproject.toml"
        )
    )
  ) {
    addUnique(
      findings.buildTools,
      "pyproject.toml"
    );
  }

  if (
    filePaths.some(
      (file) =>
        file.endsWith(
          "requirements.txt"
        )
    )
  ) {
    addUnique(
      findings.buildTools,
      "pip/requirements.txt"
    );
  }

  // ==================================================
  // ARCHITECTURE PATTERN
  // ==================================================

  if (
    normalizedPackageContent.includes(
      "workspaces"
    )
  ) {
    findings.architecture =
      "Monorepo";
  }

   // ==================================================
  // COMPONENT DETECTION
  // ==================================================
  //
  // Repository-layout independent.
  //
  // ArchitectConnect must not depend on a repository
  // using a specific root directory such as:
  //
  // packages/
  //
  // The following layouts are supported:
  //
  // packages/backend/
  // applications/backend/
  // apps/backend/
  // services/backend/
  // backend/
  //
  // and:
  //
  // packages/python-api/
  // applications/python-api/
  // apps/python-api/
  // services/python-api/
  // python-api/
  //
  // ==================================================


  // ==================================================
  // MONOREPO APPLICATION ROOT
  // ==================================================

  const monorepoRootSegments = [
    "packages",
    "applications",
    "apps",
    "services"
  ];

  const hasMonorepoApplicationRoot =
    filePaths.some(
      (file) =>
        monorepoRootSegments.some(
          (segment) =>
            containsPathSegment(
              file,
              segment
            )
        )
    );

  if (
    hasMonorepoApplicationRoot
  ) {
    addUnique(
      findings.components,
      "Application Modules"
    );
  }


  // ==================================================
  // FRONTEND
  // ==================================================

  const hasFrontend =
    filePaths.some(
      (file) =>
        containsPathSegment(
          file,
          "frontend"
        )
    );

  if (
    hasFrontend
  ) {
    addUnique(
      findings.components,
      "Frontend"
    );
  }


  // ==================================================
  // BACKEND API
  // ==================================================

  const hasBackend =
    filePaths.some(
      (file) =>
        containsPathSegment(
          file,
          "backend"
        )
    );

  if (
    hasBackend
  ) {
    addUnique(
      findings.components,
      "Backend API"
    );
  }


  // ==================================================
  // PYTHON API
  // ==================================================

  const hasPythonApi =
    filePaths.some(
      (file) =>
        containsPathSegment(
          file,
          "python-api"
        )
    );

  if (
    hasPythonApi
  ) {
    addUnique(
      findings.components,
      "Python API"
    );
  }


  // ==================================================
  // COMPILER
  // ==================================================

  const hasCompiler =
    filePaths.some(
      (file) =>
        containsPathSegment(
          file,
          "compiler"
        )
    );

  if (
    hasCompiler
  ) {
    addUnique(
      findings.components,
      "Compiler"
    );
  }


  // ==================================================
  // BUILD SCRIPTS
  // ==================================================

  const hasBuildScripts =
    filePaths.some(
      (file) =>
        containsPathSegment(
          file,
          "scripts"
        )
    );

  if (
    hasBuildScripts
  ) {
    addUnique(
      findings.components,
      "Build Scripts"
    );
  }


  // ==================================================
  // TEST FIXTURES
  // ==================================================

  const hasFixtures =
    filePaths.some(
      (file) =>
        containsPathSegment(
          file,
          "fixtures"
        )
    );

  if (
    hasFixtures
  ) {
    addUnique(
      findings.components,
      "Test Fixtures"
    );
  }
  // ==================================================
  // DOCKER
  // ==================================================

  if (
    filePaths.some(
      (file) =>
        file ===
          "dockerfile" ||
        file.endsWith(
          "/dockerfile"
        ) ||
        file.endsWith(
          ".dockerfile"
        )
    )
  ) {
    addUnique(
      findings.deployment,
      "Docker"
    );

    addUnique(
      findings.deploymentArchitecture,
      "Containerized Deployment"
    );
  }

  // ==================================================
  // TERRAFORM
  // ==================================================

  if (
    filePaths.some(
      (file) =>
        file.endsWith(
          ".tf"
        ) ||
        file.endsWith(
          ".tfvars"
        ) ||
        file.startsWith(
          "terraform/"
        ) ||
        file.includes(
          "/terraform/"
        )
    )
  ) {
    addUnique(
      findings.deployment,
      "Terraform"
    );

    addUnique(
      findings.deploymentArchitecture,
      "Infrastructure as Code"
    );
  }

  // ==================================================
  // BICEP
  // ==================================================

  if (
    filePaths.some(
      (file) =>
        file.endsWith(
          ".bicep"
        )
    )
  ) {
    addUnique(
      findings.deployment,
      "Bicep"
    );

    addUnique(
      findings.deploymentArchitecture,
      "Azure Infrastructure as Code"
    );
  }

  // ==================================================
  // KUBERNETES
  // ==================================================

  if (
    filePaths.some(
      (file) =>
        file.startsWith(
          "k8s/"
        ) ||
        file.includes(
          "/k8s/"
        ) ||
        file.startsWith(
          "kubernetes/"
        ) ||
        file.includes(
          "/kubernetes/"
        ) ||
        file.endsWith(
          "deployment.yaml"
        ) ||
        file.endsWith(
          "deployment.yml"
        ) ||
        file.endsWith(
          "service.yaml"
        ) ||
        file.endsWith(
          "service.yml"
        )
    )
  ) {
    addUnique(
      findings.deployment,
      "Kubernetes"
    );

    addUnique(
      findings.deploymentArchitecture,
      "Container Orchestration"
    );
  }

  // ==================================================
  // ARCHITECTURE SCORE
  // ==================================================

  if (
    findings.frontend.length > 0
  ) {
    findings.architectureScore +=
      15;
  }

  if (
    findings.backend.length > 0
  ) {
    findings.architectureScore +=
      15;
  }

  if (
    findings.runtimes.length > 0 ||
    findings.runtime
  ) {
    findings.architectureScore +=
      15;
  }

  if (
    findings.buildTools.length > 0 ||
    findings.buildTool
  ) {
    findings.architectureScore +=
      10;
  }

  if (
    findings.architecture
  ) {
    findings.architectureScore +=
      15;
  }

  if (
    findings.components.length > 0
  ) {
    findings.architectureScore +=
      15;
  }

  if (
    findings.deployment.length > 0
  ) {
    findings.architectureScore +=
      15;
  }

  findings.architectureScore =
    Math.min(
      findings.architectureScore,
      100
    );

  // ==================================================
  // RECOMMENDATIONS
  // ==================================================

  if (
    findings.architecture ===
    "Monorepo"
  ) {
    addRecommendation(
      "Consider workspace dependency management strategies."
    );

    addRecommendation(
  "Maintain clear ownership boundaries between applications and modules."
);
  }

  if (
    findings.frontend.includes(
      "React"
    )
  ) {
    addRecommendation(
      "Adopt component-driven architecture."
    );

    addRecommendation(
      "Consider Storybook for UI component governance."
    );
  }

  if (
    findings.backend.includes(
      "Express"
    )
  ) {
    addRecommendation(
      "Maintain clear API and service boundaries for the Express backend."
    );
  }

  if (
    findings.tools.includes(
      "TypeScript"
    )
  ) {
    addRecommendation(
      "Enable strict TypeScript type checking."
    );
  }

  if (
    findings.python.detected
  ) {
    addRecommendation(
      "Maintain clear module boundaries within the Python application."
    );
  }

  if (
    findings.python.frameworks.includes(
      "FastAPI"
    )
  ) {
    addRecommendation(
      "Organize FastAPI endpoints using routers and maintain clear API, service, and data-access boundaries."
    );
  }

  if (
    findings.python.frameworks.includes(
      "Django"
    )
  ) {
    addRecommendation(
      "Maintain clear Django application boundaries and separate business logic from views."
    );
  }

  if (
    findings.python.frameworks.includes(
      "Flask"
    )
  ) {
    addRecommendation(
      "Consider Flask Blueprints for modular application organization."
    );
  }

  if (
    findings.deployment.includes(
      "Docker"
    )
  ) {
    addRecommendation(
      "Consider multi-stage Docker builds and container image scanning."
    );
  }

  if (
    findings.deployment.includes(
      "Terraform"
    )
  ) {
    addRecommendation(
      "Consider reusable Terraform modules and remote state management."
    );
  }

  if (
    findings.deployment.includes(
      "Bicep"
    )
  ) {
    addRecommendation(
      "Consider organizing Bicep resources into reusable modules."
    );
  }

  if (
    findings.deployment.includes(
      "Kubernetes"
    )
  ) {
    addRecommendation(
      "Consider Kubernetes health probes, resource limits, and deployment policies."
    );
  }

  // ==================================================
  // FR-AC-009:
  // GAP & ASSUMPTION ANALYSIS
  // ==================================================
  //
  // IMPORTANT:
  //
  // Run this after application, component,
  // relationship, technology and infrastructure
  // analysis so the analyzer receives completed
  // repository findings.
  // ==================================================


// ==================================================
// SELECTED FINDINGS FOR DOWNSTREAM ANALYSIS
// ==================================================

const selectedFindings = {
  ...findings,

  applications:
    selectedArchitecture.applications,

  apis:
    selectedArchitecture.apis,

  components:
    selectedArchitecture.components,

  relationships:
    selectedArchitecture.relationships
};


// ==================================================
// LEGACY GAP ANALYSIS
// ==================================================

const gapAnalysis =
  analyzeGaps(
    findings
  );


// ==================================================
// SELECTED GAP ANALYSIS
// ==================================================

const selectedGapAnalysis =
  analyzeGaps(
    selectedFindings
  );


// ==================================================
// GAP / ASSUMPTION COMPARISON COUNTS
// ==================================================

const legacyGapCount =
  gapAnalysis &&
  Array.isArray(
    gapAnalysis.gaps
  )
    ? gapAnalysis.gaps.length
    : 0;


const selectedGapCount =
  selectedGapAnalysis &&
  Array.isArray(
    selectedGapAnalysis.gaps
  )
    ? selectedGapAnalysis.gaps.length
    : 0;


const legacyAssumptionCount =
  gapAnalysis &&
  Array.isArray(
    gapAnalysis.assumptions
  )
    ? gapAnalysis.assumptions.length
    : 0;


const selectedAssumptionCount =
  selectedGapAnalysis &&
  Array.isArray(
    selectedGapAnalysis.assumptions
  )
    ? selectedGapAnalysis.assumptions.length
    : 0;


// ==================================================
// GAP AREA COMPARISON
// ==================================================

const legacyGapAreas =
  gapAnalysis &&
  Array.isArray(
    gapAnalysis.gaps
  )
    ? gapAnalysis.gaps
        .map(
          (gap) =>
            gap.area
        )
        .sort()
    : [];


const selectedGapAreas =
  selectedGapAnalysis &&
  Array.isArray(
    selectedGapAnalysis.gaps
  )
    ? selectedGapAnalysis.gaps
        .map(
          (gap) =>
            gap.area
        )
        .sort()
    : [];


// ==================================================
// ASSUMPTION AREA COMPARISON
// ==================================================

const legacyAssumptionAreas =
  gapAnalysis &&
  Array.isArray(
    gapAnalysis.assumptions
  )
    ? gapAnalysis.assumptions
        .map(
          (assumption) =>
            assumption.area
        )
        .sort()
    : [];


const selectedAssumptionAreas =
  selectedGapAnalysis &&
  Array.isArray(
    selectedGapAnalysis.assumptions
  )
    ? selectedGapAnalysis.assumptions
        .map(
          (assumption) =>
            assumption.area
        )
        .sort()
    : [];


// ==================================================
// SEMANTIC MATCH
// ==================================================

const gapAreasMatch =
  JSON.stringify(
    legacyGapAreas
  ) ===
  JSON.stringify(
    selectedGapAreas
  );


const assumptionAreasMatch =
  JSON.stringify(
    legacyAssumptionAreas
  ) ===
  JSON.stringify(
    selectedAssumptionAreas
  );


// ==================================================
// GAP ANALYSIS COMPARISON OUTPUT
// ==================================================

trace(
  "\n========== GAP ANALYSIS COMPARISON =========="
);

trace(
  "Legacy gaps:",
  legacyGapCount
);

trace(
  "Selected gaps:",
  selectedGapCount
);

trace(
  "Legacy assumptions:",
  legacyAssumptionCount
);

trace(
  "Selected assumptions:",
  selectedAssumptionCount
);

trace(
  "Gap areas match:",
  gapAreasMatch
    ? "YES"
    : "NO"
);

trace(
  "Assumption areas match:",
  assumptionAreasMatch
    ? "YES"
    : "NO"
);

trace(
  "=============================================\n"
);


// ==================================================
// SELECTED GAP ANALYSIS PRIMARY
// ==================================================

findings.gaps =
  selectedGapAnalysis &&
  Array.isArray(
    selectedGapAnalysis.gaps
  )
    ? [
        ...selectedGapAnalysis.gaps
      ]
    : [];


findings.assumptions =
  selectedGapAnalysis &&
  Array.isArray(
    selectedGapAnalysis.assumptions
  )
    ? [
        ...selectedGapAnalysis.assumptions
      ]
    : [];
  // ==================================================
  // DEBUG: PYTHON SOURCE
  // ==================================================

  const firstPythonFile =
    contents.find((item) =>
      String(
        item.path ||
        item.name ||
        ""
      )
        .replace(/\\/g, "/")
        .toLowerCase()
        .endsWith(".py")
    );

  trace(
    "\n========== PYTHON FILE CHECK =========="
  );

  if (firstPythonFile) {
    trace(
      "Python file:",
      firstPythonFile.path ||
      firstPythonFile.name
    );

    const source =
      getFileContent(
        firstPythonFile
      );

    trace(
      "Source content available:",
      source.length > 0
        ? "YES"
        : "NO"
    );

    if (
      source.length > 0
    ) {
      trace(
        "Source length:",
        source.length
      );
    }
  } else {
    trace(
      "No Python source file found."
    );
  }

  trace(
    "=======================================\n"
  );

  // ==================================================
  // DEBUG: PYTHON TECHNOLOGY ANALYSIS
  // ==================================================

  trace(
    "\n========== PYTHON ANALYSIS =========="
  );

  trace(
    JSON.stringify(
      findings.python,
      null,
      2
    )
  );

  trace(
    "=====================================\n"
  );

  // ==================================================
  // DEBUG: NODE APPLICATION
  // ==================================================

  trace(
    "\n========== NODE APPLICATION ANALYSIS =========="
  );

  trace(
    JSON.stringify(
      findings.nodeAnalysis,
      null,
      2
    )
  );

  trace(
    "===============================================\n"
  );

  // ==================================================
  // DEBUG: PYTHON APPLICATION
  // ==================================================

  trace(
    "\n========== PYTHON APPLICATION ANALYSIS =========="
  );

  trace(
    JSON.stringify(
      findings.pythonApplicationAnalysis,
      null,
      2
    )
  );

  trace(
    "=================================================\n"
  );

  // ==================================================
  // COMBINED REPOSITORY ANALYSIS
  // ==================================================

  trace(
    "\n========== REPOSITORY ANALYSIS =========="
  );

  // ==================================================
  // APPLICATIONS
  // ==================================================

  trace(
    "\nApplications:"
  );

  if (
    findings.applications.length === 0
  ) {
    trace(
      "- No applications detected"
    );
  } else {
    for (
      const application of
      findings.applications
    ) {
      trace(
        `- ${application.name}`
      );

      trace(
        `  Language: ${
          application.language ||
          "Not detected"
        }`
      );

      trace(
        `  Runtime: ${
          application.runtime ||
          "Not detected"
        }`
      );

      trace(
        `  Framework: ${
          application.framework ||
          "Not detected"
        }`
      );

      if (
        Array.isArray(
          application.sourceFiles
        ) &&
        application.sourceFiles.length > 0
      ) {
        trace(
          "  Source files:"
        );

        for (
          const sourceFile of
          application.sourceFiles
        ) {
          trace(
            `    - ${sourceFile}`
          );
        }
      }
    }
  }

  // ==================================================
  // APIs
  // ==================================================

  trace(
    "\nAPIs:"
  );

  if (
    findings.apis.length === 0
  ) {
    trace(
      "- No application APIs detected"
    );
  } else {
    for (
      const api of
      findings.apis
    ) {
      trace(
        `- ${api.application}: ${api.method} ${api.path}`
      );

      trace(
        `  Framework: ${
          api.framework ||
          "Not detected"
        }`
      );

      if (api.handler) {
        trace(
          `  Handler: ${api.handler}`
        );
      }

      trace(
        `  Source: ${
          api.source ||
          "Unknown"
        }`
      );
    }
  }

  // ==================================================
  // FR-AC-005:
  // RELATIONSHIPS
  // ==================================================

  trace(
    "\nRelationships:"
  );

  if (
    findings.relationships.length === 0
  ) {
    trace(
      "- No application relationships detected"
    );
  } else {
    for (
      const relationship of
      findings.relationships
    ) {
      trace(
        `- ${relationship.from} -> ${relationship.to}`
      );

      trace(
        `  Relationship: ${
          relationship.relationship ||
          "depends_on"
        }`
      );

      trace(
        `  Application: ${
          relationship.application ||
          "Unknown"
        }`
      );

      if (
        relationship.evidence
      ) {
        trace(
          `  Evidence: ${relationship.evidence}`
        );
      }

      if (
        relationship.source
      ) {
        trace(
          `  Source: ${relationship.source}`
        );
      }

      if (
        relationship.line
      ) {
        trace(
          `  Line: ${relationship.line}`
        );
      }
    }
  }

  // ==================================================
  // COMPONENTS
  // ==================================================

  trace(
    "\nComponents:"
  );

  if (
    findings.components.length === 0
  ) {
    trace(
      "- No components detected"
    );
  } else {
    for (
      const component of
      findings.components
    ) {
      trace(
        `- ${component}`
      );
    }
  }

  // ==================================================
  // INFRASTRUCTURE
  // ==================================================

  trace(
    "\nInfrastructure:"
  );

  if (
    findings.deployment.length === 0
  ) {
    trace(
      "- No infrastructure technologies detected"
    );
  } else {
    for (
      const technology of
      findings.deployment
    ) {
      trace(
        `- ${technology}`
      );
    }
  }

  // ==================================================
  // TECHNOLOGY STACK
  // ==================================================

  trace(
    "\nLanguages:"
  );

  for (
    const language of
    findings.languages
  ) {
    trace(
      `- ${language}`
    );
  }

  trace(
    "\nFrameworks:"
  );

  for (
    const framework of
    findings.frameworks
  ) {
    trace(
      `- ${framework}`
    );
  }

  trace(
    "\nRuntimes:"
  );

  for (
    const runtime of
    findings.runtimes
  ) {
    trace(
      `- ${runtime}`
    );
  }

  trace(
    "\nArchitecture:"
  );

  trace(
    findings.architecture ||
    "Not detected"
  );

  trace(
    "\nArchitecture Score:"
  );

  trace(
    `${findings.architectureScore}/100`
  );

  trace(
    "\n=========================================\n"
  );

  // ==================================================
  // FR-AC-009:
  // GAPS & ASSUMPTIONS OUTPUT
  // ==================================================

  trace(
    "\n========== GAPS & ASSUMPTIONS =========="
  );

  // --------------------------------------------------
  // GAPS
  // --------------------------------------------------

  trace(
    "\nGaps:"
  );

  if (
    findings.gaps.length === 0
  ) {
    trace(
      "- No architecture gaps identified"
    );
  } else {
    for (
      const gap of
      findings.gaps
    ) {
      trace(
        `- ${gap.area}`
      );

      trace(
        `  Status: ${
          gap.status
        }`
      );

      trace(
        `  Reason: ${
          gap.reason
        }`
      );

      trace(
        `  Validation Required: ${
          gap.requiresValidation
            ? "Yes"
            : "No"
        }`
      );
    }
  }

  // --------------------------------------------------
  // ASSUMPTIONS
  // --------------------------------------------------

  trace(
    "\nAssumptions:"
  );

  if (
    findings.assumptions.length === 0
  ) {
    trace(
      "- No architecture assumptions identified"
    );
  } else {
    for (
      const assumption of
      findings.assumptions
    ) {
      trace(
        `- ${assumption.area}`
      );

      trace(
        `  Status: ${
          assumption.status
        }`
      );

      trace(
        `  Assumption: ${
          assumption.assumption
        }`
      );

      trace(
        `  Reason: ${
          assumption.reason
        }`
      );

      trace(
        `  Validation Required: ${
          assumption.requiresValidation
            ? "Yes"
            : "No"
        }`
      );
    }
  }

  trace(
    "\n===========================================\n"
  );

  // ==================================================
  // RETURN FINDINGS
  // ==================================================

  return findings;
}

export { scanRepository };
