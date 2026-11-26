import { describe, expect, it } from "bun:test";
import { createRssAdapter } from "./index.ts";
import { rssFixtureHttp } from "../../core/testing/fixtures.ts";
import { UnsupportedError } from "../../core/errors.ts";
import type { Site } from "../../core/sites.ts";

const rssSite: Site = { name: "github-blog", engine: "rss", base_url: "https://fixture.test/rss.xml", source: "directory" };
const atomSite: Site = { name: "rust-blog", engine: "rss", base_url: "https://fixture.test/atom.xml", source: "directory" };

describe("RSS adapter", () => {
  it("maps an RSS 2.0 feed (with content:encoded) to topics", async () => {
    const adapter = createRssAdapter(rssFixtureHttp("rss"));
    const topics = await adapter.latest(rssSite, { limit: 10 });
    expect(topics).toHaveLength(3);
    expect(topics[0]!.title).toBe("Art of play in the age of AI");
    expect(topics[0]!.author?.username).toBe("Polly Davidson");
    expect(topics[0]!.url).toBe("https://github.blog/news-insights/company-news/art-of-play-in-the-age-of-ai/");
    expect(topics[0]!.excerpt?.length).toBeGreaterThan(0);
  });

  it("maps an Atom feed with HTML content", async () => {
    const adapter = createRssAdapter(rssFixtureHttp("atom"));
    const topics = await adapter.latest(atomSite, { limit: 10 });
    expect(topics).toHaveLength(3);
    expect(topics[0]!.title).toBe("Enabling the parallel frontend on nightly");
    expect(topics[0]!.author?.username).toBe("Jakub Beránek");
  });

  it("returns the full content item as a single post via topic()", async () => {
    const adapter = createRssAdapter(rssFixtureHttp("rss"));
    const topics = await adapter.latest(rssSite, { limit: 1 });
    const detail = await adapter.topic(rssSite, topics[0]!.id, 1);
    expect(detail.posts).toHaveLength(1);
    expect(detail.posts[0]!.floor).toBe(1);
    expect(detail.posts[0]!.content_text).toContain("Now that code ships faster");
  });

  it("reports hot/search/categories as unsupported", async () => {
    const adapter = createRssAdapter(rssFixtureHttp("rss"));
    await expect(adapter.hot(rssSite, { limit: 1 })).rejects.toBeInstanceOf(UnsupportedError);
    await expect(adapter.search(rssSite, "x", { limit: 1 })).rejects.toBeInstanceOf(UnsupportedError);
    await expect(adapter.categories(rssSite)).rejects.toBeInstanceOf(UnsupportedError);
  });
});
