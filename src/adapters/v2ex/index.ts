/**
 * V2EX adapter — a beloved single site on a quirky legacy API (SPEC §7.2).
 * Search is unavailable in the public v1 API, and hot() has no period windows,
 * so both are reported as unsupported rather than faked.
 */

import { unsupported, type Adapter, type ListOpts, type SiteCandidate } from "../../core/adapter.ts";
import { UsageError } from "../../core/errors.ts";
import { excerptOf, htmlToText } from "../../core/html.ts";
import { HttpClient } from "../../core/http.ts";
import type { Author, Category, Post, Topic, TopicDetail } from "../../core/model.ts";
import type { Site } from "../../core/sites.ts";
import { toRfc3339 } from "../../core/time.ts";

const EPOCH = "1970-01-01T00:00:00.000Z";
const FALLBACK_BASE = "https://www.v2ex.com";
const REPLIES_PER_PAGE = 100;

interface V2exMember {
  id?: number;
  username: string;
  avatar_normal?: string;
  avatar_large?: string;
}

interface V2exNode {
  id: number;
  name: string;
  title?: string;
  url?: string;
  topics?: number;
  header?: string;
  avatar_normal?: string;
}

interface V2exTopic {
  id: number;
  title: string;
  url?: string;
  content?: string;
  content_rendered?: string;
  replies?: number;
  created?: number;
  last_modified?: number;
  last_touched?: number;
  member?: V2exMember;
  node?: V2exNode;
}

interface V2exReply {
  id: number;
  thanks?: number;
  content?: string;
  content_rendered?: string;
  created?: number;
  member?: V2exMember;
}

function baseUrl(site: Site): string {
  return (site.base_url ?? FALLBACK_BASE).replace(/\/+$/, "");
}

function absoluteUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return `${base}${value.startsWith("/") ? "" : "/"}${value}`;
}

function authorFrom(member: V2exMember | undefined): Author | undefined {
  if (!member) return undefined;
  return {
    username: member.username,
    avatar_url: absoluteUrl(member.avatar_large ?? member.avatar_normal, ""),
  };
}

function mapTopic(topic: V2exTopic, site: Site, base: string): Topic {
  const created = toRfc3339(topic.created) ?? EPOCH;
  const lastActivity = toRfc3339(topic.last_touched ?? topic.last_modified) ?? created;
  return {
    id: String(topic.id),
    site: site.name,
    title: topic.title,
    url: absoluteUrl(topic.url, base) ?? `${base}/t/${topic.id}`,
    author: authorFrom(topic.member),
    category: topic.node ? { id: String(topic.node.id), name: topic.node.title ?? topic.node.name } : undefined,
    reply_count: topic.replies,
    created_at: created,
    last_activity_at: lastActivity,
    excerpt: excerptOf(topic.content_rendered ?? topic.content),
    pinned: false,
  };
}

function bodyText(topic: V2exTopic): string {
  return htmlToText(topic.content_rendered ?? topic.content);
}

export function createV2exAdapter(http: HttpClient = new HttpClient()): Adapter {
  const engine = "v2ex";

  return {
    engine,
    topicRefFromUrl: (url) => url.pathname.match(/\/t\/(\d+)/)?.[1],
    capabilities: { hot: true, latest: true, hotPeriods: false, topic: true, search: false, categories: true },

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const base = candidate.base_url ?? candidate.url ?? (candidate.host ? `https://${candidate.host}` : undefined);
      if (!base) return false;
      let host: string;
      try {
        host = new URL(base).hostname;
      } catch {
        return false;
      }
      if (host !== "v2ex.com" && !host.endsWith(".v2ex.com")) return false;
      try {
        const nodes = await http.getJson<unknown>(`https://${host}/api/nodes/all.json`);
        return Array.isArray(nodes);
      } catch {
        return false;
      }
    },

    async hot(site: Site, opts): Promise<Topic[]> {
      if (opts.period) unsupported(engine, "hot --period");
      const base = baseUrl(site);
      const topics = await http.getJson<V2exTopic[]>(`${base}/api/topics/hot.json`);
      return topics.slice(0, opts.limit).map((topic) => mapTopic(topic, site, base));
    },

    async latest(site: Site, opts: ListOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const topics = await http.getJson<V2exTopic[]>(`${base}/api/topics/latest.json`);
      return topics.slice(0, opts.limit).map((topic) => mapTopic(topic, site, base));
    },

    async topic(site: Site, ref: string, page: number): Promise<TopicDetail> {
      const base = baseUrl(site);
      const topics = await http.getJson<V2exTopic[]>(
        `${base}/api/topics/show.json?id=${encodeURIComponent(ref)}`,
      );
      const topic = topics[0];
      if (!topic) throw new UsageError(`V2EX topic ${ref} was not found`);

      const replies = await http.getJson<V2exReply[]>(
        `${base}/api/replies/show.json?topic_id=${encodeURIComponent(String(topic.id))}&page=${page}`,
      );

      const baseTopic = mapTopic(topic, site, base);
      const posts: Post[] = [
        {
          id: String(topic.id),
          topic_id: String(topic.id),
          floor: 1,
          author: authorFrom(topic.member),
          content_text: bodyText(topic),
          content_html: topic.content_rendered,
          created_at: toRfc3339(topic.created) ?? EPOCH,
        },
      ];

      replies.forEach((reply, index) => {
        posts.push({
          id: String(reply.id),
          topic_id: String(topic.id),
          floor: index + 2,
          author: authorFrom(reply.member),
          content_text: htmlToText(reply.content_rendered ?? reply.content),
          content_html: reply.content_rendered,
          created_at: toRfc3339(reply.created) ?? EPOCH,
          like_count: reply.thanks,
        });
      });

      const postCount = (topic.replies ?? replies.length) + 1;
      const pages = Math.max(1, Math.ceil(postCount / REPLIES_PER_PAGE));

      return {
        ...baseTopic,
        excerpt: excerptOf(topic.content_rendered ?? topic.content),
        posts,
        post_count: postCount,
        page,
        pages,
      };
    },

    async search(): Promise<Topic[]> {
      unsupported(engine, "search");
    },

    async categories(site: Site): Promise<Category[]> {
      const base = baseUrl(site);
      const nodes = await http.getJson<V2exNode[]>(`${base}/api/nodes/all.json`);
      return nodes.map((node) => ({
        id: String(node.id),
        name: node.name,
        slug: node.name,
        description: node.title ?? node.header,
        topic_count: node.topics,
      }));
    },
  };
}

const adapter = createV2exAdapter();
export default adapter;
