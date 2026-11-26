/**
 * `--fields` projection for list and digest payloads (gh-style, SPEC §6.2).
 * The named model fields are returned; `site` is always kept so a flat,
 * multi-site list stays interpretable.
 */

import { formatCliError, wrapValues } from "./error-format.ts";
import { UsageError } from "./errors.ts";
import type { Topic } from "./model.ts";

export const TOPIC_FIELDS = [
  "id",
  "site",
  "title",
  "url",
  "source_url",
  "author",
  "category",
  "tags",
  "reply_count",
  "view_count",
  "like_count",
  "created_at",
  "last_activity_at",
  "excerpt",
  "pinned",
] as const;

export type TopicField = (typeof TOPIC_FIELDS)[number];

export function parseFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const fields = raw
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) {
    throw new UsageError(
      formatCliError("--fields needs at least one field name", [
        { heading: "Example:", lines: ["--fields title,url,reply_count"] },
      ]),
    );
  }

  const invalid = fields.filter((field) => !(TOPIC_FIELDS as readonly string[]).includes(field));
  if (invalid.length > 0) {
    throw new UsageError(
      formatCliError(`unknown --fields value(s): ${invalid.join(", ")}`, [
        { heading: "Valid fields:", lines: wrapValues([...TOPIC_FIELDS], 70) },
      ]),
    );
  }
  return fields;
}

/** Project a topic onto the requested fields (plus site). */
export function pickTopicFields(topic: Topic, fields: string[] | undefined): Partial<Topic> {
  if (!fields) return topic;

  const wanted = new Set(fields);
  wanted.add("site");

  const source = topic as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of TOPIC_FIELDS) {
    if (wanted.has(field) && source[field] !== undefined) result[field] = source[field];
  }
  return result as Partial<Topic>;
}

export function applyFields(topics: Topic[], fields: string[] | undefined): Array<Partial<Topic>> {
  if (!fields) return topics;
  return topics.map((topic) => pickTopicFields(topic, fields));
}
