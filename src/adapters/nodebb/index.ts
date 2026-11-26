/**
 * NodeBB adapter (SPEC §7.5). Period maps to the popular endpoint's term.
 */

import { unsupported, type Adapter, type HotOpts, type ListOpts, type SiteCandidate } from "../../core/adapter.ts";
import { missingBaseUrlError } from "../../core/error-format.ts";
import { UsageError } from "../../core/errors.ts";
import { excerptOf, htmlToText } from "../../core/html.ts";
import { HttpClient } from "../../core/http.ts";
import type { Author, Category, Post, Topic, TopicDetail } from "../../core/model.ts";
import type { Site } from "../../core/sites.ts";
import { toRfc3339 } from "../../core/time.ts";

const EPOCH = "1970-01-01T00:00:00.000Z";

interface NodebbUser {
  username?: string;
  userslug?: string;
  displayname?: string;
  picture?: string;
}

interface NodebbTopic {
  tid: number;
  title: string;
  slug: string;
  cid?: number;
  postcount?: number;
  viewcount?: number;
  timestamp?: number;
  lastposttime?: number;
  pinned?: boolean;
  tags?: string[];
  user?: NodebbUser;
  category?: { name?: string };
  teaser?: { content?: string };
  posts?: NodebbPost[];
  pagination?: { pageCount?: number };
}

interface NodebbPost {
  pid: number;
  tid?: number;
  content?: string;
  timestamp?: number;
  index?: number;
  upvotes?: number;
  user?: NodebbUser;
}

interface NodebbSearchPost extends NodebbPost {
  topic?: NodebbTopic;
  category?: { name?: string };
  isMainPost?: boolean;
}

function baseUrl(site: Site): string {
  if (!site.base_url) throw new UsageError(missingBaseUrlError(site.name));
  return site.base_url.replace(/\/+$/, "");
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

function authorFrom(user: NodebbUser | undefined): Author | undefined {
  if (!user?.username && !user?.userslug) return undefined;
  return {
    username: user.username ?? user.userslug ?? "",
    display_name: user.displayname,
    avatar_url: user.picture,
  };
}

function topicUrl(base: string, topic: { slug?: string; tid: number }): string {
  return topic.slug ? `${base}/topic/${topic.slug}` : `${base}/topic/${topic.tid}`;
}

function mapTopic(topic: NodebbTopic, site: Site, base: string): Topic {
  const created = toRfc3339(topic.timestamp) ?? EPOCH;
  const lastActivity = toRfc3339(topic.lastposttime) ?? created;
  return {
    id: String(topic.tid),
    site: site.name,
    title: topic.title,
    url: topicUrl(base, topic),
    author: authorFrom(topic.user),
    category: topic.cid ? { id: String(topic.cid), name: topic.category?.name } : undefined,
    tags: topic.tags && topic.tags.length > 0 ? topic.tags : undefined,
    reply_count: typeof topic.postcount === "number" ? Math.max(0, topic.postcount - 1) : undefined,
    view_count: topic.viewcount,
    created_at: created,
    last_activity_at: lastActivity,
    excerpt: topic.teaser?.content ? excerptOf(topic.teaser.content) : undefined,
    pinned: Boolean(topic.pinned),
  };
}

function mapSearchPost(post: NodebbSearchPost, site: Site, base: string): Topic {
  const topic = post.topic ?? ({
    tid: post.tid ?? 0,
    title: "",
    slug: "",
  } as NodebbTopic);
  const mapped = mapTopic(topic, site, base);
  return {
    ...mapped,
    author: authorFrom(topic.user) ?? authorFrom(post.user),
    category: topic.category?.name
      ? { id: String(topic.cid ?? ""), name: topic.category.name }
      : post.category?.name
        ? { id: String(topic.cid ?? ""), name: post.category.name }
        : mapped.category,
    excerpt: post.content ? excerptOf(post.content) : mapped.excerpt,
  };
}

function mapPost(post: NodebbPost): Post {
  return {
    id: String(post.pid),
    topic_id: String(post.tid ?? ""),
    floor: typeof post.index === "number" ? post.index + 1 : 1,
    author: authorFrom(post.user),
    content_text: htmlToText(post.content),
    content_html: post.content,
    created_at: toRfc3339(post.timestamp) ?? EPOCH,
    like_count: post.upvotes,
  };
}

export function createNodebbAdapter(http: HttpClient = new HttpClient()): Adapter {
  const engine = "nodebb";

  const termFor = (period: NonNullable<HotOpts["period"]>): string => {
    switch (period) {
      case "day":
        return "daily";
      case "week":
        return "weekly";
      case "month":
        return "monthly";
      case "all":
        return "alltime";
    }
  };

  return {
    engine,
    capabilities: { hot: true, latest: true, hotPeriods: true, topic: true, search: true, categories: true },

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const origin = originOf(candidate);
      if (!origin) return false;
      try {
        const config = await http.getJson<Record<string, unknown>>(`${origin}/api/config`);
        return Boolean(config && (config.version || config.relative_path || config.siteTitle || config.ns));
      } catch {
        return false;
      }
    },

    async hot(site: Site, opts: HotOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const term = termFor(opts.period ?? "day");
      const response = await http.getJson<{ topics?: NodebbTopic[] }>(`${base}/api/popular?term=${term}`);
      return (response.topics ?? []).slice(0, opts.limit).map((topic) => mapTopic(topic, site, base));
    },

    async latest(site: Site, opts: ListOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const response = await http.getJson<{ topics?: NodebbTopic[] }>(`${base}/api/recent`);
      return (response.topics ?? []).slice(0, opts.limit).map((topic) => mapTopic(topic, site, base));
    },

    async topic(site: Site, ref: string, page: number): Promise<TopicDetail> {
      const base = baseUrl(site);
      const topic = await http.getJson<NodebbTopic>(`${base}/api/topic/${encodeURIComponent(ref)}`);
      const mapped = mapTopic(topic, site, base);
      const posts = (topic.posts ?? []).map(mapPost);
      const postCount = topic.postcount ?? posts.length;
      const pages = Math.max(1, topic.pagination?.pageCount ?? 1);

      return {
        ...mapped,
        excerpt: posts[0] ? excerptOf(posts[0].content_html) : mapped.excerpt,
        posts,
        post_count: postCount,
        page,
        pages,
      };
    },

    async search(site: Site, query: string, opts: ListOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const response = await http.getJson<{ posts?: NodebbSearchPost[]; topics?: NodebbTopic[] }>(
        `${base}/api/search?term=${encodeURIComponent(query)}`,
      );
      if (response.topics) {
        return response.topics.slice(0, opts.limit).map((topic) => mapTopic(topic, site, base));
      }
      return (response.posts ?? []).slice(0, opts.limit).map((post) => mapSearchPost(post, site, base));
    },

    async categories(site: Site): Promise<Category[]> {
      const base = baseUrl(site);
      const response = await http.getJson<{ categories?: Array<Record<string, unknown>> }>(
        `${base}/api/categories`,
      );
      const categories = response.categories ?? [];
      return categories.map((category) => ({
        id: String(category.cid),
        name: String(category.name ?? ""),
        slug: typeof category.slug === "string" ? category.slug : undefined,
        description: typeof category.description === "string" ? category.description : undefined,
        topic_count: typeof category.topic_count === "number" ? category.topic_count : undefined,
      }));
    },
  };
}

const adapter = createNodebbAdapter();
export default adapter;
