import { describe, expect, it } from "bun:test";
import type { Adapter } from "../core/adapter.ts";
import { approxTokens } from "../core/envelope.ts";
import type { Topic, TopicDetail } from "../core/model.ts";
import type { Site } from "../core/sites.ts";
import type { Ctx } from "./context.ts";
import { applyDigestBudget, fetchDigestGroups } from "./digest.ts";

function topic(id: string): Topic {
  return {
    id,
    site: "s1",
    title: `topic ${id}`,
    url: `https://example.test/${id}`,
    created_at: "2026-11-26T08:00:00.000Z",
    last_activity_at: "2026-11-26T09:00:00.000Z",
    pinned: false,
  };
}

interface Stats {
  active: number;
  max: number;
}

function makeAdapter(engine: string, topics: Topic[], stats: Stats): Adapter {
  const enter = async (ms: number) => {
    stats.active += 1;
    stats.max = Math.max(stats.max, stats.active);
    await Bun.sleep(ms);
    stats.active -= 1;
  };

  return {
    engine,
    capabilities: { hot: true, latest: true, hotPeriods: false, topic: true, search: false, categories: false },
    async detect() {
      return true;
    },
    async hot() {
      await enter(10);
      return topics;
    },
    async latest() {
      return topics;
    },
    async topic(_site, ref, page): Promise<TopicDetail> {
      await enter(20);
      const base = topic(ref);
      return {
        ...base,
        excerpt: "OP excerpt",
        posts: [
          {
            id: `${ref}-1`,
            topic_id: ref,
            floor: 1,
            content_text: "OP",
            created_at: base.created_at,
          },
          {
            id: `${ref}-2`,
            topic_id: ref,
            floor: 2,
            content_text: "reply one",
            created_at: base.created_at,
            like_count: 7,
          },
          {
            id: `${ref}-3`,
            topic_id: ref,
            floor: 3,
            content_text: "reply two",
            created_at: base.created_at,
            like_count: 3,
          },
        ],
        post_count: 3,
        page,
        pages: 1,
      };
    },
    async search() {
      return [];
    },
    async categories() {
      return [];
    },
  };
}

function makeCtx(engines: Record<string, Adapter>, siteNames: string[]): Ctx {
  const sites: Site[] = siteNames
    .filter((name) => name !== "missing")
    .map((name, index) => ({
      name,
      engine: `e${index}`,
      source: "preset",
    }));
  return {
    sites,
    registry: { get: (engine: string) => engines[engine] },
  } as unknown as Ctx;
}

describe("applyDigestBudget", () => {
  it("fills sites in order and reports what was omitted", () => {
    const groups = [
      { site: "a", topics: [topic("a1"), topic("a2")] },
      { site: "b", topics: [topic("b1")] },
    ];
    const budget = approxTokens([{ site: "a", topics: [groups[0]!.topics[0]] }]);

    const fitted = applyDigestBudget(groups as never, budget);

    expect(fitted.groups.map((group) => group.site)).toEqual(["a"]);
    expect(fitted.groups[0]!.topics).toHaveLength(1);
    expect(fitted.meta.budget).toBe(budget);
    expect(fitted.meta.budget_used).toBeLessThanOrEqual(budget);
    expect(fitted.meta.per_site_tokens.a).toBeGreaterThan(0);
    expect(fitted.meta.omitted_sites).toEqual(["b"]);
    expect(fitted.meta.omitted_topics).toEqual({ a: 1, b: 1 });
  });
});

describe("fetchDigestGroups", () => {
  it("uses one bounded global pool and preserves site/topic order", async () => {
    const stats: Stats = { active: 0, max: 0 };
    const engines = {
      e0: makeAdapter("e0", [topic("a0"), topic("a1"), topic("a2")], stats),
      e1: makeAdapter("e1", [topic("b0"), topic("b1"), topic("b2")], stats),
    };
    const ctx = makeCtx(engines, ["s1", "s2"]);

    const groups = await fetchDigestGroups(ctx, {
      names: ["s1", "s2"],
      perSite: 3,
      topReplies: 2,
      concurrency: 5,
    });

    expect(stats.max).toBeLessThanOrEqual(5);
    expect(stats.max).toBeGreaterThan(1);
    expect(groups.map((group) => group.site)).toEqual(["s1", "s2"]);
    expect(groups[0]!.topics.map((item) => item.id)).toEqual(["a0", "a1", "a2"]);
    expect(groups[1]!.topics.map((item) => item.id)).toEqual(["b0", "b1", "b2"]);
    expect(groups[0]!.topics[0]!.top_replies?.map((post) => post.id)).toEqual(["a0-2", "a0-3"]);
    expect(groups[0]!.topics[0]!.excerpt).toBe("OP excerpt");
  });

  it("exposes degraded sites in the output groups", async () => {
    const stats: Stats = { active: 0, max: 0 };
    const ctx = makeCtx({ e0: makeAdapter("e0", [topic("a0")], stats) }, ["s1"]);
    ctx.degradation = new Map([
      [
        "s1",
        {
          site: "s1",
          from: "discourse",
          to: "discourse-rss",
          reason: "challenge",
          limitations: ["no search"],
        },
      ],
    ]);

    const groups = await fetchDigestGroups(ctx, {
      names: ["s1"],
      perSite: 1,
      topReplies: 1,
      concurrency: 2,
    });

    expect(groups[0]!.degraded?.to).toBe("discourse-rss");
    expect(groups[0]!.degraded?.limitations).toContain("no search");
  });

  it("keeps one site's failure from blocking the others", async () => {
    const stats: Stats = { active: 0, max: 0 };
    const ctx = makeCtx({ e0: makeAdapter("e0", [topic("a0")], stats) }, ["s1", "s2", "missing"]);

    const groups = await fetchDigestGroups(ctx, {
      names: ["s1", "s2", "missing"],
      perSite: 1,
      topReplies: 1,
      concurrency: 4,
    });

    expect(groups[0]!.topics).toHaveLength(1);
    expect(groups[1]!.error).toContain('unknown engine "e1"');
    expect(groups[2]!.error).toContain("unknown site");
  });
});
