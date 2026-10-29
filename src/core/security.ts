import path from "node:path";

const QUERY_SECRET_RE =
  /([?&](?:key|jscode|securityjscode|webkey|jskey|securitycode|token|api_key)=)[^&\s#]+/gi;
const JSON_SECRET_RE =
  /("(?:webKey|jsKey|securityCode|securityJsCode|key|token|api_key)"\s*:\s*")[^"]*(")/gi;
const TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|[a-f0-9]{32})\b/gi;

/**
 * Removes credential-looking values from a message before it is shown in a
 * Notice, written to the console, or put in an error object.
 */
export function redactSecrets(input: string): string {
  if (!input) return "";
  return input
    .replace(QUERY_SECRET_RE, "$1[redacted]")
    .replace(JSON_SECRET_RE, "$1[redacted]$2")
    .replace(TOKEN_RE, "[redacted]");
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return redactSecrets(error.message);
  if (typeof error === "string") return redactSecrets(error);
  return "未知错误";
}

/** True when `candidate` is the same as or below `parent` (case-insensitive on Windows). */
export function isPathInside(parent: string, candidate: string): boolean {
  try {
    const resolvedParent = path.resolve(parent);
    const resolvedCandidate = path.resolve(candidate);
    const caseInsensitive = process.platform === "win32";
    const base = caseInsensitive ? resolvedParent.toLowerCase() : resolvedParent;
    const target = caseInsensitive ? resolvedCandidate.toLowerCase() : resolvedCandidate;
    return target === base || target.startsWith(`${base}${path.sep}`);
  } catch {
    return false;
  }
}
