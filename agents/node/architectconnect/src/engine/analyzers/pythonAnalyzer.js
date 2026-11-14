function analyzePython(contents) {
  const filePaths = contents.map((item) =>
    (item.path || item.name || "").toLowerCase()
  );

  // --------------------------------------------------
  // Python Source Detection
  // --------------------------------------------------

  const pythonFiles = filePaths.filter((file) =>
    file.endsWith(".py")
  );

  // --------------------------------------------------
  // Python Dependency / Project File Detection
  // --------------------------------------------------

  const dependencyFiles = filePaths.filter((file) =>
    file.endsWith("requirements.txt") ||
    file.endsWith("pyproject.toml") ||
    file.endsWith("pipfile") ||
    file.endsWith("setup.py")
  );

  // --------------------------------------------------
  // Python Detection
  // --------------------------------------------------

  const detected =
    pythonFiles.length > 0 ||
    dependencyFiles.length > 0;

  // --------------------------------------------------
  // Confidence
  // --------------------------------------------------

  let confidence = 0;

  if (
    pythonFiles.length > 0 &&
    dependencyFiles.length > 0
  ) {
    confidence = 1.0;
  } else if (pythonFiles.length > 0) {
    confidence = 0.8;
  } else if (dependencyFiles.length > 0) {
    confidence = 0.6;
  }

  // --------------------------------------------------
  // Evidence
  // --------------------------------------------------

  const evidence = [];

  if (pythonFiles.length > 0) {
    evidence.push(
      `${pythonFiles.length} Python source file(s) found`
    );
  }

  if (dependencyFiles.length > 0) {
    evidence.push(
      `${dependencyFiles.length} Python dependency/project file(s) found`
    );
  }

  // --------------------------------------------------
  // Result
  // --------------------------------------------------

  return {
    detected,
    language: detected ? "Python" : "",
    confidence,
    sourceFiles: pythonFiles,
    dependencyFiles,
    frameworks: [],
    evidence
  };
}

export { analyzePython };
