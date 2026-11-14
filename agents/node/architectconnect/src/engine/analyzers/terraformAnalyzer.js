function analyzeTerraform(contents) {
  const result = {
    detected: false,
    providers: [],
    resources: []
  };

  for (const item of contents) {
    if (!item.path.endsWith(".tf")) {
      continue;
    }

    const content = item.content || "";

    if (!content) {
      continue;
    }

    result.detected = true;

    const providerRegex =
      /provider\s+"([^"]+)"/g;

    let providerMatch;

    while (
      (providerMatch = providerRegex.exec(content)) !== null
    ) {
      if (
        !result.providers.includes(providerMatch[1])
      ) {
        result.providers.push(providerMatch[1]);
      }
    }

    const resourceRegex =
      /resource\s+"([^"]+)"\s+"([^"]+)"/g;

    let resourceMatch;

    while (
      (resourceMatch = resourceRegex.exec(content)) !== null
    ) {
      result.resources.push({
        type: resourceMatch[1],
        name: resourceMatch[2]
      });
    }
  }

  return result;
}

export { analyzeTerraform };
