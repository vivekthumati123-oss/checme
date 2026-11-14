function analyzeBicep(contents) {
  const result = {
    detected: false,
    resources: []
  };

  for (const item of contents) {
    if (!item.path.endsWith(".bicep")) {
      continue;
    }

    const content = item.content || "";

    if (!content) {
      continue;
    }

    result.detected = true;

    const resourceRegex =
      /resource\s+(\w+)\s+'([^']+)'/g;

    let match;

    while (
      (match = resourceRegex.exec(content)) !== null
    ) {
      result.resources.push({
        name: match[1],
        type: match[2]
      });
    }
  }

  return result;
}

export { analyzeBicep };
