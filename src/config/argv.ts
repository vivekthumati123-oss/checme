import path from "node:path";

const SAFE_MODEL_PATH_RE = /^[A-Za-z0-9_./-]+$/;
const ENV_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

export interface TokenizeResult {
  tokens: string[];
}

export class ArgvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgvParseError";
  }
}

/**
 * Parse a command string into argv tokens with zero shell interpretation.
 * Single and double quotes group tokens. Backslashes are treated literally so
 * Windows paths survive without doubling backslashes.
 */
export function parseArgvTokens(command: string): string[] {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    throw new ArgvParseError("command must not be empty");
  }

  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    const next = trimmed[i + 1] ?? "";

    if (quote !== null) {
      if (ch === "`" || (quote === '"' && ch === "$" && next === "(")) {
        throw new ArgvParseError(
          `shell substitution operator "${ch === "`" ? "`" : "$("}" is not allowed; put multi-step logic in an npm script or a script file`,
        );
      }
      if (ch === quote) {
        quote = null;
        inToken = true;
      } else {
        current += ch;
        inToken = true;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
      continue;
    }

    // Reject shell control operators outside quotes.
    if (ch === "&" && next === "&") {
      throw new ArgvParseError(
        'shell operator "&&" is not allowed; put multi-step logic in an npm script or a script file',
      );
    }
    if (ch === "|" && next === "|") {
      throw new ArgvParseError(
        'shell operator "||" is not allowed; put multi-step logic in an npm script or a script file',
      );
    }
    if (ch === "$" && next === "(") {
      throw new ArgvParseError(
        'shell operator "$(" is not allowed; put multi-step logic in an npm script or a script file',
      );
    }
    if (ch === "|" || ch === ";" || ch === ">" || ch === "<" || ch === "`" || ch === "&") {
      throw new ArgvParseError(
        `shell operator "${ch}" is not allowed; put multi-step logic in an npm script or a script file`,
      );
    }

    current += ch;
    inToken = true;
  }

  if (quote !== null) {
    throw new ArgvParseError("unterminated quote in command");
  }
  if (inToken) {
    tokens.push(current);
  }
  if (tokens.length === 0) {
    throw new ArgvParseError("command must contain an executable");
  }
  if (ENV_PREFIX_RE.test(tokens[0]!)) {
    throw new ArgvParseError(
      `inline environment assignment "${tokens[0]}" is not supported; use env.pass or put logic in a script file`,
    );
  }

  return tokens;
}

export function isArgvOnly(command: string): boolean {
  try {
    parseArgvTokens(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Expand `{files}` placeholder in a parsed command into separate validated argv elements.
 */
export function tokenizeCommand(command: string, files?: readonly string[]): { file: string; args: string[] } {
  const rawTokens = parseArgvTokens(command);
  const expanded: string[] = [];

  for (const token of rawTokens) {
    if (token === "{files}") {
      if (!files || files.length === 0) {
        throw new ArgvParseError("command requires {files} arguments, none were provided");
      }
      for (const f of files) {
        if (!SAFE_MODEL_PATH_RE.test(f) || f.includes("..") || path.isAbsolute(f)) {
          throw new ArgvParseError(`unsafe file argument rejected for command expansion: "${f}"`);
        }
        expanded.push(f);
      }
      continue;
    }
    if (token.includes("{files}")) {
      throw new ArgvParseError('placeholder "{files}" must appear as its own argument token, not embedded');
    }
    expanded.push(token);
  }

  const [file, ...args] = expanded;
  if (!file) {
    throw new ArgvParseError("command has no executable");
  }
  return { file, args };
}

export interface ResolvedWrapper {
  executable: string;
  viaShell: boolean;
  isWrapper: boolean;
  note?: string;
}

/**
 * Resolve `./gradlew`, `gradlew`, `./mvnw`, `mvnw` to the platform-appropriate wrapper executable.
 */
export function resolveWrapperCommand(
  executableToken: string,
  platform: NodeJS.Platform = process.platform,
  hasExecBit = true,
): ResolvedWrapper {
  const normalized = executableToken.replace(/\\/g, "/");
  const isGradlew = normalized === "./gradlew" || normalized === "gradlew";
  const isMvnw = normalized === "./mvnw" || normalized === "mvnw";
  if (!isGradlew && !isMvnw) {
    return { executable: executableToken, viaShell: false, isWrapper: false };
  }

  if (platform === "win32") {
    return {
      executable: isGradlew ? "gradlew.bat" : "mvnw.cmd",
      viaShell: false,
      isWrapper: true,
    };
  }

  const posixWrapper = isGradlew ? "./gradlew" : "./mvnw";
  if (!hasExecBit) {
    return {
      executable: posixWrapper,
      viaShell: true,
      isWrapper: true,
      note: `${posixWrapper} lacked execute permission; invoked via sh`,
    };
  }
  return { executable: posixWrapper, viaShell: false, isWrapper: true };
}
