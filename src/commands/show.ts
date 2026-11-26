/**
 * `fora show <topic-url | site:topic-id | last-list-number>`
 *
 * The most common agent workflow: paste a URL, or pick a number from the
 * last list. A URL from an unconfigured host is resolved ephemerally when its
 * engine can be recognised — no config is written.
 */

import { defineCommand } from "citty";
import type { Adapter } from "../core/adapter.ts";
import { envelope } from "../core/envelope.ts";
import { formatCliError } from "../core/error-format.ts";
import { UsageError } from "../core/errors.ts";
import type { TopicDetail } from "../core/model.ts";
import { requireSite, type Site } from "../core/sites.ts";
import { renderTopicDetail } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext } from "./context.ts";
import { assertCapability, intOption, jsonArg } from "./common.ts";

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

export const showCommand = defineCommand({
  meta: {
    name: "show",
    description: "Open a topic by URL, site:id, or a number from the last list",
  },
  args: {
    topic: {
      type: "positional",
      required: true,
      description: "Topic URL, site:topic-id, or last-list number",
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
    json: jsonArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const target = await resolveShowTarget(ctx, String(args.topic));
    const adapter: Adapter = ctx.registry.require(target.site.engine);
    assertCapability(adapter, "topic", "show");

    const page = intOption(args.page, 1, "page");
    let detail = await adapter.topic(target.site, target.id, page);

    const allPages = Boolean(args["all-pages"]) || Boolean((args as Record<string, unknown>).allPages);
    if (allPages && detail.pages > 1 && adapter.engine !== "hn" && adapter.engine !== "rss") {
      const pageCount = Math.min(detail.pages, MAX_ALL_PAGES);
      const fetched: TopicDetail[] = [];
      for (let number = 1; number <= pageCount; number += 1) {
        fetched.push(number === page ? detail : await adapter.topic(target.site, target.id, number));
      }
      detail = mergePages(fetched);
    }

    if (args.json) {
      writeJson(envelope(detail, { site: target.site.name, topic_id: detail.id }));
      return;
    }
    process.stdout.write(`${renderTopicDetail(detail)}\n`);
  },
});
