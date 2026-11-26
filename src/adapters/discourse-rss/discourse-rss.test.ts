import { describe, expect, it } from "bun:test";
import { createDiscourseRssAdapter } from "./index.ts";
import {
  discourseFixtureHttp,
  discourseRssFixtureHttp,
  fixtureHttp,
} from "../../core/testing/fixtures.ts";
import { RateLimitError, UnsupportedError } from "../../core/errors.ts";
import type { Site } from "../../core/sites.ts";

const site: Site = {
  name: "linuxdo",
  engine: "discourse-rss",
  base_url: "https://linux.do",
  source: "preset",
};

describe("discourse-rss adapter", () => {
  it("maps the ranked feed to topics with feed metadata", async () => {
    const adapter = createDiscourseRssAdapter(discourseRssFixtureHttp());
    const topics = await adapter.hot(site, { limit: 3, period: "week" });
    expect(topics).toHaveLength(3);
    expect(topics[0]!.title).toBe("Wayland 迁移踩坑记录");
    expect(topics[0]!.author?.username).toBe("alice");
    expect(topics[0]!.category?.name).toBe("开发调优");
    expect(topics[0]!.url).toBe("https://linux.do/t/wayland/12345");
    expect(topics[0]!.excerpt?.length).toBeGreaterThan(0);
  });

  it("maps period windows to Discourse RSS periods", async () => {
    const urls: string[] = [];
    const http = fixtureHttp([
      {
        test: (url) => {
          urls.push(url);
          return true;
        },
        body: () => Bun.file(new URL("./fixtures/top.xml", import.meta.url)).text(),
        contentType: "application/rss+xml",
      },
    ]);
    const adapter = createDiscourseRssAdapter(http);

    await adapter.hot(site, { limit: 1, period: "day" });
    await adapter.hot(site, { limit: 1, period: "month" });
    await adapter.hot(site, { limit: 1, period: "all" });

    expect(urls[0]).toContain("/top.rss?period=daily");
    expect(urls[1]).toContain("/top.rss?period=monthly");
    expect(urls[2]).toContain("/top.rss");
    expect(urls[2]).not.toContain("period=");
  });

  it("uses the latest feed for latest()", async () => {
    const adapter = createDiscourseRssAdapter(discourseRssFixtureHttp());
    const topics = await adapter.latest(site, { limit: 2 });
    expect(topics[0]!.title).toBe("Fedora 43 正式版发布");
    expect(topics).toHaveLength(2);
  });

  it("returns a single full-content post for a topic from the ranked feed", async () => {
    const adapter = createDiscourseRssAdapter(discourseRssFixtureHttp());
    const topics = await adapter.hot(site, { limit: 1, period: "week" });
    const detail = await adapter.topic(site, topics[0]!.id, 1);
    expect(detail.posts).toHaveLength(1);
    expect(detail.posts[0]!.content_text).toContain("完整的排查过程");
    expect(detail.page).toBe(1);
    expect(detail.pages).toBe(1);
  });

  it("falls back to /hot.rss when the ranked feed is challenged", async () => {
    const challenge = '<html><head><title>Just a moment...</title></head><body>cf-challenge</body></html>';
    const http = fixtureHttp([
      {
        test: (url) => url.includes("/top.rss"),
        body: () => challenge,
        contentType: "text/html",
        status: 403,
      },
      {
        test: (url) => url.includes("/hot.rss"),
        body: () => Bun.file(new URL("./fixtures/top.xml", import.meta.url)).text(),
        contentType: "application/rss+xml",
      },
    ]);
    const adapter = createDiscourseRssAdapter(http);
    const topics = await adapter.hot(site, { limit: 2, period: "day" });
    expect(topics[0]!.title).toBe("Wayland 迁移踩坑记录");
  });

  it("reports a challenged latest feed with an actionable message", async () => {
    const challenge = '<html><head><title>Just a moment...</title></head><body>cf-challenge</body></html>';
    const http = fixtureHttp([
      {
        test: () => true,
        body: () => challenge,
        contentType: "text/html",
        status: 403,
      },
    ]);
    const adapter = createDiscourseRssAdapter(http);
    await expect(adapter.latest(site, { limit: 1 })).rejects.toBeInstanceOf(RateLimitError);
    let message = "";
    try {
      await adapter.latest(site, { limit: 1 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("linuxdo is rate limiting or challenging its RSS feeds");
    expect(message).toContain("fora doctor");
  });

  it("detects Discourse instances whose JSON endpoints are challenged", async () => {
    const challenged = createDiscourseRssAdapter(discourseRssFixtureHttp());
    expect(await challenged.detect({ url: "https://linux.do" })).toBe(true);

    const plain = createDiscourseRssAdapter(discourseFixtureHttp());
    expect(await plain.detect({ url: "https://meta.discourse.org" })).toBe(false);
  });

  it("leaves search and categories unsupported", async () => {
    const adapter = createDiscourseRssAdapter(discourseRssFixtureHttp());
    await expect(adapter.search(site, "x", { limit: 1 })).rejects.toBeInstanceOf(UnsupportedError);
    await expect(adapter.categories(site)).rejects.toBeInstanceOf(UnsupportedError);
  });
});
