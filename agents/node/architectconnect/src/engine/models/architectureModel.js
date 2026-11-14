function buildArchitectureModel(findings) {
  return {
    application: {
      architecture:
        findings.architecture || "Unknown",

      frontend: {
        technology:
          findings.frontend?.[0] || "Unknown"
      },

      backend: {
        technology:
          findings.backend?.[0] || "Unknown",

        runtime:
          findings.runtime || "Unknown"
      },

      buildTool:
        findings.buildTool || "Unknown",

      tools:
        findings.tools || [],

      components:
        findings.components || []
    },

    containerization: {
      technology:
        findings.infrastructure?.docker?.detected
          ? "Docker"
          : "Not detected",

      baseImages:
        findings.infrastructure?.docker?.baseImages || [],

      exposedPorts:
        findings.infrastructure?.docker?.exposedPorts || [],

      commands:
        findings.infrastructure?.docker?.commands || [],

      workdir:
        findings.infrastructure?.docker?.workdir || "",

      entrypoint:
        findings.infrastructure?.docker?.entrypoint || ""
    },

    deployment: {
      technology:
        findings.infrastructure?.kubernetes?.detected
          ? "Kubernetes"
          : "Not detected",

      deployments:
        findings.infrastructure?.kubernetes?.deployments || [],

      services:
        findings.infrastructure?.kubernetes?.services || []
    },

    infrastructure: {
      terraform: {
        detected:
          findings.infrastructure?.terraform?.detected || false,

        providers:
          findings.infrastructure?.terraform?.providers || [],

        resources:
          findings.infrastructure?.terraform?.resources || []
      },

      bicep: {
        detected:
          findings.infrastructure?.bicep?.detected || false,

        resources:
          findings.infrastructure?.bicep?.resources || []
      }
    },

    assessment: {
      score:
        findings.architectureScore || 0,

      recommendations:
        findings.recommendations || []
    }
  };
}

export { buildArchitectureModel };
