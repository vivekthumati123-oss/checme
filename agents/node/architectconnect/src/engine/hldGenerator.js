// ==================================================
// ARCHITECTCONNECT HLD GENERATOR
//
// FR-AC-007: Generate High-Level Design
// FR-AC-009: Identify Gaps & Assumptions
//
// Input:
// Repository findings produced by repositoryScanner.js
//
// Supports:
//
// - Legacy architecture model
// - Dynamic projected architecture model
//
// Uses:
//
// - Applications
// - APIs
// - Components
// - Relationships
// - Technology stack
// - Infrastructure
// - Architecture pattern
// - Gaps
// - Assumptions
// - Architecture score
// - Recommendations
//
// ==================================================


function generateHLD(findings) {
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


  const backend =
    Array.isArray(
      findings.backend
    )
      ? findings.backend
      : [];


  const languages =
    Array.isArray(
      findings.languages
    )
      ? findings.languages
      : [];


  const frameworks =
    Array.isArray(
      findings.frameworks
    )
      ? findings.frameworks
      : [];


  const runtimes =
    Array.isArray(
      findings.runtimes
    )
      ? findings.runtimes
      : [];


  const buildTools =
    Array.isArray(
      findings.buildTools
    )
      ? findings.buildTools
      : [];


  const tools =
    Array.isArray(
      findings.tools
    )
      ? findings.tools
      : [];


  const applications =
    Array.isArray(
      findings.applications
    )
      ? findings.applications
      : [];


  const apis =
    Array.isArray(
      findings.apis
    )
      ? findings.apis
      : [];


  const relationships =
    Array.isArray(
      findings.relationships
    )
      ? findings.relationships
      : [];


  const components =
    Array.isArray(
      findings.components
    )
      ? findings.components
      : [];


  const deployment =
    Array.isArray(
      findings.deployment
    )
      ? findings.deployment
      : [];


  const deploymentArchitecture =
    Array.isArray(
      findings.deploymentArchitecture
    )
      ? findings.deploymentArchitecture
      : [];


  const recommendations =
    Array.isArray(
      findings.recommendations
    )
      ? findings.recommendations
      : [];


  // ==================================================
  // GAPS & ASSUMPTIONS
  // ==================================================

  const gaps =
    Array.isArray(
      findings.gaps
    )
      ? findings.gaps
      : [];


  const assumptions =
    Array.isArray(
      findings.assumptions
    )
      ? findings.assumptions
      : [];


  const architecturePattern =
    findings.architecture ||
    "Not detected";


  const architectureScore =
    typeof findings.architectureScore ===
    "number"
      ? findings.architectureScore
      : 0;


  // ==================================================
  // HELPERS
  // ==================================================

  function getApplicationDisplayName(
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


  function findApplicationById(
    applicationId
  ) {
    if (!applicationId) {
      return null;
    }

    return (
      applications.find(
        (application) =>
          application &&
          application.id ===
            applicationId
      ) ||
      null
    );
  }


  function getApplicationLabelFromId(
    applicationId
  ) {
    const application =
      findApplicationById(
        applicationId
      );

    if (application) {
      return getApplicationDisplayName(
        application
      );
    }

    return (
      applicationId ||
      "Unknown"
    );
  }


  // ==================================================
  // APPLICATION SECTION
  // ==================================================

  const applicationSection =
    applications.length > 0
      ? applications
          .map((application) => {
            if (
              !application ||
              typeof application !==
                "object"
            ) {
              return `
### Application

- Type: Not detected
- Language: Not detected
- Runtime: Not detected
- Framework: Not detected

Source Files:

- Not detected
`;
            }


            const applicationName =
              getApplicationDisplayName(
                application
              );


            // Legacy:
            // application.sourceFiles
            //
            // Dynamic:
            // application.files

            const sourceFiles =
              Array.isArray(
                application.sourceFiles
              )
                ? application.sourceFiles
                : Array.isArray(
                    application.files
                  )
                  ? application.files
                  : [];


            return `
### ${applicationName}

- Type: ${application.type || "Not detected"}
- Language: ${application.language || "Not detected"}
- Runtime: ${application.runtime || "Not detected"}
- Framework: ${application.framework || "Not detected"}

Source Files:

${
  sourceFiles.length > 0
    ? sourceFiles
        .map(
          (source) =>
            `- ${source}`
        )
        .join("\n")
    : "- Not detected"
}
`;
          })
          .join("\n")
      : "No applications detected.";


  // ==================================================
  // API SECTION
  // ==================================================

  const apiSection =
    apis.length > 0
      ? apis
          .map((api) => {
            if (
              !api ||
              typeof api !==
                "object"
            ) {
              return "- Unknown API";
            }


            // Legacy:
            // api.application
            //
            // Dynamic:
            // api.applicationId

            const applicationName =
              api.application ||
              getApplicationLabelFromId(
                api.applicationId
              );


            let result =
              `- **${applicationName}: ` +
              `${api.method || "UNKNOWN"} ` +
              `${api.path || "Unknown"}**`;


            result +=
              `\n  - Framework: ${
                api.framework ||
                "Not detected"
              }`;


            if (api.handler) {
              result +=
                `\n  - Handler: ${api.handler}`;
            }


            result +=
              `\n  - Source: ${
                api.source ||
                "Unknown"
              }`;


            return result;
          })
          .join("\n")
      : "- No APIs detected";


  // ==================================================
  // COMPONENT SECTION
  // ==================================================
  //
  // Prefer the architecture model passed directly to
  // this generator.
  //
  // This is important for dynamic projection because
  // findings.components contains the projected
  // architecture components.
  //
  // Legacy detailed analyzer components remain a
  // fallback only when projected components are not
  // available.
  //
  // ==================================================

  const nodeComponents =
    Array.isArray(
      findings.nodeAnalysis?.components
    )
      ? findings.nodeAnalysis.components
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


  const legacyDetailedComponents = [
    ...nodeComponents,
    ...pythonComponents
  ];


  const objectComponents =
    components.filter(
      (component) =>
        component &&
        typeof component ===
          "object"
    );


  const detailedComponents =
    objectComponents.length > 0
      ? objectComponents
      : legacyDetailedComponents;


  const componentSection =
    detailedComponents.length > 0
      ? detailedComponents
          .map((component) => {

            const componentApplication =
              component.application ||
              getApplicationLabelFromId(
                component.applicationId
              ) ||
              component.applicationRoot ||
              "Unknown";


            const componentResponsibility =
              component.responsibility ||
              (
                Array.isArray(
                  component.evidence
                ) &&
                component.evidence.length > 0
                  ? component.evidence.join(
                      " "
                    )
                  : "Not documented"
              );


            return `
### ${component.name || "Component"}

- Application: ${componentApplication}
- Type: ${component.type || component.role || "Unknown"}
- Responsibility: ${componentResponsibility}
- Source: ${component.source || "Unknown"}
`;
          })
          .join("\n")
      : components.length > 0
        ? components
            .map(
              (component) =>
                typeof component ===
                "string"
                  ? `- ${component}`
                  : `- ${
                      component.name ||
                      component.source ||
                      "Component"
                    }`
            )
            .join("\n")
        : "- No components detected";


  // ==================================================
  // RELATIONSHIP SECTION
  // ==================================================

  const relationshipSection =
    relationships.length > 0
      ? relationships
          .map((relationship) => {
            if (
              !relationship ||
              typeof relationship !==
                "object"
            ) {
              return "- Unknown dependency";
            }


            const applicationName =
              relationship.application ||
              getApplicationLabelFromId(
                relationship.applicationId
              );


            let result =
              `- **${relationship.from || "Unknown"} -> ` +
              `${relationship.to || "Unknown"}**`;


            result +=
              `\n  - Application: ${
                applicationName
              }`;


            result +=
              `\n  - Relationship: ${
                relationship.relationship ||
                "depends_on"
              }`;


            result +=
              `\n  - Type: ${
                relationship.type ||
                "dependency"
              }`;


            if (
              relationship.fromType
            ) {
              result +=
                `\n  - From Type: ` +
                `${relationship.fromType}`;
            }


            if (
              relationship.toType
            ) {
              result +=
                `\n  - To Type: ` +
                `${relationship.toType}`;
            }


            if (
              typeof relationship.confidence ===
              "number"
            ) {
              result +=
                `\n  - Confidence: ` +
                `${relationship.confidence}`;
            }


            if (
              relationship.evidence
            ) {
              result +=
                `\n  - Evidence: ` +
                `${relationship.evidence}`;
            }


            const source =
              relationship.source ||
              relationship.sourceFrom ||
              relationship.apiSource ||
              null;


            if (source) {
              result +=
                `\n  - Source: ${source}`;
            }


            if (
              relationship.sourceTo
            ) {
              result +=
                `\n  - Target Source: ` +
                `${relationship.sourceTo}`;
            }


            if (
              relationship.componentSource
            ) {
              result +=
                `\n  - Component Source: ` +
                `${relationship.componentSource}`;
            }


            if (
              relationship.line
            ) {
              result +=
                `\n  - Line: ` +
                `${relationship.line}`;
            }


            return result;
          })
          .join("\n")
      : "- No dependencies detected";


  // ==================================================
  // APPLICATION FLOWS
  // ==================================================
  //
  // Legacy models identify applications using:
  //
  // relationship.application
  //
  // Dynamic models identify applications using:
  //
  // relationship.applicationId
  //
  // Group flows dynamically by application identity.
  //
  // ==================================================

  const relationshipsByApplication =
    new Map();


  for (
    const relationship of
    relationships
  ) {
    if (
      !relationship ||
      typeof relationship !==
        "object"
    ) {
      continue;
    }


    const applicationKey =
      relationship.applicationId ||
      relationship.application ||
      "Unknown";


    if (
      !relationshipsByApplication.has(
        applicationKey
      )
    ) {
      relationshipsByApplication.set(
        applicationKey,
        []
      );
    }


    relationshipsByApplication
      .get(applicationKey)
      .push(relationship);
  }


  const applicationFlowSection =
    relationshipsByApplication.size > 0
      ? Array.from(
          relationshipsByApplication.entries()
        )
          .map(
            ([
              applicationKey,
              applicationRelationships
            ]) => {

              const applicationName =
                getApplicationLabelFromId(
                  applicationKey
                ) !== "Unknown"
                  ? getApplicationLabelFromId(
                      applicationKey
                    )
                  : applicationKey;


              const flows =
                applicationRelationships
                  .map(
                    (relationship) =>
                      `${relationship.from || "Unknown"} -> ` +
                      `${relationship.to || "Unknown"}`
                  )
                  .join("\n");


              return `
### ${applicationName}

${flows}
`;
            }
          )
          .join("\n")
      : "No application flows detected.";


  // ==================================================
  // INFRASTRUCTURE DETECTION
  // ==================================================

  const dockerDetected =
    deployment.includes(
      "Docker"
    );


  const kubernetesDetected =
    deployment.includes(
      "Kubernetes"
    );


  const terraformDetected =
    deployment.includes(
      "Terraform"
    );


  const bicepDetected =
    deployment.includes(
      "Bicep"
    );


  // ==================================================
  // DOCKER SECTION
  // ==================================================

  const dockerSection =
    dockerDetected
      ? `
## Container Architecture

Docker configuration was detected in the repository.

- Technology: Docker
- Architecture Characteristic: Containerized Deployment
`
      : `
## Container Architecture

Docker configuration was not detected.
`;


  // ==================================================
  // KUBERNETES SECTION
  // ==================================================

  const kubernetesSection =
    kubernetesDetected
      ? `
## Kubernetes Architecture

Kubernetes configuration was detected in the repository.

- Technology: Kubernetes
- Architecture Characteristic: Container Orchestration
`
      : `
## Kubernetes Architecture

Kubernetes configuration was not detected.
`;


  // ==================================================
  // TERRAFORM SECTION
  // ==================================================

  const terraformSection =
    terraformDetected
      ? `
## Terraform Infrastructure

Terraform Infrastructure as Code artifacts were detected in the repository.

- Technology: Terraform
- Architecture Characteristic: Infrastructure as Code
`
      : `
## Terraform Infrastructure

Terraform configuration was not detected.
`;


  // ==================================================
  // BICEP SECTION
  // ==================================================

  const bicepSection =
    bicepDetected
      ? `
## Azure Bicep Infrastructure

Azure Bicep Infrastructure as Code artifacts were detected in the repository.

- Technology: Bicep
- Architecture Characteristic: Azure Infrastructure as Code
`
      : `
## Azure Bicep Infrastructure

Bicep configuration was not detected.
`;


  // ==================================================
  // GAP SECTION
  // ==================================================

  const gapSection =
    gaps.length > 0
      ? gaps
          .map((gap) => {
            return `
### ${gap.area}

- Status: ${gap.status || "UNCLEAR"}
- Validation Required: ${
  gap.requiresValidation
    ? "Yes"
    : "No"
}
- Reason: ${
  gap.reason ||
  "No additional information available."
}
`;
          })
          .join("\n")
      : "No architecture gaps identified.";


  // ==================================================
  // ASSUMPTION SECTION
  // ==================================================

  const assumptionSection =
    assumptions.length > 0
      ? assumptions
          .map((assumption) => {
            return `
### ${assumption.area}

- Status: ${
  assumption.status ||
  "REQUIRES_VALIDATION"
}
- Validation Required: ${
  assumption.requiresValidation
    ? "Yes"
    : "No"
}
- Assumption: ${
  assumption.assumption ||
  "Not documented"
}
- Reason: ${
  assumption.reason ||
  "No additional information available."
}
`;
          })
          .join("\n")
      : "No architecture assumptions identified.";


  // ==================================================
  // TECHNOLOGY VALUES
  // ==================================================

  const frontendText =
    frontend.length > 0
      ? frontend.join(", ")
      : "Not detected";


  const backendText =
    backend.length > 0
      ? backend.join(", ")
      : "Not detected";


  const languagesText =
    languages.length > 0
      ? languages.join(", ")
      : "Not detected";


  const frameworksText =
    frameworks.length > 0
      ? frameworks.join(", ")
      : "Not detected";


  const runtimesText =
    runtimes.length > 0
      ? runtimes.join(", ")
      : findings.runtime ||
        "Not detected";


  const buildToolsText =
    buildTools.length > 0
      ? buildTools.join(", ")
      : findings.buildTool ||
        "Not detected";


  const toolsText =
    tools.length > 0
      ? tools.join(", ")
      : "Not detected";


  const infrastructureText =
    deployment.length > 0
      ? deployment.join(", ")
      : "Not detected";


  const deploymentArchitectureText =
    deploymentArchitecture.length > 0
      ? deploymentArchitecture.join(
          ", "
        )
      : "Not detected";


  // ==================================================
  // RECOMMENDATION SECTION
  // ==================================================

  const recommendationSection =
    recommendations.length > 0
      ? recommendations
          .map(
            (recommendation) =>
              `- ${recommendation}`
          )
          .join("\n")
      : "No recommendations generated";


  // ==================================================
  // FINAL HLD OUTPUT
  // ==================================================

  return `
# High Level Design

## Architecture Overview

ArchitectConnect analyzed the repository structure, application source code, dependency configuration, API definitions, component boundaries, component relationships, container configuration, deployment manifests, Infrastructure as Code artifacts, and available architecture evidence.

### Architecture Pattern

${architecturePattern}

### Architecture Summary

- Applications detected: ${applications.length}
- APIs detected: ${apis.length}
- Detailed components detected: ${
  detailedComponents.length
}
- Relationships detected: ${relationships.length}
- Infrastructure technologies detected: ${deployment.length}
- Architecture gaps identified: ${gaps.length}
- Assumptions requiring validation: ${assumptions.length}

## Technology Stack

### Frontend

${frontendText}

### Backend

${backendText}

### Languages

${languagesText}

### Frameworks

${frameworksText}

### Runtime Platforms

${runtimesText}

### Build Tools

${buildToolsText}

### Development Tools

${toolsText}

### Infrastructure

${infrastructureText}

### Deployment Architecture

${deploymentArchitectureText}

## Applications

${applicationSection}

## APIs

${apiSection}

## Application Components

${componentSection}

## Component Relationships

${relationshipSection}

## Application Flows

${applicationFlowSection}

${dockerSection}

${kubernetesSection}

${terraformSection}

${bicepSection}

## Gaps & Assumptions

ArchitectConnect distinguishes repository-confirmed architecture evidence from information that is missing, unclear, or requires architect validation.

### Identified Gaps

${gapSection}

### Architecture Assumptions

${assumptionSection}

## Architecture Score

${architectureScore}/100

> The architecture score represents the breadth of architecture evidence detected by ArchitectConnect. It does not imply that all architecture concerns are complete. Items listed under Gaps & Assumptions still require architect review.

## Recommendations

${recommendationSection}

## Architecture Assessment

The repository exhibits the following detected architecture characteristics:

- Architecture Pattern: ${architecturePattern}
- Frontend Technologies: ${frontendText}
- Backend Technologies: ${backendText}
- Languages: ${languagesText}
- Frameworks: ${frameworksText}
- Runtime Platforms: ${runtimesText}
- Build Tools: ${buildToolsText}
- Containerization: ${
    dockerDetected
      ? "Docker"
      : "Not detected"
  }
- Container Orchestration: ${
    kubernetesDetected
      ? "Kubernetes"
      : "Not detected"
  }
- Terraform: ${
    terraformDetected
      ? "Detected"
      : "Not detected"
  }
- Azure Bicep: ${
    bicepDetected
      ? "Detected"
      : "Not detected"
  }
- Applications Detected: ${applications.length}
- APIs Detected: ${apis.length}
- Detailed Components Detected: ${
    detailedComponents.length
  }
- Relationships Detected: ${relationships.length}
- Architecture Gaps Identified: ${gaps.length}
- Assumptions Requiring Validation: ${assumptions.length}

## Repository-Derived Architecture

${applicationFlowSection}

## Validation Required

${
  gaps.length > 0 ||
  assumptions.length > 0
    ? `Architect review is required for ${gaps.length} identified architecture gap(s) and ${assumptions.length} documented assumption(s).`
    : "No additional architect validation items were identified from the analyzed repository evidence."
}

This High-Level Design is generated from repository-derived architecture evidence identified by ArchitectConnect.
`;
}


// ==================================================
// EXPORT
// ==================================================

export { generateHLD };
