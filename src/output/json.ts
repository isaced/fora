/** JSON output helpers for `--json` mode. */

export function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeErrorJson(code: string, message: string, details?: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ code, message, ...details })}\n`);
}
