import * as path from "node:path";


// ==================================================
// PYTHON IMPORT ANALYZER
//
// Purpose:
//
// Build repository-derived file dependency edges from:
//
// from app.logic.scoring import calculate_risk
// import app.logic.scoring
//
// The analyzer does not depend on folder names such
// as routers, services, repositories, python-api,
// applications, or packages.
// ==================================================


// ==================================================
// NORMALIZE PATH
// ==================================================

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}


// ==================================================
// GET FILE CONTENT
// ==================================================

function getFileContent(item) {
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


// ==================================================
// PYTHON FILE CHECK
// ==================================================

function isPythonFile(filePath) {
  return normalizePath(
    filePath
  )
    .toLowerCase()
    .endsWith(".py");
}


// ==================================================
// EXTRACT PYTHON IMPORTS
// ==================================================
//
// Supports:
//
// from app.logic.scoring import calculate_risk
//
// import app.logic.scoring
//
// from .logic import scoring
//
// from ..storage import risk_store
//
// ==================================================

function extractPythonImports(
  content
) {
  const imports = [];

  if (
    typeof content !== "string"
  ) {
    return imports;
  }

  const lines =
    content.split(/\r?\n/);

  for (
    const line of lines
  ) {
    const trimmed =
      line.trim();

    if (
      !trimmed ||
      trimmed.startsWith("#")
    ) {
      continue;
    }


    // ================================================
    // FROM X IMPORT Y
    // ================================================

    const fromMatch =
      trimmed.match(
        /^from\s+([^\s]+)\s+import\s+(.+)$/
      );

    if (fromMatch) {
  const importedValue =
    fromMatch[2].trim();

  imports.push({
    module:
      fromMatch[1],

    imported:
      importedValue === "("
        ? null
        : importedValue,

    statement:
      trimmed,

    syntax:
      "from"
  });

  continue;
}

    // ================================================
    // IMPORT X
    // ================================================

    const importMatch =
      trimmed.match(
        /^import\s+([^\s]+)/
      );

    if (importMatch) {
      imports.push({
        module:
          importMatch[1],

        imported:
          null,

        statement:
          trimmed,

        syntax:
          "import"
      });
    }
  }

  return imports;
}


// ==================================================
// EXTERNAL MODULE CHECK
// ==================================================
//
// These common modules are examples of dependencies
// that should not be interpreted as local source
// files.
//
// More importantly, resolution below verifies whether
// a corresponding repository file actually exists.
// ==================================================

function isObviouslyExternalModule(
  moduleName
) {
  const normalized =
    String(
      moduleName || ""
    ).toLowerCase();

  const knownExternalModules = [
    "fastapi",
    "flask",
    "django",
    "pydantic",
    "uvicorn",
    "requests",
    "sqlalchemy",
    "typing",
    "os",
    "sys",
    "json",
    "pathlib",
    "datetime",
    "collections"
  ];

  const topLevel =
    normalized
      .replace(/^\.+/, "")
      .split(".")[0];

  return knownExternalModules.includes(
    topLevel
  );
}


// ==================================================
// DETERMINE APPLICATION ROOT
// ==================================================
//
// Example:
//
// sourcePath:
// engines/risk-engine/app/endpoints/risk.py
//
// applicationRoot:
// engines/risk-engine
//
// ==================================================

function normalizeApplicationRoot(
  applicationRoot
) {
  return normalizePath(
    applicationRoot || ""
  ).replace(/\/+$/, "");
}


// ==================================================
// BUILD MODULE CANDIDATES
// ==================================================

function buildModuleCandidates(
  sourcePath,
  moduleName,
  importedName,
  applicationRoot
) {
  const candidates = [];

  const normalizedSource =
    normalizePath(
      sourcePath
    );

  const sourceDirectory =
    path.posix.dirname(
      normalizedSource
    );

  const normalizedRoot =
    normalizeApplicationRoot(
      applicationRoot
    );


  // ==================================================
  // RELATIVE PYTHON IMPORT
  //
  // Examples:
  //
  // from .logic import scoring
  // from ..storage import risk_store
  //
  // ==================================================

  if (
    moduleName.startsWith(".")
  ) {
    const leadingDots =
      (
        moduleName.match(
          /^\.+/
        ) || [""]
      )[0].length;

    const moduleWithoutDots =
      moduleName.slice(
        leadingDots
      );

    let baseDirectory =
      sourceDirectory;

    for (
      let index = 1;
      index < leadingDots;
      index++
    ) {
      baseDirectory =
        path.posix.dirname(
          baseDirectory
        );
    }

    if (moduleWithoutDots) {
      const modulePath =
        moduleWithoutDots.replace(
          /\./g,
          "/"
        );

      candidates.push(
        path.posix.join(
          baseDirectory,
          `${modulePath}.py`
        )
      );

      candidates.push(
        path.posix.join(
          baseDirectory,
          modulePath,
          "__init__.py"
        )
      );
    }

        if (
      importedName &&
      /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(
        importedName
      )
    ) {
      const importedPath =
        importedName.replace(
          /\./g,
          "/"
        );

      if (moduleWithoutDots) {
        candidates.push(
          path.posix.join(
            baseDirectory,
            moduleWithoutDots.replace(
              /\./g,
              "/"
            ),
            `${importedPath}.py`
          )
        );
      } else {
        candidates.push(
          path.posix.join(
            baseDirectory,
            `${importedPath}.py`
          )
        );
      }
    }

    return candidates.map(
      normalizePath
    );
  }

 
  // ==================================================
  // ABSOLUTE APPLICATION IMPORT
  //
  // Examples:
  //
  // from app.logic.scoring import calculate_risk
  //
  // import app.logic.scoring
  //
  // ==================================================

  const modulePath =
    moduleName.replace(
      /\./g,
      "/"
    );

  if (normalizedRoot) {
    candidates.push(
      `${normalizedRoot}/${modulePath}.py`
    );

    candidates.push(
      `${normalizedRoot}/${modulePath}/__init__.py`
    );
  }

  candidates.push(
    `${modulePath}.py`
  );

  candidates.push(
    `${modulePath}/__init__.py`
  );


  // ==================================================
  // IMPORTED NAME MAY ITSELF BE A MODULE
  //
  // Example:
  //
  // from app.logic import scoring
  //
  // Candidate:
  //
  // app/logic/scoring.py
  // ==================================================

  if (
    importedName &&
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(
      importedName
    )
  ) {
    const importedModulePath =
      `${modulePath}/${importedName}`;

    if (normalizedRoot) {
      candidates.push(
        `${normalizedRoot}/${importedModulePath}.py`
      );

      candidates.push(
        `${normalizedRoot}/${importedModulePath}/__init__.py`
      );
    }

    candidates.push(
      `${importedModulePath}.py`
    );

    candidates.push(
      `${importedModulePath}/__init__.py`
    );
  }


  return candidates.map(
    normalizePath
  );
}


// ==================================================
// RESOLVE PYTHON IMPORT
// ==================================================

function resolvePythonImport(
  sourcePath,
  importInfo,
  availablePaths,
  applicationRoot
) {
  if (
    !importInfo ||
    !importInfo.module
  ) {
    return null;
  }

  const importedNames =
    importInfo.imported
      ? importInfo.imported
          .split(",")
          .map(
            (value) =>
              value
                .trim()
                .split(/\s+as\s+/)[0]
                .trim()
          )
          .filter(Boolean)
      : [null];

  const candidateNames =
    importedNames.length > 0
      ? importedNames
      : [null];

  for (
    const importedName of
    candidateNames
  ) {
    const candidates =
      buildModuleCandidates(
        sourcePath,
        importInfo.module,
        importedName,
        applicationRoot
      );

    for (
      const candidate of
      candidates
    ) {
      if (
        availablePaths.has(
          candidate
        )
      ) {
        return candidate;
      }
    }
  }

  return null;
}


// ==================================================
// MAIN PYTHON IMPORT ANALYZER
// ==================================================

function analyzePythonImports(
  contents,
  applicationRoot = ""
) {
  if (
    !Array.isArray(contents)
  ) {
    return [];
  }


  // ==================================================
  // BUILD FILE INDEX
  // ==================================================

  const availablePaths =
    new Set();

  for (
    const item of contents
  ) {
    if (!item) {
      continue;
    }

    const filePath =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );

    if (!filePath) {
      continue;
    }

    availablePaths.add(
      filePath
    );
  }


  // ==================================================
  // ANALYZE IMPORTS
  // ==================================================

  const relationships = [];

  for (
    const item of contents
  ) {
    if (!item) {
      continue;
    }

    const sourcePath =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );

    if (
      !sourcePath ||
      !isPythonFile(
        sourcePath
      )
    ) {
      continue;
    }

    const content =
      getFileContent(
        item
      );

    if (!content) {
      continue;
    }

    const imports =
      extractPythonImports(
        content
      );

    for (
      const importInfo of imports
    ) {
      if (
        isObviouslyExternalModule(
          importInfo.module
        )
      ) {
        continue;
      }

      const targetPath =
        resolvePythonImport(
          sourcePath,
          importInfo,
          availablePaths,
          applicationRoot
        );

      relationships.push({
        from:
          sourcePath,

        to:
          targetPath,

        module:
          importInfo.module,

        imported:
          importInfo.imported,

        type:
          "source_import",

        relationship:
          "imports",

        resolved:
          Boolean(
            targetPath
          ),

        evidence:
          importInfo.statement
      });
    }
  }


  // ==================================================
  // REMOVE DUPLICATES
  // ==================================================

  const uniqueRelationships =
    [];

  const seen =
    new Set();

  for (
    const relationship of
    relationships
  ) {
    const key =
      [
        relationship.from,
        relationship.to ||
          relationship.module,
        relationship.evidence
      ].join("|");

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    uniqueRelationships.push(
      relationship
    );
  }


  return uniqueRelationships;
}


// ==================================================
// EXPORT
// ==================================================

export { analyzePythonImports };
