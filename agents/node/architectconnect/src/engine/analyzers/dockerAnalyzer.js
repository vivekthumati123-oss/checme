function analyzeDocker(content) {
  const result = {
    detected: false,
    baseImages: [],
    exposedPorts: [],
    commands: [],
    workdir: "",
    entrypoint: ""
  };

  if (!content) {
    return result;
  }

  result.detected = true;

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed.startsWith("#")
    ) {
      continue;
    }

    if (trimmed.toUpperCase().startsWith("FROM ")) {
      const image = trimmed.substring(5).trim();

      result.baseImages.push(image);
    }

    if (trimmed.toUpperCase().startsWith("WORKDIR ")) {
      result.workdir = trimmed.substring(8).trim();
    }

    if (trimmed.toUpperCase().startsWith("EXPOSE ")) {
      const port = trimmed.substring(7).trim();

      result.exposedPorts.push(port);
    }

    if (trimmed.toUpperCase().startsWith("RUN ")) {
      result.commands.push(
        trimmed.substring(4).trim()
      );
    }

    if (trimmed.toUpperCase().startsWith("CMD ")) {
      result.entrypoint = trimmed.substring(4).trim();
    }

    if (trimmed.toUpperCase().startsWith("ENTRYPOINT ")) {
      result.entrypoint = trimmed.substring(11).trim();
    }
  }

  return result;
}

export { analyzeDocker };
