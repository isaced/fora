import { describe, expect, it } from "bun:test";
import { hnFixtureHttp } from "../../core/testing/fixtures.ts";
import type { Site } from "../../core/sites.ts";
import { createHnAdapter } from "./index.ts";

const site: Site = { name: "hn", engine: "hn", base_url: "https://news.ycombinator.com", source: "preset" };

describe("Hacker News adapter", () => {
  it("keeps the article URL separate from the addressable discussion", async () => {
    const adapter = createHnAdapter(hnFixtureHttp());
    const [listed] = await adapter.hot(site, { limit: 1 });
    expect(listed!.url).toBe(`https://news.ycombinator.com/item?id=${listed!.id}`);
    expect(listed!.source_url).toMatch(/^https?:\/\//);
    expect(listed!.source_url).not.toBe(listed!.url);
  });

  it("reports the thread total separately from the fetched window", async () => {
    const adapter = createHnAdapter(hnFixtureHttp());
    const detail = await adapter.topic(site, "50644817", 1);

    const fetched = detail.posts.length - 1;
    expect(detail.total_replies).toBe(484);
    expect(detail.fetched_replies).toBe(fetched);
    expect(detail.omitted_replies).toBe(484 - fetched);
    expect(detail.truncated).toBe(true);
  });
});
