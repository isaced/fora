/**
 * RSS/Atom fallback adapter (SPEC §7.6) — the documented long-tail net for
 * forums that only expose a feed. Only `latest` and (when the feed carries
 * full content) `topic` are supported.
 */

import { XMLParser } from "fast-xml-parser";
import { unsupported, type Adapter } from "../../core/adapter.ts";
import { formatCliError, missingBaseUrlError } from "../../core/error-format.ts";
import { NotFoundError, UsageError } from "../../core/errors.ts";
import { excerptOf, htmlToText } from "../../core/html.ts";
import { HttpClient } from "../../core/http.ts";
import type { Post, Topic, TopicDetail } from "../../core/model.ts";
import type { Site } from "../../core/sites.ts";
import { toRfc3339 } from "../../core/time.ts";

const EPOCH = "1970-01-01T00:00:00.000Z";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
});

export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  author?: string;
  category?: string;
  created: string;
  excerptHtml: string;
  contentHtml: string;
}

function baseUrl(site: Site): string {
  if (!site.base_url) throw new UsageError(missingBaseUrlError(site.name, true));
  return site.base_url;
}

function textOf(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["#text"] === "string") return record["#text"];
  }
  return undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function entryFromRss(item: Record<string, unknown>, index: number): FeedEntry {
  const title = textOf(item.title) ?? "(untitled)";
  const link = textOf(item.link) ?? textOf(item.guid) ?? "";
  const guid = textOf(item.guid) ?? link ?? String(index);
  const creator = textOf(item["dc:creator"]) ?? textOf(item.author);
  const created = toRfc3339(textOf(item.pubDate) ?? textOf(item["dc:date"])) ?? EPOCH;
  const description = textOf(item.description) ?? "";
  const content = textOf(item["content:encoded"]) ?? description;
  return {
    id: guid,
    title,
    url: link,
    author: creator,
    category: textOf(item.category),
    created,
    excerptHtml: description,
    contentHtml: content,
  };
}

function linkFromAtom(linkValue: unknown): string {
  const links = asArray(linkValue as Record<string, unknown> | Record<string, unknown>[]);
  const alternate = links.find((link) => link["@rel"] === "alternate") ?? links[0];
  if (!alternate) return "";
  return String(alternate["@href"] ?? "");
}

function entryFromAtom(entry: Record<string, unknown>, index: number): FeedEntry {
  const title = textOf(entry.title) ?? "(untitled)";
  const id = textOf(entry.id) ?? linkFromAtom(entry.link) ?? String(index);
  const author = textOf((entry.author as Record<string, unknown> | undefined)?.name);
  const created =
    toRfc3339(textOf(entry.published) ?? textOf(entry.updated)) ?? EPOCH;
  const summary = textOf(entry.summary) ?? "";
  const content = textOf(entry.content) ?? summary;
  return {
    id,
    title,
    url: linkFromAtom(entry.link),
    author,
    created,
    excerptHtml: summary || content,
    contentHtml: content,
  };
}

export function parseFeed(xml: string): FeedEntry[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new UsageError(
      formatCliError("could not parse the RSS/Atom feed", [
        { heading: "Check that base_url points to a feed, not an HTML page:", lines: ["fora sites list"] },
      ]),
    );
  }

  if (parsed.rss) {
    const rss = parsed.rss as Record<string, unknown>;
    const channel = (rss.channel ?? {}) as Record<string, unknown>;
    return asArray(channel.item as Record<string, unknown> | Record<string, unknown>[]).map(entryFromRss);
  }
  if (parsed.feed) {
    const feed = parsed.feed as Record<string, unknown>;
    return asArray(feed.entry as Record<string, unknown> | Record<string, unknown>[]).map(entryFromAtom);
  }
  throw new UsageError(
    formatCliError("the feed is neither RSS 2.0 nor Atom", [
      { heading: "Expected a <rss> or <feed> root element:", lines: ["fora sites list"] },
    ]),
  );
}

export function feedEntryToTopic(entry: FeedEntry, site: Site): Topic {
  return {
    id: entry.id,
    site: site.name,
    title: entry.title,
    url: entry.url,
    author: entry.author ? { username: entry.author } : undefined,
    category: entry.category ? { id: entry.category, name: entry.category } : undefined,
    created_at: entry.created,
    last_activity_at: entry.created,
    excerpt: excerptOf(entry.excerptHtml),
    pinned: false,
  };
}

export function feedEntryToDetail(
  entry: FeedEntry,
  site: Site,
  page: number,
  engine = "rss",
): TopicDetail {
  if (!entry.contentHtml) unsupported(engine, "topic (this feed has no full content)");

  const posts: Post[] = [
    {
      id: entry.id,
      topic_id: entry.id,
      floor: 1,
      author: entry.author ? { username: entry.author } : undefined,
      content_text: htmlToText(entry.contentHtml),
      content_html: entry.contentHtml,
      created_at: entry.created,
    },
  ];

  return {
    ...feedEntryToTopic(entry, site),
    posts,
    post_count: 1,
    page,
    pages: 1,
  };
}

export function createRssAdapter(http: HttpClient = new HttpClient()): Adapter {
  const engine = "rss";

  const loadEntries = async (site: Site): Promise<FeedEntry[]> => {
    const xml = await http.getText(baseUrl(site));
    return parseFeed(xml);
  };

  return {
    engine,
    capabilities: { hot: false, latest: true, hotPeriods: false, topic: true, search: false, categories: false },

    async detect(): Promise<boolean> {
      return false;
    },

    async hot(): Promise<Topic[]> {
      unsupported(engine, "hot");
    },

    async latest(site: Site, opts): Promise<Topic[]> {
      const entries = await loadEntries(site);
      return entries.slice(0, opts.limit).map((entry) => feedEntryToTopic(entry, site));
    },

    async topic(site: Site, ref: string, page: number): Promise<TopicDetail> {
      const entries = await loadEntries(site);
      const entry = entries.find((candidate) => candidate.id === ref || candidate.url === ref);
      if (!entry) throw new NotFoundError(`no feed item matching "${ref}"`);

      return feedEntryToDetail(entry, site, page, engine);
    },

    async search(): Promise<Topic[]> {
      unsupported(engine, "search");
    },

    async categories(): Promise<never> {
      unsupported(engine, "categories");
    },
  };
}

const adapter = createRssAdapter();
export default adapter;
