function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function validateDynamicProjection(projection) {
  if (!projection || typeof projection !== "object") return "Dynamic architecture projection is missing.";
  const applications = safeArray(projection.applications);
  const apis = safeArray(projection.apis);
  const components = safeArray(projection.components);
  const relationships = safeArray(projection.relationships);
  if (!applications.length) return "Dynamic architecture contains no applications.";
  if (!components.length) return "Dynamic architecture contains no components.";
  if (
  applications.some(
    (application) =>
      !application ||
      !application.id ||
      application.root === undefined ||
      application.root === null
  )
) {
  return "One or more dynamic applications are incomplete.";
}
  if (components.some((component) => !component || !component.name || !component.type || !component.applicationId)) {
    return "One or more dynamic components are incomplete.";
  }
  if (apis.some((api) => !api || !api.applicationId || !api.method || !api.path)) {
    return "One or more dynamic APIs are incomplete.";
  }
  if (!relationships.length) return "No architecture relationships were available.";
  if (relationships.some((relationship) => !relationship || !relationship.from || !relationship.to || !relationship.relationship)) {
    return "One or more architecture relationships are incomplete.";
  }
  const applicationIds = new Set(applications.map((application) => application.id).filter(Boolean));
  if (relationships.some((relationship) => relationship.applicationId && !applicationIds.has(relationship.applicationId))) {
    return "A dynamic relationship references an unknown application.";
  }
  return null;
}

export function selectArchitecture({ projection = null, legacy = null } = {}) {
  const reason = validateDynamicProjection(projection);
  if (!reason) {
    return {
      source: "dynamic", fallbackUsed: false, valid: true,
      reason: "Dynamic architecture projection passed validation.", architecture: projection,
    };
  }
  const model = legacy && typeof legacy === "object" ? legacy : {};
  return {
    source: "legacy", fallbackUsed: true, valid: true, reason,
    architecture: {
      applications: safeArray(model.applications), apis: safeArray(model.apis),
      components: safeArray(model.components), relationships: safeArray(model.relationships),
    },
  };
}