/**
 * Minimal, dependency-free HTML → plain-text conversion.
 *
 * Forums hand us HTML in many flavours (Discourse "cooked", V2EX
 * content_rendered, NodeBB content, HN comment text). The model requires
 * plain text for `content_text` and `excerpt`, so every adapter funnels HTML
 * through here: strip tags, decode entities, collapse whitespace.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  euro: "€",
  pound: "£",
  yen: "¥",
  times: "×",
};

/** Decode HTML named and numeric entities. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Convert an HTML fragment to readable plain text. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let text = String(html);

  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|ul|ol|h[1-6]|blockquote|pre|tr|table|section|article)>/gi, "\n");
  text = text.replace(/<li\b[^>]*>/gi, "• ");
  text = text.replace(/<(hr)\b[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");

  text = decodeEntities(text);
  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/[\t\f\v\u00a0 ]+/g, " ");
  text = text.replace(/ *\n */g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** A single-line preview of an HTML/text body, capped at `max` characters. */
export function excerptOf(html: string | null | undefined, max = 200): string {
  const text = htmlToText(html).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/** Truncate a plain string to `max` characters, adding an ellipsis. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
