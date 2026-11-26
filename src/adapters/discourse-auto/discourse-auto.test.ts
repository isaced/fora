import { describe, expect, it } from "bun:test";
import type { Adapter } from "../../core/adapter.ts";
import type { DegradationStore } from "../../core/degradation.ts";
import { RateLimitError } from "../../core/errors.ts";
import type { Site } from "../../core/sites.ts";
import { createDiscourseAutoAdapter } from "./index.ts";

const site: Site = { name: "linuxdo", engine: "discourse", base_url: "https://linux.do", source: "preset" };

function topic(id: string) {
  return {
    id,
    site: site.name,
    title: id,
    url: `https://linux.do/t/${id}`,
    created_at: "2026-11-26T08:00:00.000Z",
    last_activity_at: "2026-11-26T08:00:00.000Z",
    pinned: false,
  };
}

function stub(overrides: Partial<Adapter> = {}): Adapter {
  return {
    engine: "discourse",
    capabilities: { hot: true, latest: true, hotPeriods: true, topic: true, search: true, categories: true },
    async detect() {
      return true;
    },
    async hot() {
      return [topic("json")];
    },
    async latest() {
      return [topic("json")];
    },
    async topic() {
      throw new Error("unused");
    },
    async search() {
      return [];
    },
    async categories() {
      return [];
    },
    ...overrides,
  } as Adapter;
}

describe("discourse auto adapter", () => {
  it("falls back to RSS on any HTTP 403 and records degradation", async () => {
    const store: DegradationStore = new Map();
    const json = stub({
      async hot() {
        throw new RateLimitError("GET https://linux.do/top.json failed with HTTP 403");
      },
    });
    const rss = stub({
      engine: "discourse-rss",
      async hot() {
        return [topic("rss")];
      },
    });

    const adapter = createDiscourseAutoAdapter(json, rss, store);
    const topics = await adapter.hot(site, { limit: 1 });

    expect(topics[0]!.id).toBe("rss");
    expect(store.get("linuxdo")?.to).toBe("discourse-rss");
    expect(store.get("linuxdo")?.limitations).toContain("no search");
  });

  it("clears degradation when the JSON API works again", async () => {
    const store: DegradationStore = new Map([
      ["linuxdo", { site: "linuxdo", from: "discourse", to: "discourse-rss", reason: "old", limitations: [] }],
    ]);
    const adapter = createDiscourseAutoAdapter(stub(), stub(), store);

    await adapter.latest(site, { limit: 1 });

    expect(store.has("linuxdo")).toBe(false);
  });

  it("keeps the original error when it is not an anti-bot challenge", async () => {
    const store: DegradationStore = new Map();
    const json = stub({
      async hot() {
        throw new Error("boom");
      },
    });
    const adapter = createDiscourseAutoAdapter(json, stub(), store);

    await expect(adapter.hot(site, { limit: 1 })).rejects.toThrow("boom");
    expect(store.size).toBe(0);
  });
});
