/**
 * Discourse adapter — the engine multiplier: one adapter serves linux.do and
 * every other Discourse instance. Endpoints follow SPEC §7.1.
 */

import type { Adapter, HotOpts, ListOpts, SiteCandidate } from "../../core/adapter.ts";
import { missingBaseUrlError } from "../../core/error-format.ts";
import { UsageError } from "../../core/errors.ts";
import { excerptOf, htmlToText } from "../../core/html.ts";
import { HttpClient } from "../../core/http.ts";
import type { Author, Category, Post, Topic, TopicDetail } from "../../core/model.ts";
import type { Site } from "../../core/sites.ts";
import { toRfc3339, toRfc3339Or } from "../../core/time.ts";

const EPOCH = "1970-01-01T00:00:00.000Z";

interface DiscourseUser {
  id: number;
  username: string;
  name?: string;
  avatar_template?: string;
}

interface DiscoursePoster {
  user_id: number;
  description?: string;
}

interface DiscourseTopic {
  id: number;
  title: string;
  slug?: string;
  posts_count?: number;
  reply_count?: number;
  views?: number;
  like_count?: number;
  created_at?: string;
  last_posted_at?: string;
  bumped_at?: string;
  pinned?: boolean;
  excerpt?: string;
  tags?: string[];
  category_id?: number;
  posters?: DiscoursePoster[];
}

interface DiscoursePost {
  id: number;
  topic_id?: number;
  post_number?: number;
  username?: string;
  name?: string;
  avatar_template?: string;
  created_at?: string;
  cooked?: string;
  actions_summary?: Array<{ id: number; count?: number }>;
}

interface DiscourseTopicResponse extends DiscourseTopic {
  post_stream?: { posts?: DiscoursePost[]; stream?: number[]; chunk_size?: number };
  details?: { created_by?: DiscourseUser };
}

interface DiscourseListResponse {
  users?: DiscourseUser[];
  topic_list?: { topics?: DiscourseTopic[] };
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
      // fall through to host
    }
  }
  if (candidate.host) return `https://${candidate.host}`;
  return undefined;
}

function avatarUrl(base: string, template: string | undefined): string | undefined {
  if (!template) return undefined;
  const sized = template.replace("{size}", "120");
  if (sized.startsWith("http")) return sized;
  if (sized.startsWith("//")) return `https:${sized}`;
  return `${base}${sized.startsWith("/") ? "" : "/"}${sized}`;
}

function authorFrom(base: string, user: DiscourseUser | undefined): Author | undefined {
  if (!user) return undefined;
  return {
    username: user.username,
    display_name: user.name,
    avatar_url: avatarUrl(base, user.avatar_template),
  };
}

function likeCountOf(post: DiscoursePost): number | undefined {
  const like = post.actions_summary?.find((action) => action.id === 2);
  return typeof like?.count === "number" ? like.count : undefined;
}

function topicUrl(base: string, topic: { id: number; slug?: string }): string {
  return topic.slug ? `${base}/t/${topic.slug}/${topic.id}` : `${base}/t/${topic.id}`;
}

export function discourseTopicRef(url: URL): string | undefined {
  return url.pathname.match(/\/t\/(\d+)(?=\/|$)/)?.[1] ??
    url.pathname.match(/\/t\/[^/]+\/(\d+)(?=\/|$)/)?.[1];
}

function mapTopic(topic: DiscourseTopic, users: Map<number, DiscourseUser>, site: Site, base: string): Topic {
  const posters = topic.posters ?? [];
  const opPoster = posters.find((poster) => /original poster/i.test(poster.description ?? "")) ?? posters[0];
  const author = opPoster ? authorFrom(base, users.get(opPoster.user_id)) : undefined;

  const replyCount =
    typeof topic.reply_count === "number"
      ? topic.reply_count
      : typeof topic.posts_count === "number"
        ? Math.max(0, topic.posts_count - 1)
        : undefined;

  const created = toRfc3339(topic.created_at) ?? EPOCH;
  const lastActivity = toRfc3339(topic.last_posted_at) ?? toRfc3339(topic.bumped_at) ?? created;

  return {
    id: String(topic.id),
    site: site.name,
    title: topic.title,
    url: topicUrl(base, topic),
    author,
    category: topic.category_id ? { id: String(topic.category_id) } : undefined,
    tags: topic.tags,
    reply_count: replyCount,
    view_count: topic.views,
    like_count: topic.like_count,
    created_at: created,
    last_activity_at: lastActivity,
    excerpt: topic.excerpt ? htmlToText(topic.excerpt) : undefined,
    pinned: Boolean(topic.pinned),
  };
}

function mapList(response: DiscourseListResponse, site: Site, base: string, limit: number): Topic[] {
  const users = new Map<number, DiscourseUser>();
  for (const user of response.users ?? []) users.set(user.id, user);
  const topics = response.topic_list?.topics ?? [];
  return topics.slice(0, limit).map((topic) => mapTopic(topic, users, site, base));
}

function mapPost(post: DiscoursePost, base: string): Post {
  return {
    id: String(post.id),
    topic_id: String(post.topic_id ?? ""),
    floor: post.post_number ?? 1,
    author: post.username
      ? { username: post.username, display_name: post.name, avatar_url: avatarUrl(base, post.avatar_template) }
      : undefined,
    content_text: htmlToText(post.cooked),
    content_html: post.cooked,
    created_at: toRfc3339Or(post.created_at, EPOCH),
    like_count: likeCountOf(post),
  };
}

export function createDiscourseAdapter(http: HttpClient = new HttpClient()): Adapter {
  const engine = "discourse";

  return {
    engine,
    topicRefFromUrl: discourseTopicRef,
    capabilities: { hot: true, latest: true, hotPeriods: true, topic: true, search: true, categories: true },

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const base = originOf(candidate);
      if (!base) return false;
      try {
        const info = await http.getJson<Record<string, unknown>>(`${base}/site.json`);
        return Boolean(info && (info.default_archetype || info.post_action_types || info.topic));
      } catch {
        return false;
      }
    },

    async hot(site: Site, opts: HotOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const period = periodToDiscourse(opts.period ?? "day");
      const response = await http.getJson<DiscourseListResponse>(`${base}/top.json?period=${period}`);
      return mapList(response, site, base, opts.limit);
    },

    async latest(site: Site, opts: ListOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const response = await http.getJson<DiscourseListResponse>(`${base}/latest.json`);
      return mapList(response, site, base, opts.limit);
    },

    async topic(site: Site, ref: string, page: number): Promise<TopicDetail> {
      const base = baseUrl(site);
      const url = URL.canParse(ref) ? new URL(ref) : undefined;
      const id = (url && discourseTopicRef(url)) ?? ref;
      const response = await http.getJson<DiscourseTopicResponse>(`${base}/t/${encodeURIComponent(id)}.json?page=${page}`);

      const posts = (response.post_stream?.posts ?? []).map((post) => mapPost(post, base));
      const postCount = response.posts_count ?? posts.length;
      const chunkSize = response.post_stream?.chunk_size ?? 20;
      const pages = Math.max(1, Math.ceil(postCount / chunkSize));

      const author = authorFrom(base, response.details?.created_by);
      const created = toRfc3339(response.created_at) ?? EPOCH;
      const lastActivity = toRfc3339(response.last_posted_at) ?? created;
      const firstPost = posts[0];

      return {
        id: String(response.id),
        site: site.name,
        title: response.title,
        url: topicUrl(base, response),
        author: author ?? firstPost?.author,
        category: response.category_id ? { id: String(response.category_id) } : undefined,
        tags: response.tags,
        reply_count: response.reply_count ?? Math.max(0, postCount - 1),
        view_count: response.views,
        like_count: response.like_count,
        created_at: created,
        last_activity_at: lastActivity,
        excerpt: firstPost ? excerptOf(firstPost.content_html) : undefined,
        pinned: Boolean(response.pinned),
        posts,
        post_count: postCount,
        page,
        pages,
      };
    },

    async search(site: Site, query: string, opts: ListOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const response = await http.getJson<{
        topics?: DiscourseTopic[];
        users?: DiscourseUser[];
        topic_list?: { topics?: DiscourseTopic[] };
      }>(`${base}/search.json?q=${encodeURIComponent(query)}`);
      const users = new Map<number, DiscourseUser>();
      for (const user of response.users ?? []) users.set(user.id, user);
      const topics = response.topics ?? response.topic_list?.topics ?? [];
      return topics.slice(0, opts.limit).map((topic) => mapTopic(topic, users, site, base));
    },

    async categories(site: Site): Promise<Category[]> {
      const base = baseUrl(site);
      const response = await http.getJson<{
        category_list?: { categories?: Array<Record<string, unknown>> };
      }>(`${base}/categories.json`);
      const categories = response.category_list?.categories ?? [];
      return categories.map((category) => ({
        id: String(category.id),
        name: String(category.name ?? ""),
        slug: typeof category.slug === "string" ? category.slug : undefined,
        description:
          typeof category.description_text === "string"
            ? category.description_text
            : typeof category.description === "string"
              ? category.description
              : undefined,
        topic_count: typeof category.topic_count === "number" ? category.topic_count : undefined,
      }));
    },
  };
}

function periodToDiscourse(period: NonNullable<HotOpts["period"]>): string {
  switch (period) {
    case "day":
      return "daily";
    case "week":
      return "weekly";
    case "month":
      return "monthly";
    case "all":
      return "all";
  }
}

const adapter = createDiscourseAdapter();
export default adapter;
