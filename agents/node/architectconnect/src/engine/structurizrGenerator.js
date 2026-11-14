// ==================================================
// ARCHITECTCONNECT STRUCTURIZR GENERATOR
// FR-AC-008
//
// Generates repository-derived architecture using:
//
// - Applications
// - Components
// - Dependencies
// - Technology stack
// - Infrastructure
//
// Supports:
//
// - Legacy architecture model
// - Dynamic projected architecture model
//
// ==================================================


// ==================================================
// SANITIZE STRUCTURIZR IDENTIFIER
// ==================================================

function sanitizeId(value) {
  let result =
    String(value || "")
      .replace(
        /[^A-Za-z0-9_]/g,
        "_"
      )
      .replace(
        /_+/g,
        "_"
      )
      .replace(
        /^_|_$/g,
        ""
      );

  if (!result) {
    result = "element";
  }

  if (
    /^[0-9]/.test(result)
  ) {
    result =
      `element_${result}`;
  }

  return result;
}


// ==================================================
// ESCAPE STRUCTURIZR TEXT
// ==================================================

function escapeDsl(value) {
  return String(
    value || ""
  )
    .replace(
      /\\/g,
      "\\\\"
    )
    .replace(
      /"/g,
      '\\"'
    )
    .replace(
      /\r?\n/g,
      " "
    );
}


// ==================================================
// FIND LEGACY DETAILED COMPONENTS
// ==================================================

function getLegacyDetailedComponents(
  findings
) {
  const nodeComponents =
    Array.isArray(
      findings
        .nodeAnalysis
        ?.components
    )
      ? findings
          .nodeAnalysis
          .components
      : [];


  const pythonComponents =
    Array.isArray(
      findings
        .pythonApplicationAnalysis
        ?.components
    )
      ? findings
          .pythonApplicationAnalysis
          .components
      : [];


  return [
    ...nodeComponents,
    ...pythonComponents
  ];
}


// ==================================================
// GET COMPONENTS
// ==================================================
//
// Dynamic architecture passes component objects
// directly through findings.components.
//
// Legacy architecture historically stores simplified
// component names in findings.components and detailed
// objects inside language analyzers.
//
// Prefer dynamic object components when available.
// Otherwise use legacy detailed components.
//
// ==================================================

function getComponents(
  findings
) {
  const directComponents =
    Array.isArray(
      findings.components
    )
      ? findings.components
      : [];


  const objectComponents =
    directComponents.filter(
      (component) =>
        component &&
        typeof component ===
          "object"
    );


  if (
    objectComponents.length > 0
  ) {
    return objectComponents;
  }


  return getLegacyDetailedComponents(
    findings
  );
}


// ==================================================
// MAIN STRUCTURIZR GENERATOR
// ==================================================

function generateStructurizr(
  findings
) {
  // ==================================================
  // SAFETY
  // ==================================================

  if (
    !findings ||
    typeof findings !== "object"
  ) {
    findings = {};
  }


  // ==================================================
  // NORMALIZE FINDINGS
  // ==================================================

  const frontend =
    Array.isArray(
      findings.frontend
    )
      ? findings.frontend
      : [];


  const applications =
    Array.isArray(
      findings.applications
    )
      ? findings.applications
      : [];


  const relationships =
    Array.isArray(
      findings.relationships
    )
      ? findings.relationships
      : [];


  const deployment =
    Array.isArray(
      findings.deployment
    )
      ? findings.deployment
      : [];


  const components =
    getComponents(
      findings
    );


  const architecture =
    findings.architecture ||
    "Repository Architecture";


  // ==================================================
  // APPLICATION IDENTITY HELPERS
  // ==================================================
  //
  // Legacy:
  //
  // application.name
  // component.application
  // relationship.application
  //
  // Dynamic:
  //
  // application.id
  // application.root
  // component.applicationId
  // relationship.applicationId
  //
  // ==================================================

  function getApplicationKey(
    application
  ) {
    if (
      !application ||
      typeof application !== "object"
    ) {
      return null;
    }


    return (
      application.id ||
      application.name ||
      application.root ||
      null
    );
  }


  function getApplicationName(
    application
  ) {
    if (
      !application ||
      typeof application !== "object"
    ) {
      return "Application";
    }


    return (
      application.name ||
      application.root ||
      application.id ||
      "Application"
    );
  }


  function getItemApplicationKey(
    item
  ) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      return null;
    }


    return (
      item.applicationId ||
      item.application ||
      item.applicationRoot ||
      null
    );
  }


  // ==================================================
  // APPLICATION LOOKUP
  // ==================================================
  //
  // Used for resolving aliases between:
  //
  // id
  // root
  // legacy display name
  //
  // ==================================================

  const applicationKeyAliases =
    new Map();


  for (
    const application of
    applications
  ) {
    if (!application) {
      continue;
    }


    const applicationKey =
      getApplicationKey(
        application
      );


    if (!applicationKey) {
      continue;
    }


    applicationKeyAliases.set(
      applicationKey,
      applicationKey
    );


    if (
      application.id
    ) {
      applicationKeyAliases.set(
        application.id,
        applicationKey
      );
    }


    if (
      application.name
    ) {
      applicationKeyAliases.set(
        application.name,
        applicationKey
      );
    }


    if (
      application.root
    ) {
      applicationKeyAliases.set(
        application.root,
        applicationKey
      );
    }
  }


  function resolveApplicationKey(
    value
  ) {
    if (!value) {
      return null;
    }


    return (
      applicationKeyAliases.get(
        value
      ) ||
      value
    );
  }


  // ==================================================
  // ELEMENT REGISTRY
  // ==================================================
  //
  // The application key is part of the element key.
  //
  // This prevents collisions such as:
  //
  // Express User Service
  //
  // and:
  //
  // FastAPI User Service
  //
  // ==================================================

  const elementIds =
    new Map();


  function registerElement(
    application,
    name,
    id
  ) {
    const applicationKey =
      resolveApplicationKey(
        application
      ) ||
      application;


    const key =
      `${applicationKey}::${name}`;


    elementIds.set(
      key,
      id
    );
  }


  function findElementId(
    application,
    name
  ) {
    const applicationKey =
      resolveApplicationKey(
        application
      ) ||
      application;


    return elementIds.get(
      `${applicationKey}::${name}`
    );
  }


  // ==================================================
  // MODEL CONTENT
  // ==================================================

  let modelElements =
    "";


  let modelRelationships =
    "";


  // ==================================================
  // USER
  // ==================================================

  modelElements += `
        user = person "Application User" {
            description "User of the analyzed application"
            tags "Person"
        }
`;


  // ==================================================
  // SOFTWARE SYSTEM
  // ==================================================

  modelElements += `
        application = softwareSystem "${escapeDsl(
          architecture
        )} Application" {
`;


  // ==================================================
  // LEGACY FRONTEND CONTAINER
  // ==================================================
  //
  // Preserve the current frontend representation for
  // backward compatibility.
  //
  // Dynamic frontend applications may additionally
  // appear in the application containers collection.
  //
  // ==================================================

  let frontendId =
  null;


// ==================================================
// FIND DYNAMIC FRONTEND APPLICATION
// ==================================================

const frontendApplication =
  applications.find(
    (applicationItem) =>
      applicationItem &&
      applicationItem.type ===
        "frontend"
  );


// ==================================================
// LEGACY FRONTEND CONTAINER
// ==================================================
//
// Only create the synthetic frontend container when
// no explicit frontend application was discovered.
//
// ==================================================

if (
  !frontendApplication &&
  frontend.length > 0
) {
  const frontendName =
    `${frontend.join(", ")} Frontend`;

  frontendId =
    "frontend";

  modelElements += `
            ${frontendId} = container "${escapeDsl(
              frontendName
            )}" {
                description "Frontend application detected from repository dependencies"
                technology "${escapeDsl(
                  frontend.join(", ")
                )}"
                tags "Frontend"
            }
  `;
}


  // ==================================================
  // APPLICATION CONTAINERS
  // ==================================================

  const applicationIds =
    new Map();


  for (
    const applicationItem of
    applications
  ) {
    if (
      !applicationItem
    ) {
      continue;
    }


    const applicationKey =
      getApplicationKey(
        applicationItem
      );


    const applicationName =
      getApplicationName(
        applicationItem
      );


    if (
      !applicationKey
    ) {
      continue;
    }


    const containerId =
      sanitizeId(
        applicationKey
      ).toLowerCase();


    // ==================================================
    // REGISTER APPLICATION ALIASES
    // ==================================================

    applicationIds.set(
      applicationKey,
      containerId
    );


    if (
      applicationItem.id
    ) {
      applicationIds.set(
        applicationItem.id,
        containerId
      );
    }


    if (
      applicationItem.name
    ) {
      applicationIds.set(
        applicationItem.name,
        containerId
      );
    }


    if (
      applicationItem.root
    ) {
      applicationIds.set(
        applicationItem.root,
        containerId
      );
    }


    const technologyParts = [
      applicationItem.framework,
      applicationItem.runtime,
      applicationItem.language
    ].filter(Boolean);


    const technology =
      [
        ...new Set(
          technologyParts
        )
      ].join(", ");


    const applicationTag =
      applicationItem.type ===
        "frontend"
        ? "Frontend"
        : "Application";


    modelElements += `
            ${containerId} = container "${escapeDsl(
              applicationName
            )}" {
                description "${escapeDsl(
                  `${applicationName} application detected from repository source`
                )}"
                technology "${escapeDsl(
                  technology ||
                  "Not detected"
                )}"
                tags "${applicationTag}"
`;

// ==================================================
// RESOLVE DYNAMIC FRONTEND CONTAINER
// ==================================================

if (
  frontendApplication
) {
  const frontendApplicationKey =
    getApplicationKey(
      frontendApplication
    );

  frontendId =
    applicationIds.get(
      frontendApplicationKey
    ) ||
    null;
}
    // ==================================================
    // COMPONENTS WITHIN APPLICATION
    // ==================================================

    const applicationComponents =
      components.filter(
        (component) => {
          if (!component) {
            return false;
          }


          const rawComponentApplicationKey =
            getItemApplicationKey(
              component
            );


          const componentApplicationKey =
            resolveApplicationKey(
              rawComponentApplicationKey
            );


          if (
            componentApplicationKey ===
            applicationKey
          ) {
            return true;
          }


          // --------------------------------------------
          // Legacy compatibility
          // --------------------------------------------

          return (
            component.application &&
            component.application ===
              applicationName
          );
        }
      );


    for (
      const component of
      applicationComponents
    ) {
      const componentName =
        component.name ||
        component.source ||
        "Component";


      const componentId =
        sanitizeId(
          `${applicationKey}_${componentName}`
        ).toLowerCase();


      registerElement(
        applicationKey,
        componentName,
        componentId
      );


      // ==================================================
      // REGISTER LEGACY/DISPLAY ALIASES
      // ==================================================

      if (
        applicationName !==
        applicationKey
      ) {
        registerElement(
          applicationName,
          componentName,
          componentId
        );
      }


      if (
        applicationItem.id
      ) {
        registerElement(
          applicationItem.id,
          componentName,
          componentId
        );
      }


      if (
        applicationItem.root
      ) {
        registerElement(
          applicationItem.root,
          componentName,
          componentId
        );
      }


      const componentDescription =
        component.responsibility ||
        (
          Array.isArray(
            component.evidence
          ) &&
          component.evidence.length > 0
            ? component.evidence.join(
                " "
              )
            : "Repository-derived application component"
        );


      modelElements += `
                ${componentId} = component "${escapeDsl(
                  componentName
                )}" {
                    description "${escapeDsl(
                      componentDescription
                    )}"
                    technology "${escapeDsl(
                      component.type ||
                      component.role ||
                      "Component"
                    )}"
                    tags "Component"
                }
`;
    }


    modelElements += `
            }
`;
  }


  // ==================================================
  // CLOSE SOFTWARE SYSTEM
  // ==================================================

  modelElements += `
        }
`;


  // ==================================================
  // INFRASTRUCTURE DETECTION
  // ==================================================

  const hasDocker =
    deployment.includes(
      "Docker"
    );


  const hasKubernetes =
    deployment.includes(
      "Kubernetes"
    );


  const hasTerraform =
    deployment.includes(
      "Terraform"
    );


  const hasBicep =
    deployment.includes(
      "Bicep"
    );


  // ==================================================
  // DOCKER
  // ==================================================

  if (hasDocker) {
    modelElements += `
        docker = softwareSystem "Docker" {
            description "Containerization technology detected from repository artifacts"
            tags "Deployment"
        }
`;
  }


  // ==================================================
  // KUBERNETES
  // ==================================================

  if (hasKubernetes) {
    modelElements += `
        kubernetes = softwareSystem "Kubernetes" {
            description "Container orchestration technology detected from repository manifests"
            tags "Deployment"
        }
`;
  }


  // ==================================================
  // TERRAFORM
  // ==================================================

  if (hasTerraform) {
    modelElements += `
        terraform = softwareSystem "Terraform Infrastructure" {
            description "Infrastructure as Code detected from Terraform artifacts"
            tags "Infrastructure"
        }
`;
  }


  // ==================================================
  // BICEP
  // ==================================================

  if (hasBicep) {
    modelElements += `
        bicep = softwareSystem "Azure Bicep Infrastructure" {
            description "Azure Infrastructure as Code detected from Bicep artifacts"
            tags "Infrastructure"
        }
`;
  }


  // ==================================================
  // USER -> FRONTEND
  // ==================================================

  if (frontendId) {
    modelRelationships += `
        user -> ${frontendId} "Uses"
`;
  }


  // ==================================================
  // API RELATIONSHIP TRACKING
  // ==================================================

  const applicationsWithApiRelationships =
    new Set();


  // ==================================================
  // APPLICATION TYPE LOOKUP
  // ==================================================

  function findApplication(
    applicationKey
  ) {
    const resolvedKey =
      resolveApplicationKey(
        applicationKey
      );


    return (
      applications.find(
        (applicationItem) =>
          applicationItem &&
          getApplicationKey(
            applicationItem
          ) ===
            resolvedKey
      ) ||
      null
    );
  }


  // ==================================================
  // FR-AC-005 RELATIONSHIPS
  // ==================================================

  for (
    const relationship of
    relationships
  ) {
    if (
      !relationship
    ) {
      continue;
    }


    const rawApplicationKey =
      getItemApplicationKey(
        relationship
      );


    const applicationKey =
      resolveApplicationKey(
        rawApplicationKey
      );


    const applicationId =
      applicationIds.get(
        applicationKey
      );


    if (
      !applicationId
    ) {
      continue;
    }


    // ==================================================
    // RELATIONSHIP LABEL
    // ==================================================

    const relationshipLabel =
      relationship.relationship ===
      "handled_by"
        ? "Handled by"
        : relationship.relationship ===
            "uses"
          ? "Uses"
          : (
              relationship.relationship ||
              "Depends on"
            );


    // ==================================================
    // API -> COMPONENT
    // ==================================================
    //
    // Structurizr does not allow a parent container
    // to have a relationship directly to its own
    // component.
    //
    // Therefore, when a frontend is available, expose
    // the API interaction from the frontend to the
    // discovered request-handler component.
    //
    // ==================================================

    if (
      relationship.fromType ===
        "api" &&
      relationship.to
    ) {
      const targetId =
        findElementId(
          applicationKey,
          relationship.to
        );


      if (
        !targetId
      ) {
        continue;
      }


      if (
        frontendId
      ) {
        modelRelationships += `
        ${frontendId} -> ${targetId} "${escapeDsl(
          relationship.from
        )}"
`;


        applicationsWithApiRelationships.add(
          applicationKey
        );
      }


      continue;
    }


    // ==================================================
    // COMPONENT -> COMPONENT
    // ==================================================

    const fromId =
      findElementId(
        applicationKey,
        relationship.from
      );


    const toId =
      findElementId(
        applicationKey,
        relationship.to
      );


    if (
      !fromId ||
      !toId
    ) {
      continue;
    }


    modelRelationships += `
        ${fromId} -> ${toId} "${escapeDsl(
          relationshipLabel
        )}"
`;
  }


  // ==================================================
  // FALLBACK FRONTEND -> APPLICATION
  // ==================================================
  //
  // Only generate a generic frontend-to-application
  // relationship when no precise API relationship was
  // discovered for that application.
  //
  // Do not generate frontend -> frontend relationships.
  //
  // ==================================================

  if (
    frontendId
  ) {
    for (
      const applicationItem of
      applications
    ) {
      if (
        !applicationItem
      ) {
        continue;
      }


      const applicationKey =
        getApplicationKey(
          applicationItem
        );


      if (
        !applicationKey
      ) {
        continue;
      }


      const applicationId =
        applicationIds.get(
          applicationKey
        );


      if (
        !applicationId
      ) {
        continue;
      }


      if (
        applicationItem.type ===
        "frontend"
      ) {
        continue;
      }


      if (
        applicationsWithApiRelationships.has(
          applicationKey
        )
      ) {
        continue;
      }


      modelRelationships += `
        ${frontendId} -> ${applicationId} "Calls API"
`;
    }
  }


  // ==================================================
  // APPLICATION -> DOCKER
  // ==================================================

  if (
    hasDocker
  ) {
    for (
      const applicationItem of
      applications
    ) {
      if (
        !applicationItem
      ) {
        continue;
      }


      const applicationKey =
        getApplicationKey(
          applicationItem
        );


      if (
        !applicationKey
      ) {
        continue;
      }


      const appId =
        applicationIds.get(
          applicationKey
        );


      if (
        !appId
      ) {
        continue;
      }


      modelRelationships += `
        ${appId} -> docker "Packaged as"
`;
    }
  }


  // ==================================================
  // DOCKER -> KUBERNETES
  // ==================================================

  if (
    hasDocker &&
    hasKubernetes
  ) {
    modelRelationships += `
        docker -> kubernetes "Deployed to"
`;
  }


  // ==================================================
  // TERRAFORM -> KUBERNETES
  // ==================================================

  if (
    hasTerraform &&
    hasKubernetes
  ) {
    modelRelationships += `
        terraform -> kubernetes "Provisions supporting infrastructure"
`;
  }


  // ==================================================
  // BICEP -> KUBERNETES
  // ==================================================

  if (
    hasBicep &&
    hasKubernetes
  ) {
    modelRelationships += `
        bicep -> kubernetes "Defines Azure infrastructure"
`;
  }


  // ==================================================
  // COMPONENT VIEW GENERATION
  // ==================================================

  let componentViews =
    "";


  for (
    const applicationItem of
    applications
  ) {
    if (
      !applicationItem
    ) {
      continue;
    }


    const applicationKey =
      getApplicationKey(
        applicationItem
      );


    if (
      !applicationKey
    ) {
      continue;
    }


    const applicationId =
      applicationIds.get(
        applicationKey
      );


    if (
      !applicationId
    ) {
      continue;
    }


    const applicationName =
      getApplicationName(
        applicationItem
      );


    const applicationComponents =
      components.filter(
        (component) => {
          if (
            !component
          ) {
            return false;
          }


          const rawComponentApplicationKey =
            getItemApplicationKey(
              component
            );


          const componentApplicationKey =
            resolveApplicationKey(
              rawComponentApplicationKey
            );


          if (
            componentApplicationKey ===
            applicationKey
          ) {
            return true;
          }


          return (
            component.application &&
            component.application ===
              applicationName
          );
        }
      );


    if (
      applicationComponents.length ===
      0
    ) {
      continue;
    }


    const viewKey =
      sanitizeId(
        `${applicationKey}_Components`
      );


    componentViews += `
        component ${applicationId} "${viewKey}" {
            include *
            autoLayout
        }
`;
  }


  // ==================================================
  // STRUCTURIZR DSL
  // ==================================================

  return `
workspace "ArchitectConnect Architecture" {

    model {

${modelElements}

${modelRelationships}

    }

    views {

        systemContext application "SystemContext" {
            include *
            autoLayout
        }

        container application "ApplicationContainers" {
            include *
            autoLayout
        }

${componentViews}

        systemLandscape "DeploymentInfrastructure" {
            include *
            autoLayout
        }

        styles {

            element "Person" {
                shape person
                background #08427B
                color #ffffff
            }

            element "Frontend" {
                background #6B5B95
                color #ffffff
            }

            element "Application" {
                background #438DD5
                color #ffffff
            }

            element "Component" {
                background #85BB65
                color #000000
            }

            element "Deployment" {
                background #5D8AA8
                color #ffffff
            }

            element "Infrastructure" {
                background #999999
                color #ffffff
            }
        }
    }
}
`;
}


// ==================================================
// EXPORT
// ==================================================

export { generateStructurizr };
