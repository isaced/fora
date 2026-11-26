/**
 * The stable, self-describing JSON envelope used by every --json command
 * (SPEC §6.2): { "schema": "fora/v1", "data": …, "meta": { … } }.
 */

export const SCHEMA = "fora/v1";

export interface EnvelopeMeta {
  approx_tokens: number;
  [key: string]: unknown;
}

export interface Envelope<T> {
  schema: typeof SCHEMA;
  data: T;
  meta: EnvelopeMeta;
}

/** Rough token estimate (~4 characters per token) for agent budgeting. */
export function approxTokens(value: unknown): number {
  let json: string;
  try {
    json = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return 0;
  }
  return Math.max(1, Math.ceil((json?.length ?? 0) / 4));
}

export function envelope<T>(data: T, meta: Record<string, unknown> = {}): Envelope<T> {
  return { schema: SCHEMA, data, meta: { approx_tokens: approxTokens(data), ...meta } };
}
