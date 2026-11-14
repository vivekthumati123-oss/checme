/** Agents talk to the model only through this interface. */
export class AgentRuntime {
  // eslint-disable-next-line no-unused-vars
  async run(options) {
    throw new Error("AgentRuntime.run must be implemented");
  }
}

/** Recover a JSON object from model output that may include fences or prose. */
export function parseStructuredOutput(content) {
  const text = String(content ?? "").trim();
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
