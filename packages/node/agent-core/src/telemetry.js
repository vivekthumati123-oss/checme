const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured JSON logs on stderr; stdout is reserved for the AgentResult. */
export class Logger {
  constructor({ agentId = "unknown", correlationId = null, level = "info", sink = (line) => process.stderr.write(`${line}\n`) } = {}) {
    this.base = { agentId, correlationId };
    const normalised = String(level).toLowerCase();
    this.level = normalised in LEVELS ? normalised : "info";
    this.sink = sink;
  }

  #write(level, message, properties = {}) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    this.sink(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...this.base, ...properties }));
  }

  debug(m, p) { this.#write("debug", m, p); }
  info(m, p) { this.#write("info", m, p); }
  warn(m, p) { this.#write("warn", m, p); }
  error(m, p) { this.#write("error", m, p); }
}

export class Telemetry {
  constructor(logger) {
    this.logger = logger;
  }

  async trace(name, properties, fn) {
    const started = Date.now();
    try {
      const result = await fn();
      this.logger.debug("trace.ok", { name, durationMs: Date.now() - started, ...properties });
      return result;
    } catch (error) {
      this.logger.error("trace.error", { name, durationMs: Date.now() - started, error: error.message });
      throw error;
    }
  }
}
