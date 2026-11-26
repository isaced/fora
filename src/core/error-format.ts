/** Render an error message consistently for CLI-level fallbacks. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
