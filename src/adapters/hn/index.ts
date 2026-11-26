/**
 * Hacker News adapter — the simplest adapter, and the worked example in
 * docs/writing-an-adapter.md. Two APIs are composed: the Firebase API for
 * stories/comments and Algolia for search (SPEC §7.3).
 */

import { mapLimit } from "../../core/async.ts";
import { unsupported, type Adapter, type ListOpts, type SiteCandidate } from "../../core/adapter.ts";
import { excerptOf, htmlToText } from "../../core/html.ts";
import { HttpClient } from "../../core/http.ts";
import type { Author, Post, Topic, TopicDetail } from "../../core/model.ts";
import type { Site } from "../../core/sites.ts";
import { toRfc3339 } from "../../core/time.ts";

const EPOCH = "1970-01-01T00:00:00.000Z";
const FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA_SEARCH = "https://hn.algolia.com/api/v1/search";
const ITEM_CONCURRENCY = 8;
const COMMENT_CAP = 200;

interface HnItem {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
}

interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  created_at_i?: number;
  story_text?: string;
}

function mapItem(item: HnItem, site: Site): Topic {
  const created = toRfc3339(item.time) ?? EPOCH;
  return {
    id: String(item.id),
    site: site.name,
    title: item.title ?? "",
    url: `https://news.ycombinator.com/item?id=${item.id}`,
    source_url: item.url,
    author: item.by ? { username: item.by } : undefined,
    reply_count: item.descendants,
    like_count: item.score,
    created_at: created,
    last_activity_at: created,
    excerpt: item.text ? excerptOf(item.text) : undefined,
    pinned: false,
  };
}

function mapComment(item: HnItem, topicId: string, floor: number): Post {
  return {
    id: String(item.id),
    topic_id: topicId,
    floor,
    author: item.by ? { username: item.by } : undefined,
    content_text: htmlToText(item.text),
    content_html: item.text,
    created_at: toRfc3339(item.time) ?? EPOCH,
    like_count: 0,
  };
}

export function createHnAdapter(http: HttpClient = new HttpClient({ minIntervalMs: 0 })): Adapter {
  const engine = "hn";

  const fetchItem = async (id: number): Promise<HnItem | undefined> => {
    try {
      return await http.getJson<HnItem>(`${FIREBASE_BASE}/item/${id}.json`);
    } catch {
      return undefined;
    }
  };

  const fetchStories = async (path: "topstories" | "newstories", limit: number): Promise<Topic[]> => {
    const ids = await http.getJson<number[]>(`${FIREBASE_BASE}/${path}.json`);
    const selected = ids.slice(0, limit);
    const items = await mapLimit(selected, ITEM_CONCURRENCY, (id) => fetchItem(id));
    return items.filter((item): item is HnItem => item !== undefined).map((item) => mapItem(item, { name: "hn" } as Site));
  };

  return {
    engine,
    topicRefFromUrl: (url) => url.pathname === "/item" ? url.searchParams.get("id") ?? undefined : undefined,
    capabilities: { hot: true, latest: true, hotPeriods: false, topic: true, search: true, categories: false },

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const raw = candidate.url ?? candidate.base_url ?? (candidate.host ? `https://${candidate.host}` : undefined);
      if (!raw) return false;
      try {
        const host = new URL(raw).hostname;
        return host === "news.ycombinator.com" || host === "hn.algolia.com";
      } catch {
        return false;
      }
    },

    async hot(site: Site, opts): Promise<Topic[]> {
      if (opts.period) unsupported(engine, "hot --period");
      const ids = await http.getJson<number[]>(`${FIREBASE_BASE}/topstories.json`);
      const selected = ids.slice(0, opts.limit);
      const items = await mapLimit(selected, ITEM_CONCURRENCY, (id) => fetchItem(id));
      return items
        .filter((item): item is HnItem => item !== undefined)
        .map((item) => mapItem(item, site));
    },

    async latest(site: Site, opts: ListOpts): Promise<Topic[]> {
      const topics = await fetchStories("newstories", opts.limit);
      return topics.map((topic) => ({ ...topic, site: site.name }));
    },

    async topic(site: Site, ref: string, page: number): Promise<TopicDetail> {
      const item = await fetchItem(Number(ref));
      if (!item) throw new Error(`Hacker News item ${ref} was not found`);

      const posts: Post[] = [];
      if (item.text || item.title) {
        posts.push({
          id: String(item.id),
          topic_id: String(item.id),
          floor: 1,
          author: item.by ? { username: item.by } : undefined,
          content_text: htmlToText(item.text),
          content_html: item.text,
          created_at: toRfc3339(item.time) ?? EPOCH,
          like_count: item.score,
        });
      }

      let floor = 2;

      const walk = async (ids: number[]): Promise<void> => {
        for (const id of ids) {
          if (posts.length >= COMMENT_CAP) continue;
          const comment = await fetchItem(id);
          if (!comment || comment.deleted) continue;
          posts.push(mapComment(comment, String(item.id), floor));
          floor += 1;
          if (comment.kids && comment.kids.length > 0) await walk(comment.kids);
        }
      };

      await walk(item.kids ?? []);

      const fetchedReplies = Math.max(0, posts.length - 1);
      const totalReplies = item.descendants ?? fetchedReplies;
      const omitted = Math.max(0, totalReplies - fetchedReplies);
      const truncated = omitted > 0;

      return {
        ...mapItem(item, site),
        posts,
        post_count: totalReplies + 1,
        total_replies: totalReplies,
        fetched_replies: fetchedReplies,
        page,
        pages: 1,
        truncated: truncated || undefined,
        omitted_replies: omitted > 0 ? omitted : undefined,
      };
    },

    async search(site: Site, query: string, opts: ListOpts): Promise<Topic[]> {
      const response = await http.getJson<{ hits?: AlgoliaHit[] }>(
        `${ALGOLIA_SEARCH}?query=${encodeURIComponent(query)}&tags=story`,
      );
      const hits = response.hits ?? [];
      return hits.slice(0, opts.limit).map((hit) => {
        const created = toRfc3339(hit.created_at) ?? toRfc3339(hit.created_at_i) ?? EPOCH;
        return {
          id: hit.objectID,
          site: site.name,
          title: hit.title ?? "",
          url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source_url: hit.url,
          author: hit.author ? { username: hit.author } : undefined,
          reply_count: hit.num_comments,
          like_count: hit.points,
          created_at: created,
          last_activity_at: created,
          excerpt: hit.story_text ? excerptOf(hit.story_text) : undefined,
          pinned: false,
        };
      });
    },

    async categories(): Promise<never> {
      unsupported(engine, "categories");
    },
  };
}

const adapter = createHnAdapter();
export default adapter;
