import { normalizeSlashes } from "../core/paths";

export const MAX_LOCAL_SUMMARY_BYTES = 8192;

const PATH_SUMMARY_KEYS = new Set(["path", "testPath", "stagedPath", "contextPath", "logPath", "baseRef"]);

export function normalizeSummaryPaths<T>(value: T, keyName?: string): T {
  if (typeof value === "string") {
    if (keyName && (PATH_SUMMARY_KEYS.has(keyName) || keyName === "stagedFilesInGitStatus")) {
      return value.replace(/\\/g, "/") as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSummaryPaths(item, keyName)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = normalizeSummaryPaths(v, k);
    }
    return out as T;
  }
  return value;
}

export function serializeBoundedSummary<T extends Record<string, unknown>>(
  rawSummary: T,
  trimStep?: (draft: T) => boolean,
): string {
  const draft = structuredClone(rawSummary);
  if (typeof draft.next === "string") {
    (draft as Record<string, unknown>).next = normalizeSlashes(draft.next);
  }

  let encoded = JSON.stringify(draft);
  if (Buffer.byteLength(encoded, "utf8") + 1 <= MAX_LOCAL_SUMMARY_BYTES) {
    return `${encoded}\n`;
  }

  if ("truncated" in draft) {
    (draft as Record<string, unknown>).truncated = true;
  }

  let guard = 0;
  while (Buffer.byteLength(encoded, "utf8") + 1 > MAX_LOCAL_SUMMARY_BYTES && guard < 5000) {
    guard += 1;
    let changed = false;
    if (trimStep && trimStep(draft)) {
      changed = true;
    } else if (Array.isArray(draft.files)) {
      const filesArr = draft.files as Array<Record<string, unknown>>;
      const withTail = filesArr.find((f) => typeof f.outputTail === "string" && f.outputTail.length > 0);
      if (withTail) {
        delete withTail.outputTail;
        changed = true;
      } else {
        const withManySyms = filesArr.find((f) => Array.isArray(f.symbols) && f.symbols.length > 1);
        if (withManySyms && Array.isArray(withManySyms.symbols)) {
          withManySyms.symbols = withManySyms.symbols.slice(
            0,
            Math.max(1, Math.floor(withManySyms.symbols.length / 2)),
          );
          changed = true;
        } else if (Array.isArray(draft.skipped) && draft.skipped.length > 0) {
          draft.skipped.pop();
          changed = true;
        } else if (filesArr.length > 1) {
          filesArr.pop();
          changed = true;
        } else if (filesArr.length === 1 && Array.isArray(filesArr[0]?.symbols) && filesArr[0].symbols.length > 0) {
          filesArr[0].symbols = [];
          changed = true;
        } else if (filesArr.length === 1) {
          filesArr.pop();
          changed = true;
        }
      }
    } else if (Array.isArray(draft.checks) && draft.checks.length > 0) {
      const longCheck = (draft.checks as Array<{ status?: string; detail?: string; fix?: string }>).find(
        (c) =>
          (typeof c.detail === "string" && c.detail.length > 120) || (typeof c.fix === "string" && c.fix.length > 120),
      );
      if (longCheck) {
        if (longCheck.detail && longCheck.detail.length > 120) longCheck.detail = longCheck.detail.slice(0, 120);
        if (longCheck.fix && longCheck.fix.length > 120) longCheck.fix = longCheck.fix.slice(0, 120);
        changed = true;
      } else if (draft.checks.length > 1) {
        draft.checks.pop();
        changed = true;
      }
    }

    if (!changed && Array.isArray(draft.failingTests) && draft.failingTests.length > 0) {
      draft.failingTests.pop();
      changed = true;
    }
    if (!changed && Array.isArray(draft.stagedFilesInGitStatus) && draft.stagedFilesInGitStatus.length > 0) {
      draft.stagedFilesInGitStatus.pop();
      changed = true;
    }
    if (!changed && Array.isArray(draft.refused) && draft.refused.length > 0) {
      draft.refused.pop();
      changed = true;
    }
    if (!changed && Array.isArray(draft.written) && draft.written.length > 0) {
      draft.written.pop();
      changed = true;
    }
    if (
      !changed &&
      draft.toolVersions &&
      typeof draft.toolVersions === "object" &&
      Array.isArray((draft.toolVersions as { warnings?: unknown[] }).warnings) &&
      (draft.toolVersions as { warnings: unknown[] }).warnings.length > 0
    ) {
      (draft.toolVersions as { warnings: unknown[] }).warnings.pop();
      changed = true;
    }

    if (!changed && typeof draft.next === "string" && draft.next.length > 120) {
      (draft as Record<string, unknown>).next = draft.next.slice(0, 120);
      changed = true;
    }

    if (!changed) break;
    encoded = JSON.stringify(draft);
  }

  return `${encoded}\n`;
}
