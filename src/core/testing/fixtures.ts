/**
 * Test-only fixtures: real HTTP clients backed by recorded JSON/XML files.
 * No network is ever touched. Used by the adapter contract test and the
 * per-adapter tests.
 */

import { HttpClient } from "../http.ts";
import type { Adapter } from "../adapter.ts";
import type { Site } from "../sites.ts";
import { createDiscourseAdapter } from "../../adapters/discourse/index.ts";
import { createV2exAdapter } from "../../adapters/v2ex/index.ts";
import { createHnAdapter } from "../../adapters/hn/index.ts";
import { createFlarumAdapter } from "../../adapters/flarum/index.ts";
import { createNodebbAdapter } from "../../adapters/nodebb/index.ts";
import { createRssAdapter } from "../../adapters/rss/index.ts";
import { createDiscourseRssAdapter } from "../../adapters/discourse-rss/index.ts";
import { createRubyChinaAdapter } from "../../adapters/ruby-china/index.ts";

export interface FixtureRoute {
  test: (url: string) => boolean;
  body: () => string | Promise<string>;
  contentType?: string;
  status?: number;
}

function fixtureFile(relative: string): () => Promise<string> {
  return () => Bun.file(new URL(relative, import.meta.url)).text();
}

/** Build a fetch implementation that serves recorded fixtures. */
export function fetchFromRoutes(routes: FixtureRoute[]): typeof fetch {
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const route of routes) {
      if (!route.test(url)) continue;
      return new Response(await route.body(), {
        status: route.status ?? 200,
        headers: { "content-type": route.contentType ?? "application/json" },
      });
    }
    return new Response('{"error":"no fixture"}', { status: 404 });
  };
  return impl as unknown as typeof fetch;
}

export function fixtureHttp(routes: FixtureRoute[]): HttpClient {
  return new HttpClient({ fetchImpl: fetchFromRoutes(routes), minIntervalMs: 0, maxRetries: 0 });
}

const D = "../../adapters";

export function discourseFixtureHttp(): HttpClient {
  return fixtureHttp([
    { test: (url) => url.includes("/site.json"), body: fixtureFile(`${D}/discourse/fixtures/site.json`) },
    { test: (url) => url.includes("/top.json"), body: fixtureFile(`${D}/discourse/fixtures/top.json`) },
    { test: (url) => url.includes("/latest.json"), body: fixtureFile(`${D}/discourse/fixtures/latest.json`) },
    { test: (url) => url.includes("/search.json"), body: fixtureFile(`${D}/discourse/fixtures/search.json`) },
    { test: (url) => url.includes("/categories.json"), body: fixtureFile(`${D}/discourse/fixtures/categories.json`) },
    { test: (url) => /\/t\/\d+\.json/.test(url), body: fixtureFile(`${D}/discourse/fixtures/topic.json`) },
  ]);
}

export function discourseRssFixtureHttp(): HttpClient {
  const challenge = '<html><head><title>Just a moment...</title></head><body>cf-challenge</body></html>';
  const top = fixtureFile(`${D}/discourse-rss/fixtures/top.xml`);
  return fixtureHttp([
    { test: (url) => url.includes("/site.json"), body: fixtureFile(`${D}/discourse/fixtures/site.json`) },
    {
      test: (url) => url.includes("/latest.json"),
      body: () => challenge,
      contentType: "text/html",
      status: 403,
    },
    { test: (url) => url.includes("/latest.rss"), body: fixtureFile(`${D}/discourse-rss/fixtures/latest.xml`), contentType: "application/rss+xml" },
    { test: (url) => url.includes("/hot.rss"), body: top, contentType: "application/rss+xml" },
    { test: (url) => url.includes("/top.rss"), body: top, contentType: "application/rss+xml" },
  ]);
}

export function v2exFixtureHttp(): HttpClient {
  return fixtureHttp([
    { test: (url) => url.includes("/api/topics/hot.json"), body: fixtureFile(`${D}/v2ex/fixtures/hot.json`) },
    { test: (url) => url.includes("/api/topics/latest.json"), body: fixtureFile(`${D}/v2ex/fixtures/latest.json`) },
    { test: (url) => url.includes("/api/topics/show.json"), body: fixtureFile(`${D}/v2ex/fixtures/topic.json`) },
    { test: (url) => url.includes("/api/replies/show.json"), body: fixtureFile(`${D}/v2ex/fixtures/replies.json`) },
    { test: (url) => url.includes("/api/nodes/all.json"), body: fixtureFile(`${D}/v2ex/fixtures/nodes.json`) },
  ]);
}

export function hnFixtureHttp(): HttpClient {
  const items = new Map<number, unknown>();
  let loading: Promise<void> | undefined;

  const loadItems = async (): Promise<void> => {
    if (!loading) {
      loading = (async () => {
        const list = (await Bun.file(new URL(`${D}/hn/fixtures/items.json`, import.meta.url)).json()) as Array<{
          id: number;
        }>;
        for (const item of list) items.set(item.id, item);
      })();
    }
    await loading;
  };

  const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("topstories.json")) {
      return new Response(await fixtureFile(`${D}/hn/fixtures/topstories.json`)(), { status: 200 });
    }
    if (url.includes("newstories.json")) {
      return new Response(await fixtureFile(`${D}/hn/fixtures/newstories.json`)(), { status: 200 });
    }
    if (url.includes("hn.algolia.com")) {
      return new Response(await fixtureFile(`${D}/hn/fixtures/search.json`)(), { status: 200 });
    }
    const match = /\/item\/(\d+)\.json/.exec(url);
    if (match) {
      await loadItems();
      return new Response(JSON.stringify(items.get(Number(match[1])) ?? null), { status: 200 });
    }
    return new Response('{"error":"no fixture"}', { status: 404 });
  }) as unknown as typeof fetch;

  return new HttpClient({ fetchImpl, minIntervalMs: 0, maxRetries: 0 });
}

export function flarumFixtureHttp(): HttpClient {
  return fixtureHttp([
    {
      test: (url) => /\/api$/.test(url),
      body: () => '{"jsonapi":{"version":"1.0"},"links":{}}',
    },
    { test: (url) => url.includes("sort=-lastPostedAt"), body: fixtureFile(`${D}/flarum/fixtures/latest.json`) },
    { test: (url) => url.includes("sort=-commentCount"), body: fixtureFile(`${D}/flarum/fixtures/hot.json`) },
    { test: (url) => url.includes("filter%5Bq%5D") || url.includes("filter[q]"), body: fixtureFile(`${D}/flarum/fixtures/search.json`) },
    { test: (url) => url.includes("/api/posts"), body: fixtureFile(`${D}/flarum/fixtures/posts.json`) },
    { test: (url) => /\/api\/discussions\/\d+/.test(url), body: fixtureFile(`${D}/flarum/fixtures/topic.json`) },
    { test: (url) => url.includes("/api/tags"), body: fixtureFile(`${D}/flarum/fixtures/tags.json`) },
  ]);
}

export function nodebbFixtureHttp(): HttpClient {
  return fixtureHttp([
    {
      test: (url) => url.includes("/api/config"),
      body: () => '{"version":"3.0.0","relative_path":"","siteTitle":"Fixture"}',
    },
    { test: (url) => url.includes("/api/recent"), body: fixtureFile(`${D}/nodebb/fixtures/recent.json`) },
    { test: (url) => url.includes("/api/popular"), body: fixtureFile(`${D}/nodebb/fixtures/popular.json`) },
    { test: (url) => url.includes("/api/topic/"), body: fixtureFile(`${D}/nodebb/fixtures/topic.json`) },
    { test: (url) => url.includes("/api/search"), body: fixtureFile(`${D}/nodebb/fixtures/search.json`) },
    { test: (url) => url.includes("/api/categories"), body: fixtureFile(`${D}/nodebb/fixtures/categories.json`) },
  ]);
}

export function rubyChinaFixtureHttp(): HttpClient {
  return fixtureHttp([
    { test: (url) => /\/api\/v3\/topics\/\d+\/replies\.json/.test(url), body: fixtureFile(`${D}/ruby-china/fixtures/replies.json`) },
    { test: (url) => /\/api\/v3\/topics\/\d+\.json/.test(url), body: fixtureFile(`${D}/ruby-china/fixtures/topic.json`) },
    { test: (url) => url.includes("/api/v3/topics.json"), body: fixtureFile(`${D}/ruby-china/fixtures/topics.json`) },
    { test: (url) => url.includes("/api/v3/nodes.json"), body: fixtureFile(`${D}/ruby-china/fixtures/nodes.json`) },
  ]);
}

export function rssFixtureHttp(kind: "rss" | "atom" = "rss"): HttpClient {
  const file = kind === "rss" ? `${D}/rss/fixtures/rss.xml` : `${D}/rss/fixtures/atom.xml`;
  return fixtureHttp([
    { test: () => true, body: fixtureFile(file), contentType: "application/xml" },
  ]);
}

export interface FixtureCase {
  label: string;
  adapter: Adapter;
  site: Site;
  topicFixtureList?: "latest";
}

export function buildFixtureAdapters(): FixtureCase[] {
  return [
    {
      label: "discourse",
      adapter: createDiscourseAdapter(discourseFixtureHttp()),
      site: { name: "discourse-meta", engine: "discourse", base_url: "https://meta.discourse.org", source: "directory" },
    },
    {
      label: "v2ex",
      adapter: createV2exAdapter(v2exFixtureHttp()),
      site: { name: "v2ex", engine: "v2ex", base_url: "https://www.v2ex.com", source: "preset" },
    },
    {
      label: "hn",
      adapter: createHnAdapter(hnFixtureHttp()),
      site: { name: "hn", engine: "hn", base_url: "https://news.ycombinator.com", source: "preset" },
    },
    {
      label: "flarum",
      adapter: createFlarumAdapter(flarumFixtureHttp()),
      site: { name: "flarum-community", engine: "flarum", base_url: "https://discuss.flarum.org", source: "directory" },
      topicFixtureList: "latest",
    },
    {
      label: "nodebb",
      adapter: createNodebbAdapter(nodebbFixtureHttp()),
      site: { name: "vivaldi-forum", engine: "nodebb", base_url: "https://forum.vivaldi.net", source: "directory" },
      topicFixtureList: "latest",
    },
    {
      label: "discourse-rss",
      adapter: createDiscourseRssAdapter(discourseRssFixtureHttp()),
      site: { name: "linuxdo", engine: "discourse-rss", base_url: "https://linux.do", source: "preset" },
    },
    {
      label: "ruby-china",
      adapter: createRubyChinaAdapter(rubyChinaFixtureHttp()),
      site: { name: "ruby-china", engine: "ruby-china", base_url: "https://ruby-china.org", source: "directory" },
    },
    {
      label: "rss",
      adapter: createRssAdapter(rssFixtureHttp("rss")),
      site: { name: "rust-blog", engine: "rss", base_url: "https://fixture.test/rss.xml", source: "directory" },
    },
  ];
}
