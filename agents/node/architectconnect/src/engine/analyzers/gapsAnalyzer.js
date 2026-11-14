// ==================================================
// ARCHITECTCONNECT GAP & ASSUMPTION ANALYZER
// FR-AC-009
//
// Purpose:
//
// Identify architecture information that is:
//
// - Missing
// - Unclear
// - Requiring architect validation
//
// IMPORTANT:
//
// This analyzer does NOT invent technologies.
//
// Example:
//
// If no database evidence exists:
//
// Database = MISSING
//
// It must NOT assume:
//
// PostgreSQL
// MySQL
// MongoDB
//
// ==================================================

function analyzeGaps(findings) {
  const gaps = [];
  const assumptions = [];

  // ==================================================
  // SAFETY
  // ==================================================

  if (
    !findings ||
    typeof findings !== "object"
  ) {
    return {
      gaps,
      assumptions
    };
  }

  // ==================================================
  // NORMALIZE FINDINGS
  // ==================================================

  const frontend =
    Array.isArray(findings.frontend)
      ? findings.frontend
      : [];

  const backend =
    Array.isArray(findings.backend)
      ? findings.backend
      : [];

  const frameworks =
    Array.isArray(findings.frameworks)
      ? findings.frameworks
      : [];

  const applications =
    Array.isArray(findings.applications)
      ? findings.applications
      : [];

  const apis =
    Array.isArray(findings.apis)
      ? findings.apis
      : [];

  const relationships =
    Array.isArray(findings.relationships)
      ? findings.relationships
      : [];

  const deployment =
    Array.isArray(findings.deployment)
      ? findings.deployment
      : [];

  const tools =
    Array.isArray(findings.tools)
      ? findings.tools
      : [];

  // ==================================================
  // BUILD SEARCHABLE EVIDENCE
  // ==================================================

  const evidenceParts = [];

  function addEvidence(value) {
    if (
      value !== null &&
      value !== undefined
    ) {
      evidenceParts.push(
        String(value)
      );
    }
  }

  // --------------------------------------------------
  // Technology evidence
  // --------------------------------------------------

  frontend.forEach(addEvidence);
  backend.forEach(addEvidence);
  frameworks.forEach(addEvidence);
  deployment.forEach(addEvidence);
  tools.forEach(addEvidence);

  // --------------------------------------------------
  // Application evidence
  // --------------------------------------------------

  for (const application of applications) {
    if (!application) {
      continue;
    }

    addEvidence(application.name);
    addEvidence(application.type);
    addEvidence(application.language);
    addEvidence(application.runtime);
    addEvidence(application.framework);

    if (
      Array.isArray(
        application.sourceFiles
      )
    ) {
      application.sourceFiles.forEach(
        addEvidence
      );
    }
  }

  // --------------------------------------------------
  // API evidence
  // --------------------------------------------------

  for (const api of apis) {
    if (!api) {
      continue;
    }

    addEvidence(api.application);
    addEvidence(api.framework);
    addEvidence(api.method);
    addEvidence(api.path);
    addEvidence(api.handler);
    addEvidence(api.source);
  }

  // --------------------------------------------------
  // Relationship evidence
  // --------------------------------------------------

  for (
    const relationship of
    relationships
  ) {
    if (!relationship) {
      continue;
    }

    addEvidence(
      relationship.from
    );

    addEvidence(
      relationship.to
    );

    addEvidence(
      relationship.fromType
    );

    addEvidence(
      relationship.toType
    );

    addEvidence(
      relationship.application
    );

    addEvidence(
      relationship.type
    );

    addEvidence(
      relationship.relationship
    );

    addEvidence(
      relationship.evidence
    );

    addEvidence(
      relationship.source
    );
  }

  // --------------------------------------------------
  // Node component evidence
  // --------------------------------------------------

  const nodeComponents =
    Array.isArray(
      findings.nodeAnalysis?.components
    )
      ? findings.nodeAnalysis.components
      : [];

  for (
    const component of
    nodeComponents
  ) {
    if (!component) {
      continue;
    }

    addEvidence(component.name);
    addEvidence(component.type);
    addEvidence(
      component.responsibility
    );
    addEvidence(component.source);
  }

  // --------------------------------------------------
  // Python component evidence
  // --------------------------------------------------

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

  for (
    const component of
    pythonComponents
  ) {
    if (!component) {
      continue;
    }

    addEvidence(component.name);
    addEvidence(component.type);
    addEvidence(
      component.responsibility
    );
    addEvidence(component.source);
  }

  const searchableEvidence =
    evidenceParts
      .join("\n")
      .toLowerCase();

  // ==================================================
  // HELPER: CHECK EVIDENCE
  // ==================================================

  function hasAnyEvidence(
    keywords
  ) {
    return keywords.some(
      (keyword) =>
        searchableEvidence.includes(
          keyword.toLowerCase()
        )
    );
  }

  // ==================================================
  // HELPER: ADD GAP
  // ==================================================

  function addGap(
    area,
    status,
    reason
  ) {
    gaps.push({
      area,
      status,
      reason,
      requiresValidation: true
    });
  }

  // ==================================================
  // HELPER: ADD ASSUMPTION
  // ==================================================

  function addAssumption(
    area,
    assumption,
    reason
  ) {
    assumptions.push({
      area,
      status:
        "REQUIRES_VALIDATION",

      assumption,

      reason,

      requiresValidation:
        true
    });
  }

  // ==================================================
  // GAP 1: DATABASE
  // ==================================================

  const hasDatabaseEvidence =
    hasAnyEvidence([
      "postgres",
      "postgresql",
      "mysql",
      "mariadb",
      "mongodb",
      "mongoose",
      "sqlite",
      "sql server",
      "mssql",
      "oracle",
      "dynamodb",
      "cosmos",
      "database",
      "sequelize",
      "typeorm",
      "prisma",
      "sqlalchemy"
    ]);

  if (!hasDatabaseEvidence) {
    addGap(
      "Database",
      "MISSING",
      "No database technology or explicit database integration was identified from the analyzed repository evidence."
    );
  }

  // ==================================================
  // GAP 2: AUTHENTICATION
  // ==================================================

  const hasAuthenticationEvidence =
    hasAnyEvidence([
      "authentication",
      "authenticate",
      "passport",
      "jwt",
      "jsonwebtoken",
      "oauth",
      "openid",
      "oidc",
      "msal",
      "auth0",
      "login"
    ]);

  if (
    !hasAuthenticationEvidence
  ) {
    addGap(
      "Authentication",
      "MISSING",
      "No explicit authentication mechanism was identified from the analyzed repository evidence."
    );
  }

  // ==================================================
  // GAP 3: AUTHORIZATION
  // ==================================================

  const hasAuthorizationEvidence =
    hasAnyEvidence([
      "authorization",
      "authorize",
      "role",
      "roles",
      "rbac",
      "permission",
      "permissions",
      "access control"
    ]);

  if (
    !hasAuthorizationEvidence
  ) {
    addGap(
      "Authorization",
      "MISSING",
      "No explicit authorization, role, permission, or access-control mechanism was identified."
    );
  }

  // ==================================================
  // GAP 4: CACHING
  // ==================================================

  const hasCachingEvidence =
    hasAnyEvidence([
      "redis",
      "memcached",
      "cache",
      "caching"
    ]);

  if (!hasCachingEvidence) {
    addGap(
      "Caching",
      "MISSING",
      "No explicit caching technology or caching implementation was identified."
    );
  }

  // ==================================================
  // GAP 5: MESSAGING
  // ==================================================

  const hasMessagingEvidence =
    hasAnyEvidence([
      "kafka",
      "rabbitmq",
      "service bus",
      "servicebus",
      "event hub",
      "eventhub",
      "sqs",
      "sns",
      "pubsub",
      "message broker",
      "queue"
    ]);

  if (!hasMessagingEvidence) {
    addGap(
      "Messaging",
      "MISSING",
      "No message broker, event-streaming platform, or queue-based integration was identified."
    );
  }

  // ==================================================
  // GAP 6: OBSERVABILITY
  // ==================================================

  const hasObservabilityEvidence =
    hasAnyEvidence([
      "opentelemetry",
      "application insights",
      "appinsights",
      "prometheus",
      "grafana",
      "datadog",
      "new relic",
      "newrelic",
      "logging",
      "logger",
      "monitoring",
      "telemetry",
      "tracing"
    ]);

  if (
    !hasObservabilityEvidence
  ) {
    addGap(
      "Observability",
      "MISSING",
      "No explicit logging, monitoring, tracing, telemetry, or observability platform was identified."
    );
  }

  // ==================================================
  // GAP 7: SECRETS MANAGEMENT
  // ==================================================

  const hasSecretsEvidence =
    hasAnyEvidence([
      "key vault",
      "keyvault",
      "vault",
      "secret manager",
      "secretsmanager",
      "secret",
      "managed identity"
    ]);

  if (!hasSecretsEvidence) {
    addGap(
      "Secrets Management",
      "MISSING",
      "No explicit secrets-management technology or managed secret store was identified."
    );
  }

  // ==================================================
  // GAP 8: EXTERNAL INTEGRATIONS
  // ==================================================

  const hasExternalIntegration =
    relationships.some(
      (relationship) =>
        relationship &&
        (
          relationship.toType ===
            "external_system" ||
          relationship.fromType ===
            "external_system" ||
          relationship.type ===
            "external_dependency"
        )
    );

  if (
    !hasExternalIntegration
  ) {
    addGap(
      "External Integrations",
      "UNCLEAR",
      "No explicit external-system dependency was identified. Architect validation is required to confirm whether external services or third-party APIs are used."
    );
  }

  // ==================================================
  // ASSUMPTION 1:
  // FRONTEND -> BACKEND
  // ==================================================

  const hasFrontend =
    frontend.length > 0;

  const hasBackendApplication =
    applications.some(
      (application) =>
        application &&
        application.type ===
          "backend"
    );

  const explicitFrontendRelationship =
    relationships.some(
      (relationship) =>
        relationship &&
        (
          relationship.fromType ===
            "frontend" ||
          relationship.toType ===
            "frontend"
        )
    );

  if (
    hasFrontend &&
    hasBackendApplication &&
    !explicitFrontendRelationship
  ) {
    addAssumption(
      "Frontend Integration",
      "The detected frontend is assumed to communicate with one or more detected backend applications.",
      "Frontend and backend technologies were detected, but no explicit frontend-to-backend source dependency was established by the current analyzers."
    );
  }

  // ==================================================
  // ASSUMPTION 2:
  // DEPLOYMENT ASSOCIATION
  // ==================================================

  if (
    deployment.length > 0 &&
    applications.length > 1
  ) {
    addAssumption(
      "Deployment Mapping",
      "Detected deployment technologies are assumed to support one or more of the detected applications.",
      "Infrastructure technologies were detected at repository level, but the current analysis does not conclusively map every deployment artifact to a specific application."
    );
  }

  // ==================================================
  // ASSUMPTION 3:
  // REPOSITORY-ONLY ANALYSIS
  // ==================================================

  addAssumption(
    "Repository Evidence Scope",
    "The architecture assessment represents architecture evidence available in the analyzed repository.",
    "Runtime configuration, manually provisioned infrastructure, external platform configuration, and undocumented operational dependencies may exist outside the repository."
  );

  // ==================================================
  // RETURN FR-AC-009
  // ==================================================

  return {
    gaps,
    assumptions
  };
}

export { analyzeGaps };
