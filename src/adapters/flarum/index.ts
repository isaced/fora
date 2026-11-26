/**
 * Flarum adapter — the modern JSON:API standard, with `included` relationship
 * resolution (SPEC §7.4). Hot is approximated by comment count.
 */

import { unsupported, type Adapter, type HotOpts, type ListOpts, type SiteCandidate } from "../../core/adapter.ts";
import { UsageError } from "../../core/errors.ts";
import { excerptOf, htmlToText } from "../../core/html.ts";
import { HttpClient } from "../../core/http.ts";
import type { Author, Category, Post, Topic, TopicDetail } from "../../core/model.ts";
import type { Site } from "../../core/sites.ts";
import { toRfc3339 } from "../../core/time.ts";

const EPOCH = "1970-01-01T00:00:00.000Z";
const POSTS_PER_PAGE = 20;

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown }>;
}

interface JsonApiDocument {
  data?: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
}

function baseUrl(site: Site): string {
  if (!site.base_url) throw new UsageError(`site "${site.name}" has no base_url`);
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

function indexIncluded(doc: JsonApiDocument): Map<string, JsonApiResource> {
  const map = new Map<string, JsonApiResource>();
  for (const resource of doc.included ?? []) map.set(`${resource.type}:${resource.id}`, resource);
  return map;
}

function refOf(resource: JsonApiResource, relation: string): JsonApiResource | undefined {
  const rel = resource.relationships?.[relation]?.data as { type?: string; id?: string } | undefined;
  if (!rel?.type || !rel?.id) return undefined;
  return { type: rel.type, id: rel.id };
}

function resolve(
  included: Map<string, JsonApiResource>,
  resource: JsonApiResource,
  relation: string,
): JsonApiResource | undefined {
  const ref = refOf(resource, relation);
  if (!ref) return undefined;
  return included.get(`${ref.type}:${ref.id}`);
}

function authorOf(user: JsonApiResource | undefined): Author | undefined {
  if (!user?.attributes) return undefined;
  const attributes = user.attributes;
  return {
    username: String(attributes.username ?? ""),
    display_name: typeof attributes.displayName === "string" ? attributes.displayName : undefined,
    avatar_url: typeof attributes.avatarUrl === "string" ? attributes.avatarUrl : undefined,
  };
}

function topicsFromDocument(doc: JsonApiDocument, site: Site, base: string, limit: number): Topic[] {
  const included = indexIncluded(doc);
  const data = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];

  return data
    .filter((resource) => resource.type === "discussions")
    .slice(0, limit)
    .map((resource) => {
      const attributes = resource.attributes ?? {};
      const author = authorOf(resolve(included, resource, "user"));
      const firstPost = resolve(included, resource, "firstPost");
      const created = toRfc3339(attributes.createdAt as string) ?? EPOCH;
      const lastActivity = toRfc3339(attributes.lastPostedAt as string) ?? created;
      const slug = typeof attributes.slug === "string" ? attributes.slug : undefined;
      const commentCount = typeof attributes.commentCount === "number" ? attributes.commentCount : undefined;

      const tagsRel = resource.relationships?.tags?.data;
      const tags = Array.isArray(tagsRel) ? tagsRel.map((tag) => String((tag as { id?: string }).id ?? "")) : undefined;

      return {
        id: resource.id,
        site: site.name,
        title: String(attributes.title ?? ""),
        url: slug ? `${base}/d/${slug}` : `${base}/d/${resource.id}`,
        author,
        tags: tags && tags.length > 0 ? tags : undefined,
        reply_count: commentCount,
        created_at: created,
        last_activity_at: lastActivity,
        excerpt: firstPost?.attributes
          ? excerptOf(String(firstPost.attributes.contentHtml ?? ""))
          : undefined,
        pinned: Boolean(attributes.isSticky),
      };
    });
}

function postFromResource(resource: JsonApiResource, included: Map<string, JsonApiResource>): Post {
  const attributes = resource.attributes ?? {};
  return {
    id: resource.id,
    topic_id: String(attributes.discussionId ?? ""),
    floor: typeof attributes.number === "number" ? attributes.number : 0,
    author: authorOf(resolve(included, resource, "user")),
    content_text: htmlToText(String(attributes.contentHtml ?? "")),
    content_html: typeof attributes.contentHtml === "string" ? attributes.contentHtml : undefined,
    created_at: toRfc3339(attributes.createdAt as string) ?? EPOCH,
  };
}

export function createFlarumAdapter(http: HttpClient = new HttpClient()): Adapter {
  const engine = "flarum";

  const listUrl = (base: string, sort: string, extra = "") =>
    `${base}/api/discussions?sort=${sort}&include=user,firstPost&page%5Blimit%5D=${extra}`;

  return {
    engine,
    capabilities: { hot: true, latest: true, hotPeriods: false, topic: true, search: true, categories: true },

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const origin = originOf(candidate);
      if (!origin) return false;
      try {
        const doc = await http.getJson<Record<string, unknown>>(`${origin}/api`);
        return Boolean(doc && (doc.jsonapi || doc.links || doc.data !== undefined));
      } catch {
        return false;
      }
    },

    async hot(site: Site, opts: HotOpts): Promise<Topic[]> {
      if (opts.period) unsupported(engine, "hot --period");
      const base = baseUrl(site);
      const doc = await http.getJson<JsonApiDocument>(listUrl(base, "-commentCount", String(opts.limit)));
      return topicsFromDocument(doc, site, base, opts.limit);
    },

    async latest(site: Site, opts: ListOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const doc = await http.getJson<JsonApiDocument>(listUrl(base, "-lastPostedAt", String(opts.limit)));
      return topicsFromDocument(doc, site, base, opts.limit);
    },

    async topic(site: Site, ref: string, page: number): Promise<TopicDetail> {
      const base = baseUrl(site);
      const discussion = await http.getJson<JsonApiDocument>(
        `${base}/api/discussions/${encodeURIComponent(ref)}?include=user,firstPost`,
      );
      const resource = Array.isArray(discussion.data) ? discussion.data[0] : discussion.data;
      if (!resource) throw new UsageError(`Flarum discussion ${ref} was not found`);

      const offset = Math.max(0, page - 1) * POSTS_PER_PAGE;
      const postsDoc = await http.getJson<JsonApiDocument>(
        `${base}/api/posts?filter%5Bdiscussion%5D=${encodeURIComponent(ref)}&include=user&page%5Blimit%5D=${POSTS_PER_PAGE}&page%5Boffset%5D=${offset}`,
      );
      const included = indexIncluded(postsDoc);
      const postResources = (Array.isArray(postsDoc.data) ? postsDoc.data : []).filter(
        (item) => item.type === "posts",
      );
      const posts = postResources.map((post) => postFromResource(post, included));

      const attributes = resource.attributes ?? {};
      const detail = topicsFromDocument({ data: [resource], included: discussion.included }, site, base, 1)[0]!;
      const commentCount = typeof attributes.commentCount === "number" ? attributes.commentCount : 0;
      const postCount = commentCount + 1;
      const pages = Math.max(1, Math.ceil(postCount / POSTS_PER_PAGE));

      return {
        ...detail,
        posts,
        post_count: postCount,
        page,
        pages,
      };
    },

    async search(site: Site, query: string, opts: ListOpts): Promise<Topic[]> {
      const base = baseUrl(site);
      const doc = await http.getJson<JsonApiDocument>(
        `${base}/api/discussions?filter%5Bq%5D=${encodeURIComponent(query)}&include=user,firstPost&page%5Blimit%5D=${opts.limit}`,
      );
      return topicsFromDocument(doc, site, base, opts.limit);
    },

    async categories(site: Site): Promise<Category[]> {
      const base = baseUrl(site);
      const doc = await http.getJson<JsonApiDocument>(`${base}/api/tags`);
      const tags = Array.isArray(doc.data) ? doc.data : [];
      return tags.map((tag) => {
        const attributes = tag.attributes ?? {};
        return {
          id: tag.id,
          name: String(attributes.name ?? ""),
          slug: typeof attributes.slug === "string" ? attributes.slug : undefined,
          description: typeof attributes.description === "string" ? attributes.description : undefined,
          topic_count: typeof attributes.discussionCount === "number" ? attributes.discussionCount : undefined,
        };
      });
    },
  };
}

const adapter = createFlarumAdapter();
export default adapter;
