/**
 * Ruby China adapter — Homeland's public v3 JSON API.
 *
 * The API has no time-window ranking and no documented search endpoint, so
 * `hotPeriods` and `search` are off. Everything else maps directly from the
 * documented serializers.
 */

import { unsupported, type Adapter, type ListOpts, type SiteCandidate } from "../../core/adapter.ts";
import { missingBaseUrlError } from "../../core/error-format.ts";
import { UsageError } from "../../core/errors.ts";
import { HttpClient } from "../../core/http.ts";
import { htmlToText } from "../../core/html.ts";
import type { Author, Category, Post, Topic, TopicDetail } from "../../core/model.ts";
import type { Site } from "../../core/sites.ts";
import { toRfc3339 } from "../../core/time.ts";

const EPOCH = "2026-01-01T00:00:00.000Z";
const REPLY_PAGE_SIZE = 50;

interface RubyChinaUser {
  login?: string;
  name?: string;
  avatar_url?: string;
}

interface RubyChinaTopic {
  id: number;
  title?: string;
  node_id?: number;
  node_name?: string;
  excellent?: number | boolean;
  replies_count?: number;
  likes_count?: number;
  hits?: number;
  user?: RubyChinaUser;
  body_html?: string;
  created_at?: string;
  replied_at?: string;
  updated_at?: string;
}

interface RubyChinaReply {
  id: number;
  topic_id?: number;
  body_html?: string;
  likes_count?: number;
  user?: RubyChinaUser;
  created_at?: string;
  updated_at?: string;
  deleted?: boolean;
}

interface RubyChinaNode {
  id: number;
  name?: string;
  summary?: string;
  topics_count?: number;
}

function baseUrl(site: Site): string {
  if (!site.base_url) throw new UsageError(missingBaseUrlError(site.name));
  try {
    return new URL(site.base_url).origin;
  } catch {
    throw new UsageError(missingBaseUrlError(site.name));
  }
}

function originOf(candidate: SiteCandidate): string | undefined {
  const raw = candidate.url ?? candidate.base_url;
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // fall through
    }
  }
  if (candidate.host) return `https://${candidate.host}`;
  return undefined;
}

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const record = value as { topics?: T[]; replies?: T[]; nodes?: T[] } | undefined;
  return record?.topics ?? record?.replies ?? record?.nodes ?? [];
}

function authorOf(user: RubyChinaUser | undefined): Author | undefined {
  if (!user?.login) return undefined;
  return {
    username: user.login,
    display_name: user.name || undefined,
    avatar_url: user.avatar_url,
  };
}

function mapTopic(raw: RubyChinaTopic, site: Site, base: string): Topic {
  const id = String(raw.id);
  return {
    id,
    site: site.name,
    title: raw.title ?? "(untitled)",
    url: `${base}/topics/${id}`,
    author: authorOf(raw.user),
    category: raw.node_id ? { id: String(raw.node_id), name: raw.node_name } : undefined,
    tags: raw.excellent ? ["excellent"] : undefined,
    reply_count: raw.replies_count,
    like_count: raw.likes_count,
    view_count: raw.hits,
    created_at: toRfc3339(raw.created_at) ?? EPOCH,
    last_activity_at: toRfc3339(raw.replied_at ?? raw.updated_at ?? raw.created_at) ?? EPOCH,
    excerpt: raw.body_html ? htmlToText(raw.body_html) : undefined,
    pinned: false,
  };
}

function mapReply(raw: RubyChinaReply, floor: number): Post {
  return {
    id: String(raw.id),
    topic_id: String(raw.topic_id ?? ""),
    floor,
    author: authorOf(raw.user),
    content_text: htmlToText(raw.body_html),
    content_html: raw.body_html,
    created_at: toRfc3339(raw.created_at ?? raw.updated_at) ?? EPOCH,
    like_count: raw.likes_count,
  };
}

export function createRubyChinaAdapter(http: HttpClient = new HttpClient()): Adapter {
  const engine = "ruby-china";

  const list = async (site: Site, type: string, opts: ListOpts): Promise<Topic[]> => {
    const base = baseUrl(site);
    const limit = Math.max(1, Math.min(150, opts.limit));
    const response = await http.getJson<unknown>(
      `${base}/api/v3/topics.json?type=${encodeURIComponent(type)}&limit=${limit}&offset=0`,
    );
    return unwrap<RubyChinaTopic>(response).map((topic) => mapTopic(topic, site, base));
  };

  return {
    engine,
    topicRefFromUrl: (url) => url.pathname.match(/\/topics\/(\d+)\/?$/)?.[1],
    capabilities: { hot: true, latest: true, hotPeriods: false, topic: true, search: false, categories: true },

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const base = originOf(candidate);
      if (!base) return false;
      try {
        const response = await http.getJson<unknown>(`${base}/api/v3/topics.json?limit=1`);
        const topics = unwrap<RubyChinaTopic>(response);
        return topics.length > 0 && typeof topics[0]?.id === "number";
      } catch {
        return false;
      }
    },

    hot: (site, opts) => {
      if (opts.period) unsupported(engine, "hot --period");
      return list(site, "popular", opts);
    },
    latest: (site, opts) => list(site, "recent", opts),

    async topic(site: Site, ref: string, page: number): Promise<TopicDetail> {
      const base = baseUrl(site);
      const offset = Math.max(0, page - 1) * REPLY_PAGE_SIZE;
      const [raw, replies] = await Promise.all([
        http.getJson<RubyChinaTopic>(`${base}/api/v3/topics/${encodeURIComponent(ref)}.json`),
        http.getJson<unknown>(
          `${base}/api/v3/topics/${encodeURIComponent(ref)}/replies.json?limit=${REPLY_PAGE_SIZE}&offset=${offset}`,
        ),
      ]);
      const topic = mapTopic(raw, site, base);
      const posts: Post[] = [];
      if (raw.body_html) {
        posts.push({
          id: `${raw.id}-op`,
          topic_id: String(raw.id),
          floor: 1,
          author: authorOf(raw.user),
          content_text: htmlToText(raw.body_html),
          content_html: raw.body_html,
          created_at: topic.created_at,
        });
      }
      for (const [index, reply] of unwrap<RubyChinaReply>(replies).filter((item) => !item.deleted).entries()) {
        posts.push(mapReply(reply, offset + index + 2));
      }
      const postCount = (raw.replies_count ?? unwrap<RubyChinaReply>(replies).length) + 1;
      return {
        ...topic,
        excerpt: raw.body_html ? htmlToText(raw.body_html) : topic.excerpt,
        posts,
        post_count: postCount,
        page,
        pages: Math.max(1, Math.ceil(postCount / REPLY_PAGE_SIZE)),
      };
    },

    async search(): Promise<never> {
      unsupported(engine, "search");
    },

    async categories(site: Site): Promise<Category[]> {
      const base = baseUrl(site);
      const response = await http.getJson<unknown>(`${base}/api/v3/nodes.json`);
      return unwrap<RubyChinaNode>(response).map((node) => ({
        id: String(node.id),
        name: node.name ?? "",
        description: node.summary,
        topic_count: node.topics_count,
      }));
    },
  };
}

const adapter = createRubyChinaAdapter();
export default adapter;
