// ==================================================
// ARCHITECTCONNECT
// PROPOSED ARCHITECTURE DECISION RECORD GENERATOR
//
// Purpose:
//
// Generate proposed ADR candidates from architecture
// evidence discovered by ArchitectConnect.
//
// Important:
//
// - ADRs generated here are always PROPOSED.
// - Repository evidence can establish what technology
//   or architectural approach is being used.
// - Repository evidence usually cannot establish why
//   the original team made that decision.
// - Historical rationale and alternatives therefore
//   require architect validation.
//
// ==================================================


// ==================================================
// ADD UNIQUE ADR
// ==================================================

function addUniqueAdr(
  adrs,
  candidate
) {

  if (
    !candidate ||
    !candidate.key
  ) {

    return;
  }


  const exists =
    adrs.some(
      (adr) =>
        adr.key ===
        candidate.key
    );


  if (!exists) {

    adrs.push(
      candidate
    );
  }
}


// ==================================================
// NORMALIZE STRING ARRAY
// ==================================================

function normalizeStringArray(
  value
) {

  if (!Array.isArray(value)) {

    return [];
  }


  return value
    .filter(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0
    )
    .map(
      (item) =>
        item.trim()
    );
}


// ==================================================
// NORMALIZE EVIDENCE
// ==================================================

function normalizeEvidence(
  evidence
) {

  return [
    ...new Set(
      normalizeStringArray(
        evidence
      )
    )
  ];
}


// ==================================================
// FIND APPLICATION BY FRAMEWORK
// ==================================================

function findApplicationByFramework(
  applications,
  framework
) {

  if (
    !Array.isArray(applications)
  ) {

    return null;
  }


  return (
    applications.find(
      (application) =>
        application &&
        application.framework ===
          framework
    ) ||
    null
  );
}


// ==================================================
// CREATE ADR CANDIDATE
// ==================================================

function createAdr({
  key,
  title,
  decision,
  context,
  evidence = [],
  observedConsequences = [],
  validationQuestions = []
}) {

  return {
    key,

    title,

    status:
      "Proposed",

    decision,

    context,

    evidence:
      normalizeEvidence(
        evidence
      ),

    rationale:
      "Historical rationale is not available from repository evidence.",

    alternatives:
      "Alternatives considered by the original architecture team are not available from repository evidence.",

    consequences: {

      observed:
        normalizeStringArray(
          observedConsequences
        ),

      requiresValidation:
        true
    },

    validationQuestions:
      normalizeStringArray(
        validationQuestions
      ),

    requiresValidation:
      true
  };
}


// ==================================================
// GENERATE PROPOSED ADRs
// ==================================================

function generateADRs(
  findings,
  metadata = {}
) {

  const adrs =
    [];


  const frameworks =
    normalizeStringArray(
      findings?.frameworks
    );


  const deployment =
    normalizeStringArray(
      findings?.deployment
    );


  const applications =
    Array.isArray(
      findings?.applications
    )
      ? findings.applications
      : [];


  // ==================================================
  // EXPRESS
  // ==================================================

  if (
    frameworks.includes(
      "Express"
    )
  ) {

    const application =
      findApplicationByFramework(
        applications,
        "Express"
      );


    addUniqueAdr(
      adrs,
      createAdr({

        key:
          "express-backend",

        title:
          "Use Express for the Backend API",

        decision:
          "Use Express as the web framework for the Node.js backend API.",

        context:
          "ArchitectConnect repository analysis detected an Express-based backend application.",

        evidence:
          application?.sourceFiles ||
          [],

        observedConsequences: [
          "HTTP API behavior is implemented using the Express framework.",
          "The backend application depends on the Node.js runtime."
        ],

        validationQuestions: [
          "Why was Express selected over other Node.js web frameworks?",
          "What performance, support, security, and maintainability requirements influenced this choice?"
        ]
      })
    );
  }


  // ==================================================
  // FASTAPI
  // ==================================================

  if (
    frameworks.includes(
      "FastAPI"
    )
  ) {

    const application =
      findApplicationByFramework(
        applications,
        "FastAPI"
      );


    addUniqueAdr(
      adrs,
      createAdr({

        key:
          "fastapi-python-api",

        title:
          "Use FastAPI for the Python API",

        decision:
          "Use FastAPI as the web framework for the Python API.",

        context:
          "ArchitectConnect repository analysis detected a FastAPI-based Python application.",

        evidence:
          application?.sourceFiles ||
          [],

        observedConsequences: [
          "The Python API uses FastAPI for HTTP endpoint implementation.",
          "The service requires a Python runtime."
        ],

        validationQuestions: [
          "Why was FastAPI selected for this API?",
          "Were Django, Flask, or other API frameworks considered?",
          "What performance and maintainability requirements influenced this choice?"
        ]
      })
    );
  }


  // ==================================================
  // REACT
  // ==================================================

  if (
    frameworks.includes(
      "React"
    )
  ) {

    const application =
      findApplicationByFramework(
        applications,
        "React"
      );


    addUniqueAdr(
      adrs,
      createAdr({

        key:
          "react-frontend",

        title:
          "Use React for the Frontend",

        decision:
          "Use React as the frontend application framework.",

        context:
          "ArchitectConnect repository analysis detected React as the frontend framework.",

        evidence: [
          ...(application?.sourceFiles || []),
          "package.json"
        ],

        observedConsequences: [
          "The frontend application uses the React component model.",
          "Frontend development depends on the JavaScript or TypeScript ecosystem."
        ],

        validationQuestions: [
          "Why was React selected over other frontend frameworks?",
          "What browser-support, maintainability, and user-experience requirements influenced this decision?"
        ]
      })
    );
  }


  // ==================================================
  // DOCKER
  // ==================================================

  if (
    deployment.includes(
      "Docker"
    )
  ) {

    addUniqueAdr(
      adrs,
      createAdr({

        key:
          "docker-containerization",

        title:
          "Containerize Application Workloads with Docker",

        decision:
          "Use Docker to package application workloads into containers.",

        context:
          "ArchitectConnect repository analysis detected Docker configuration.",

        evidence: [
          "Dockerfile"
        ],

        observedConsequences: [
          "Application runtime dependencies can be packaged into container images.",
          "Container-image build and lifecycle management become part of the delivery process."
        ],

        validationQuestions: [
          "Why was containerization selected for this application?",
          "What image-management and vulnerability-scanning policies apply?",
          "Where are container images stored and promoted?"
        ]
      })
    );
  }


  // ==================================================
  // KUBERNETES
  // ==================================================

  if (
    deployment.includes(
      "Kubernetes"
    )
  ) {

    addUniqueAdr(
      adrs,
      createAdr({

        key:
          "kubernetes-deployment",

        title:
          "Deploy Containerized Workloads with Kubernetes",

        decision:
          "Use Kubernetes for deployment of containerized application workloads.",

        context:
          "ArchitectConnect repository analysis detected Kubernetes deployment configuration.",

        evidence: [
          "k8s/deployment.yaml",
          "k8s/service.yaml"
        ],

        observedConsequences: [
          "Application deployment is represented using Kubernetes resources.",
          "Container orchestration becomes part of the runtime architecture."
        ],

        validationQuestions: [
          "Why was Kubernetes selected instead of another hosting platform?",
          "What availability and scaling requirements influenced this decision?",
          "What cluster-management and operational model is intended?",
          "What resource limits, probes, policies, and security controls are required?"
        ]
      })
    );
  }


  // ==================================================
  // TERRAFORM
  // ==================================================

  if (
    deployment.includes(
      "Terraform"
    )
  ) {

    addUniqueAdr(
      adrs,
      createAdr({

        key:
          "terraform-infrastructure",

        title:
          "Manage Infrastructure with Terraform",

        decision:
          "Use Terraform for infrastructure provisioning and management.",

        context:
          "ArchitectConnect repository analysis detected Terraform infrastructure definitions.",

        evidence: [
          "terraform/main.tf"
        ],

        observedConsequences: [
          "Infrastructure configuration is represented as declarative Terraform code.",
          "Terraform state management becomes an operational requirement."
        ],

        validationQuestions: [
          "Why was Terraform selected as an infrastructure-as-code technology?",
          "Where will Terraform state be stored?",
          "How will state locking and access control be implemented?",
          "Will reusable Terraform modules be used?"
        ]
      })
    );
  }


  // ==================================================
  // BICEP
  // ==================================================

  if (
    deployment.includes(
      "Bicep"
    )
  ) {

    addUniqueAdr(
      adrs,
      createAdr({

        key:
          "bicep-azure-infrastructure",

        title:
          "Use Bicep for Azure Infrastructure",

        decision:
          "Use Bicep for declarative Azure infrastructure definitions.",

        context:
          "ArchitectConnect repository analysis detected Bicep infrastructure definitions.",

        evidence: [
          "bicep/main.bicep"
        ],

        observedConsequences: [
          "Azure infrastructure configuration is represented declaratively using Bicep.",
          "Azure resource definitions become version-controlled architecture artifacts."
        ],

        validationQuestions: [
          "Why is Bicep used in addition to or instead of Terraform?",
          "What Azure resources are intended to remain Bicep-managed?",
          "How are responsibilities divided between Terraform and Bicep?",
          "Should common Bicep resources be organized into reusable modules?"
        ]
      })
    );
  }


  // ==================================================
  // ASSIGN ADR IDs + METADATA
  // ==================================================

  return adrs.map(
    (
      adr,
      index
    ) => ({

      id:
        `ADR-${String(
          index + 1
        ).padStart(
          3,
          "0"
        )}`,

      ...adr,

      repository:
        metadata.repository ||
        null,

      branch:
        metadata.branch ||
        null
    })
  );
}


// ==================================================
// EXPORT
// ==================================================

export { generateADRs };
