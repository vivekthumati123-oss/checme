function analyzeKubernetes(contents) {
  const result = {
    detected: false,
    deployments: [],
    services: []
  };

  for (const item of contents) {
    const content = item.content || "";

    if (!content) {
      continue;
    }

    if (item.path.endsWith("deployment.yaml")) {
      result.detected = true;

      const nameMatch = content.match(
        /metadata:\s*[\s\S]*?name:\s*([^\s]+)/i
      );

      const imageMatch = content.match(
        /image:\s*([^\s]+)/i
      );

      const portMatch = content.match(
        /containerPort:\s*(\d+)/i
      );

      result.deployments.push({
        name: nameMatch
          ? nameMatch[1]
          : "Unknown Deployment",

        image: imageMatch
          ? imageMatch[1]
          : "Unknown",

        containerPort: portMatch
          ? portMatch[1]
          : "Unknown"
      });
    }

    if (item.path.endsWith("service.yaml")) {
      result.detected = true;

      const nameMatch = content.match(
        /metadata:\s*[\s\S]*?name:\s*([^\s]+)/i
      );

      const portMatch = content.match(
        /\n\s*port:\s*(\d+)/i
      );

      const targetPortMatch = content.match(
        /targetPort:\s*(\d+)/i
      );

      result.services.push({
        name: nameMatch
          ? nameMatch[1]
          : "Unknown Service",

        port: portMatch
          ? portMatch[1]
          : "Unknown",

        targetPort: targetPortMatch
          ? targetPortMatch[1]
          : "Unknown"
      });
    }
  }

  return result;
}

export { analyzeKubernetes };
