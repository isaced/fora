/**
 * Error types with stable codes and process exit codes.
 *
 * Exit codes (see SPEC §6):
 *   0 ok · 1 generic · 2 usage · 3 unsupported · 4 rate-limited / refused
 */

export type ForaErrorCode =
  | "usage"
  | "unsupported"
  | "rate_limited"
  | "not_found"
  | "upstream"
  | "network"
  | "config"
  | "generic";

export class ForaError extends Error {
  readonly code: ForaErrorCode;
  readonly exitCode: number;

  constructor(code: ForaErrorCode, message: string, exitCode = 1) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}

export interface SiteFailure {
  site: string;
  code: ForaErrorCode;
  message: string;
}

export class SiteBatchError extends ForaError {
  constructor(code: ForaErrorCode, message: string, exitCode: number, readonly failures: SiteFailure[]) {
    super(code, message, exitCode);
  }
}

/** Bad flags, missing arguments, unknown sites — exit 2. */
export class UsageError extends ForaError {
  constructor(message: string) {
    super("usage", message, 2);
  }
}

/** An operation that the selected engine does not implement — exit 3. */
export class UnsupportedError extends ForaError {
  readonly engine?: string;

  constructor(operation: string, engine?: string) {
    super(
      "unsupported",
      engine ? `${operation} is not supported by ${engine}` : `${operation} is not supported`,
      3,
    );
    this.engine = engine;
  }
}

/** HTTP 429 or an anti-bot block page — exit 4. */
export class RateLimitError extends ForaError {
  constructor(message = "upstream refused the request (rate limited or blocked)") {
    super("rate_limited", message, 4);
  }
}

export class NotFoundError extends ForaError {
  constructor(message: string) {
    super("not_found", message, 1);
  }
}

export class UpstreamError extends ForaError {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super("upstream", message, 1);
    this.status = status;
  }
}

export class NetworkError extends ForaError {
  constructor(message: string) {
    super("network", message, 1);
  }
}

export class ConfigError extends ForaError {
  constructor(message: string) {
    super("config", message, 1);
  }
}

export function errorCodeOf(error: unknown): ForaErrorCode {
  return error instanceof ForaError ? error.code : "generic";
}

export function exitCodeOf(error: unknown): number {
  return error instanceof ForaError ? error.exitCode : 1;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Any HTTP 403 on a public read request (not only Cloudflare challenges). */
export function isHttpForbidden(error: unknown): boolean {
  return error instanceof ForaError && /\b403\b/.test(error.message);
}
