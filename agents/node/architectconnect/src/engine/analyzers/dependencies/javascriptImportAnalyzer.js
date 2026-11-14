import * as path from "node:path";


// ==================================================
// JAVASCRIPT / TYPESCRIPT IMPORT ANALYZER
//
// Purpose:
//
// Build repository-derived file dependency edges from:
//
// require("./localModule")
//
// import x from "./localModule"
//
// import { x } from "./localModule"
//
// import "./localModule"
//
// This analyzer does not depend on folder names such
// as controllers, services, repositories, backend,
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
// JAVASCRIPT / TYPESCRIPT FILE CHECK
// ==================================================

function isJavaScriptFile(filePath) {
  const normalized =
    normalizePath(
      filePath
    ).toLowerCase();

  return (
    normalized.endsWith(".js") ||
    normalized.endsWith(".jsx") ||
    normalized.endsWith(".mjs") ||
    normalized.endsWith(".cjs") ||
    normalized.endsWith(".ts") ||
    normalized.endsWith(".tsx")
  );
}


// ==================================================
// EXTRACT REQUIRE IMPORTS
// ==================================================
//
// Examples:
//
// require("./http/users")
//
// require("../business/users")
//
// require('../data/users')
//
// ==================================================

function extractRequireImports(
  content
) {
  const imports = [];

  if (
    typeof content !== "string"
  ) {
    return imports;
  }


  // --------------------------------------------------
  // DOUBLE QUOTES
  // --------------------------------------------------

  const doubleQuoteRegex =
    /require\s*\(\s*"([^"]+)"\s*\)/g;

  let match;

  while (
    (
      match =
        doubleQuoteRegex.exec(
          content
        )
    ) !== null
  ) {
    if (match[1]) {
      imports.push(
        match[1]
      );
    }
  }


  // --------------------------------------------------
  // SINGLE QUOTES
  // --------------------------------------------------

  const singleQuoteRegex =
    /require\s*\(\s*'([^']+)'\s*\)/g;

  while (
    (
      match =
        singleQuoteRegex.exec(
          content
        )
    ) !== null
  ) {
    if (match[1]) {
      imports.push(
        match[1]
      );
    }
  }


  return imports;
}


// ==================================================
// EXTRACT ES MODULE IMPORTS
// ==================================================
//
// Supports:
//
// import users from "../business/users";
//
// import {
//   getUsers
// } from "../business/users";
//
// import * as users from "../business/users";
//
// import "../bootstrap";
//
// ==================================================

function extractEsImports(
  content
) {
  const imports = [];

  if (
    typeof content !== "string"
  ) {
    return imports;
  }


  // ==================================================
  // IMPORT ... FROM "..."
  // ==================================================

  const doubleQuoteFromRegex =
    /import\s+[\s\S]*?\s+from\s+"([^"]+)"/g;

  let match;

  while (
    (
      match =
        doubleQuoteFromRegex.exec(
          content
        )
    ) !== null
  ) {
    if (match[1]) {
      imports.push(
        match[1]
      );
    }
  }


  const singleQuoteFromRegex =
    /import\s+[\s\S]*?\s+from\s+'([^']+)'/g;

  while (
    (
      match =
        singleQuoteFromRegex.exec(
          content
        )
    ) !== null
  ) {
    if (match[1]) {
      imports.push(
        match[1]
      );
    }
  }


  // ==================================================
  // SIDE-EFFECT IMPORT
  //
  // import "./bootstrap";
  // ==================================================

  const doubleQuoteSideEffectRegex =
    /import\s+"([^"]+)"/g;

  while (
    (
      match =
        doubleQuoteSideEffectRegex.exec(
          content
        )
    ) !== null
  ) {
    if (match[1]) {
      imports.push(
        match[1]
      );
    }
  }


  const singleQuoteSideEffectRegex =
    /import\s+'([^']+)'/g;

  while (
    (
      match =
        singleQuoteSideEffectRegex.exec(
          content
        )
    ) !== null
  ) {
    if (match[1]) {
      imports.push(
        match[1]
      );
    }
  }


  return imports;
}


// ==================================================
// LOCAL IMPORT CHECK
// ==================================================
//
// Local:
//
// ./users
// ../business/users
//
// External:
//
// express
// react
// lodash
//
// ==================================================

function isLocalImport(
  importPath
) {
  if (
    typeof importPath !== "string"
  ) {
    return false;
  }

  return (
    importPath.startsWith("./") ||
    importPath.startsWith("../")
  );
}


// ==================================================
// RESOLVE IMPORT PATH
// ==================================================
//
// Example:
//
// Source:
//
// systems/account-service/src/http/users.js
//
// Import:
//
// ../business/users
//
// Resolved:
//
// systems/account-service/src/business/users.js
//
// ==================================================

function resolveImportPath(
  sourcePath,
  importPath,
  availablePaths
) {
  const normalizedSource =
    normalizePath(
      sourcePath
    );

  const sourceDirectory =
    path.posix.dirname(
      normalizedSource
    );


  const unresolvedTarget =
    normalizePath(
      path.posix.normalize(
        path.posix.join(
          sourceDirectory,
          importPath
        )
      )
    );


  // ==================================================
  // FILE RESOLUTION CANDIDATES
  // ==================================================

  const candidates = [
    unresolvedTarget,

    `${unresolvedTarget}.js`,
    `${unresolvedTarget}.jsx`,
    `${unresolvedTarget}.mjs`,
    `${unresolvedTarget}.cjs`,
    `${unresolvedTarget}.ts`,
    `${unresolvedTarget}.tsx`,

    `${unresolvedTarget}/index.js`,
    `${unresolvedTarget}/index.jsx`,
    `${unresolvedTarget}/index.mjs`,
    `${unresolvedTarget}/index.cjs`,
    `${unresolvedTarget}/index.ts`,
    `${unresolvedTarget}/index.tsx`
  ];


  for (
    const candidate of candidates
  ) {
    if (
      availablePaths.has(
        candidate
      )
    ) {
      return candidate;
    }
  }


  return null;
}


// ==================================================
// COLLECT IMPORT PATHS
// ==================================================

function collectImportPaths(
  content
) {
  const imports = [
    ...extractRequireImports(
      content
    ),

    ...extractEsImports(
      content
    )
  ];


  // ==================================================
  // REMOVE DUPLICATE IMPORT EXPRESSIONS
  // ==================================================

  return [
    ...new Set(imports)
  ];
}


// ==================================================
// MAIN ANALYZER
// ==================================================

function analyzeJavaScriptImports(
  contents
) {
  if (
    !Array.isArray(contents)
  ) {
    return [];
  }


  // ==================================================
  // BUILD REPOSITORY FILE INDEX
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
  // ANALYZE SOURCE IMPORTS
  // ==================================================

  const relationships = [];


  for (
    const item of contents
  ) {
    if (!item) {
      continue;
    }


    // --------------------------------------------------
    // SOURCE PATH
    // --------------------------------------------------

    const sourcePath =
      normalizePath(
        item.path ||
        item.name ||
        ""
      );


    if (!sourcePath) {
      continue;
    }


    // --------------------------------------------------
    // SOURCE TYPE
    // --------------------------------------------------

    if (
      !isJavaScriptFile(
        sourcePath
      )
    ) {
      continue;
    }


    // --------------------------------------------------
    // SOURCE CONTENT
    // --------------------------------------------------

    const content =
      getFileContent(
        item
      );


    if (!content) {
      continue;
    }


    // ==================================================
    // EXTRACT IMPORTS
    // ==================================================

    const imports =
      collectImportPaths(
        content
      );


    // ==================================================
    // PROCESS IMPORTS
    // ==================================================

    for (
      const importPath of imports
    ) {

      // ------------------------------------------------
      // Ignore external dependencies.
      //
      // Example:
      //
      // require("express")
      // import React from "react"
      //
      // Those belong to technology discovery.
      // ------------------------------------------------

      if (
        !isLocalImport(
          importPath
        )
      ) {
        continue;
      }


      // ------------------------------------------------
      // RESOLVE IMPORT TO ACTUAL REPOSITORY FILE
      // ------------------------------------------------

      const targetPath =
        resolveImportPath(
          sourcePath,
          importPath,
          availablePaths
        );


      // ------------------------------------------------
      // CREATE GRAPH EDGE
      // ------------------------------------------------

      relationships.push({
        from:
          sourcePath,

        to:
          targetPath,

        importPath,

        type:
          "source_import",

        relationship:
          "imports",

        resolved:
          Boolean(
            targetPath
          ),

        evidence:
          importPath
      });
    }
  }


  // ==================================================
  // REMOVE DUPLICATE GRAPH EDGES
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
          relationship.importPath
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


  // ==================================================
  // RETURN IMPORT GRAPH
  // ==================================================

  return uniqueRelationships;
}


// ==================================================
// EXPORT
// ==================================================

export { analyzeJavaScriptImports };
