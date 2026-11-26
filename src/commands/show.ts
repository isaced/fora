/**
 * `fora show <topic-url | site:topic-id | last-list-number>`
 *
 * The most common agent workflow: paste a URL, or pick a number from the
 * last list. A URL from an unconfigured host is resolved ephemerally when its
 * engine can be recognised — no config is written.
 */

import { defineCommand } from "citty";
import type { Adapter } from "../core/adapter.ts";
import { mapLimit } from "../core/async.ts";
import { degradationMeta, degradedSites } from "../core/degradation.ts";
import { envelope } from "../core/envelope.ts";
import { errorMessage, formatCliError } from "../core/error-format.ts";
import { UsageError } from "../core/errors.ts";
import { excerptOf } from "../core/html.ts";
import type { TopicDetail } from "../core/model.ts";
import { requireSite, type Site } from "../core/sites.ts";
import { renderTopicDetail } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext } from "./context.ts";
import { assertCapability, humanArg, intOption, jsonArg } from "./common.ts";

const DETECT_ORDER = ["hn", "v2ex", "discourse-rss", "discourse", "flarum", "nodebb"];
const MAX_ALL_PAGES = 50;

function parseTopicRef(engine: string, rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }

  switch (engine) {
    case "hn":
      return url.searchParams.get("id") ?? undefined;
    case "v2ex":
      return url.pathname.match(/\/t\/(\d+)/)?.[1];
    case "discourse":
      return url.pathname.match(/\/t\/(?:[^/]+\/)?(\d+)/)?.[1];
    case "flarum":
      return url.pathname.match(/\/d\/(\d+)/)?.[1];
    case "nodebb":
      return url.pathname.match(/\/topic\/(.+?)\/?$/)?.[1];
    case "rss":
      return rawUrl;
    default:
      return url.pathname.match(/(\d+)\/?$/)?.[1];
  }
}

function findSiteForHost(sites: Site[], host: string): Site | undefined {
  return sites.find((site) => {
    if (!site.base_url) return false;
    try {
      return new URL(site.base_url).host === host;
    } catch {
      return false;
    }
  });
}

interface ShowTarget {
  site: Site;
  id: string;
}

async function resolveShowTarget(
  ctx: Awaited<ReturnType<typeof createContext>>,
  ref: string,
): Promise<ShowTarget> {
  if (/^\d+$/.test(ref)) {
    const topic = await ctx.cache.resolve(Number(ref));
    const site = requireSite(ctx.sites, topic.site);
    return { site, id: topic.id };
  }

  if (/^https?:\/\//i.test(ref)) {
    const url = new URL(ref);
    let site = findSiteForHost(ctx.sites, url.host);

    if (!site) {
      let engine: string | undefined;
      for (const candidate of DETECT_ORDER) {
        const adapter = ctx.registry.get(candidate);
        if (!adapter) continue;
        try {
          if (await adapter.detect({ url: ref })) {
            engine = candidate;
            break;
          }
        } catch {
          // try the next engine
        }
      }
      if (!engine) {
        throw new UsageError(
          formatCliError(`could not recognise the engine for ${url.host}`, [
            { heading: "Add this site first:", lines: [`fora sites add ${url.origin}`] },
            { heading: "Or list supported engines:", lines: ["fora engines list"] },
          ]),
        );
      }
      site = {
        name: url.host.replace(/^www\./, "").replace(/\./g, "-"),
        engine,
        base_url: url.origin,
        source: "config",
      };
    }

    const id = parseTopicRef(site.engine, ref);
    if (!id) {
      throw new UsageError(
        formatCliError(`could not parse a topic id from ${ref}`, [
          {
            heading: "Use one of these forms:",
            lines: ["fora show https://site.example/t/1234", "fora show site:1234", "fora show 3"],
          },
        ]),
      );
    }
    return { site, id };
  }

  const match = ref.match(/^([a-zA-Z0-9][a-zA-Z0-9_-]*):(.+)$/);
  if (match) {
    const site = requireSite(ctx.sites, match[1]!);
    return { site, id: match[2]! };
  }

  throw new UsageError(
    formatCliError("show expects a topic reference", [
      {
        heading: "Accepted forms:",
        lines: [
          "fora show https://linux.do/t/12345",
          "fora show linuxdo:12345",
          "fora show 3   # item 3 of the last list",
        ],
      },
    ]),
  );
}

function mergePages(pages: TopicDetail[]): TopicDetail {
  const base = pages[0]!;
  const seen = new Set<string>();
  const posts = pages
    .flatMap((detail) => detail.posts)
    .filter((post) => {
      const key = `${post.id}:${post.floor}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.floor - b.floor);
  return { ...base, posts, page: 1, pages: base.pages, truncated: undefined, omitted_replies: undefined };
}

const SHOW_CONCURRENCY = 5;

function repliesOption(raw: unknown, excerptOnly: boolean): number | undefined {
  if (raw === undefined || raw === null || raw === "") return excerptOnly ? 3 : undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError("--replies must be a non-negative integer");
  }
  return value;
}

/** Keep the OP plus top replies, optionally replacing bodies with excerpts. */
export function shapeTopicDetail(detail: TopicDetail, replies?: number, excerptOnly = false): TopicDetail {
  const posts = detail.posts ?? [];
  const op = posts.find((post) => post.floor === 1);
  const allReplies = posts.filter((post) => post.floor > 1);
  const selected =
    replies === undefined
      ? allReplies
      : [...allReplies].sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0)).slice(0, replies);
  const omitted = Math.max(0, allReplies.length - selected.length);
  const nextPosts = [...(op ? [op] : []), ...selected].sort((a, b) => a.floor - b.floor);

  return {
    ...detail,
    excerpt: excerptOnly ? excerptOf(op?.content_html ?? op?.content_text ?? detail.excerpt ?? "") || detail.excerpt : detail.excerpt,
    posts: excerptOnly
      ? nextPosts.map((post) => ({
          ...post,
          content_text: excerptOf(post.content_html ?? post.content_text),
          content_html: undefined,
        }))
      : nextPosts,
    truncated: omitted > 0 ? true : detail.truncated,
    omitted_replies: omitted || detail.omitted_replies,
  };
}

interface ShowResult {
  ref: string;
  site?: string;
  topic_id?: string;
  detail?: TopicDetail;
  error?: string;
}

export const showCommand = defineCommand({
  meta: {
    name: "show",
    description: "Open one or more topics by URL, site:id, or last-list number",
  },
  args: {
    topic: {
      type: "positional",
      required: true,
      description: "One or more topic URLs, site:topic-id values, or last-list numbers",
    },
    page: {
      type: "string",
      description: "Page number of posts to fetch (default 1)",
      valueHint: "n",
    },
    "all-pages": {
      type: "boolean",
      description: "Fetch every page of posts",
      default: false,
    },
    replies: {
      type: "string",
      description: "Keep only the top N replies by likes",
      valueHint: "n",
    },
    excerpt: {
      type: "boolean",
      description: "Return OP/reply excerpts instead of full bodies (implies --replies 3)",
      default: false,
    },
    json: jsonArg,
    human: humanArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const refs = ((args._ as string[] | undefined) ?? []).filter(
      (ref) => typeof ref === "string" && ref.trim().length > 0,
    );
    const uniqueRefs = [...new Set(refs.length > 0 ? refs : [String(args.topic)])];
    const page = intOption(args.page, 1, "page");
    const excerptOnly = Boolean(args.excerpt);
    const replies = repliesOption(args.replies, excerptOnly);
    const allPages = Boolean(args["all-pages"]) || Boolean((args as Record<string, unknown>).allPages);
    let firstError: unknown;

    const results = await mapLimit(uniqueRefs, SHOW_CONCURRENCY, async (ref): Promise<ShowResult> => {
      try {
        const target = await resolveShowTarget(ctx, ref);
        const adapter: Adapter = ctx.registry.require(target.site.engine);
        assertCapability(adapter, "topic", "show");

        let detail = await adapter.topic(target.site, target.id, page);
        if (allPages && detail.pages > 1 && adapter.engine !== "hn" && adapter.engine !== "rss") {
          const pageCount = Math.min(detail.pages, MAX_ALL_PAGES);
          const fetched: TopicDetail[] = [];
          for (let number = 1; number <= pageCount; number += 1) {
            fetched.push(number === page ? detail : await adapter.topic(target.site, target.id, number));
          }
          detail = mergePages(fetched);
        }
        return {
          ref,
          site: target.site.name,
          topic_id: detail.id,
          detail: shapeTopicDetail(detail, replies, excerptOnly),
        };
      } catch (error) {
        firstError ??= error;
        return { ref, error: errorMessage(error) };
      }
    });

    const failed = results.filter((result) => result.error);
    if (failed.length === results.length) throw firstError ?? new Error("all show targets failed");
    for (const failure of failed) process.stderr.write(`fora: ${failure.ref}: ${failure.error}\n`);

    const sites = results.map((result) => result.site).filter((site): site is string => Boolean(site));
    const degraded = degradationMeta(degradedSites(ctx.degradation, sites));

    if (args.json) {
      if (uniqueRefs.length === 1) {
        const only = results[0]!;
        writeJson(envelope(only.detail, {
          site: only.site,
          topic_id: only.topic_id,
          ref: only.ref,
          ...degraded,
          ...(failed.length > 0 ? { errors: failed.map(({ ref, error }) => ({ ref, error })) } : {}),
        }));
        return;
      }
      writeJson(
        envelope(
          results.map(({ ref, site, topic_id, detail, error }) => ({ ref, site, topic_id, topic: detail, error })),
          { count: results.length - failed.length, failures: failed.length, ...degraded },
        ),
      );
      return;
    }

    for (const result of results) {
      if (!result.detail) continue;
      if (results.length > 1) process.stdout.write(`[${result.ref}]\n`);
      process.stdout.write(`${renderTopicDetail(result.detail)}\n`);
    }
  },
});
