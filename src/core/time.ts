/**
 * Time helpers: normalise source timestamps to UTC RFC 3339, render relative
 * times for humans, and parse `--since` durations.
 */

import { formatCliError } from "./error-format.ts";
import { UsageError } from "./errors.ts";

type TimeInput = string | number | Date | null | undefined;

/** Convert a unix timestamp (s or ms), ISO string, or Date to RFC 3339 UTC. */
export function toRfc3339(value: TimeInput): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;

  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value > 1e12 ? value : value * 1000);
  } else if (/^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    date = new Date(n > 1e12 ? n : n * 1000);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** RFC 3339 UTC, falling back to `fallback` when the input is unusable. */
export function toRfc3339Or(value: TimeInput, fallback: string): string {
  return toRfc3339(value) ?? fallback;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Render a timestamp as a compact relative time ("3h ago", "in 2d"). */
export function relativeTime(value: TimeInput, now: number = Date.now()): string {
  const iso = toRfc3339(value);
  if (!iso) return "-";
  const then = new Date(iso).getTime();
  const diff = now - then;

  if (diff < 0) {
    const ahead = -diff;
    if (ahead < MINUTE) return "just now";
    if (ahead < HOUR) return `in ${Math.round(ahead / MINUTE)}m`;
    if (ahead < DAY) return `in ${Math.round(ahead / HOUR)}h`;
    return `in ${Math.round(ahead / DAY)}d`;
  }

  if (diff < 45_000) return "just now";
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  if (diff < MONTH) return `${Math.round(diff / DAY)}d ago`;
  if (diff < YEAR) return `${Math.round(diff / MONTH)}mo ago`;
  return `${Math.round(diff / YEAR)}y ago`;
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: MINUTE,
  h: HOUR,
  d: DAY,
  w: 7 * DAY,
};

/**
 * Parse a human duration such as "24h", "7d", "30m", "1w" or "1h30m" into
 * milliseconds. Bare numbers are rejected so units stay explicit.
 */
export function parseDuration(input: string): number {
  const raw = input.trim();
  if (!raw) {
    throw new UsageError(
      formatCliError("--since requires a duration", [
        { heading: "Examples:", lines: ["30m, 24h, 7d, 1w, 1h30m"] },
      ]),
    );
  }

  const pattern = /(\d+(?:\.\d+)?)\s*([smhdw])/gi;
  let total = 0;
  let consumed = "";
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    total += amount * (DURATION_UNITS[unit] ?? 0);
    consumed += match[0];
  }

  const normalised = raw.replace(/\s+/g, "").toLowerCase();
  const consumedNormalised = consumed.replace(/\s+/g, "").toLowerCase();
  if (total <= 0 || consumedNormalised !== normalised) {
    throw new UsageError(
      formatCliError(`invalid duration "${input}"`, [
        { heading: "Use an explicit unit:", lines: ["30m, 24h, 7d, 1w, 1h30m"] },
      ]),
    );
  }
  return total;
}

/** True when `createdAt` or `lastActivityAt` falls inside the window. */
export function withinSince(
  createdAt: string | undefined,
  lastActivityAt: string | undefined,
  sinceMs: number | undefined,
  now: number = Date.now(),
): boolean {
  if (sinceMs === undefined) return true;
  const cutoff = now - sinceMs;
  for (const value of [createdAt, lastActivityAt]) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time >= cutoff) return true;
  }
  return false;
}
