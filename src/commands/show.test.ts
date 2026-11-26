import { describe, expect, it } from "bun:test";
import type { Adapter } from "../core/adapter.ts";
import type { TopicDetail } from "../core/model.ts";
import type { Ctx } from "./context.ts";
import { collectShowResults, shapeTopicDetail } from "./show.ts";

function detail(): TopicDetail {
  return {
    id: "42",
    site: "linuxdo",
    title: "A long topic",
    url: "https://linux.do/t/42",
    created_at: "2026-11-26T08:00:00.000Z",
    last_activity_at: "2026-11-26T09:00:00.000Z",
    pinned: false,
    posts: [
      {
        id: "op",
        topic_id: "42",
        floor: 1,
        content_text: "OP body with enough text to be useful",
        content_html: "<p>OP body with enough text to be useful</p>",
        created_at: "2026-11-26T08:00:00.000Z",
      },
      {
        id: "r1",
        topic_id: "42",
        floor: 2,
        content_text: "low likes",
        created_at: "2026-11-26T08:10:00.000Z",
        like_count: 1,
      },
      {
        id: "r2",
        topic_id: "42",
        floor: 3,
        content_text: "high likes",
        created_at: "2026-11-26T08:20:00.000Z",
        like_count: 9,
      },
      {
        id: "r3",
        topic_id: "42",
        floor: 4,
        content_text: "medium likes",
        created_at: "2026-11-26T08:30:00.000Z",
        like_count: 4,
      },
    ],
    post_count: 4,
    page: 1,
    pages: 1,
  };
}

describe("collectShowResults", () => {
  it("keeps batch order and isolates one failed ref", async () => {
    const adapter = {
      engine: "e1",
      capabilities: { hot: true, latest: true, hotPeriods: false, topic: true, search: false, categories: false },
      async detect() {
        return true;
      },
      async hot() {
        return [];
      },
      async latest() {
        return [];
      },
      async topic(_site, ref: string) {
        if (ref === "bad") throw new Error("not found");
        return detail();
      },
      async search() {
        return [];
      },
      async categories() {
        return [];
      },
    } as Adapter;
    const ctx = {
      sites: [{ name: "s1", engine: "e1", base_url: "https://s1.test", source: "preset" }],
      registry: { get: () => adapter, require: () => adapter },
      degradation: new Map(),
    } as unknown as Ctx;

    const { results, firstError } = await collectShowResults(ctx, ["s1:1", "s1:bad", "s1:2"], {
      page: 1,
      replies: 1,
    });

    expect(results.map((result) => result.ref)).toEqual(["s1:1", "s1:bad", "s1:2"]);
    expect(results[1]!.error).toBe("not found");
    expect(firstError).toBeInstanceOf(Error);
    expect(results[0]!.detail?.posts).toHaveLength(2);
    expect(results[2]!.detail?.id).toBe("42");
  });
});

describe("shapeTopicDetail", () => {
  it("keeps the OP and top replies, declaring what was omitted", () => {
    const shaped = shapeTopicDetail(detail(), 2);
    expect(shaped.posts.map((post) => post.id)).toEqual(["op", "r2", "r3"]);
    expect(shaped.truncated).toBe(true);
    expect(shaped.omitted_replies).toBe(1);
  });

  it("replaces bodies with excerpts when requested", () => {
    const shaped = shapeTopicDetail(detail(), 1, true);
    expect(shaped.posts).toHaveLength(2);
    expect(shaped.posts[0]!.content_text).toContain("OP body");
    expect(shaped.posts[0]!.content_html).toBeUndefined();
    expect(shaped.excerpt).toContain("OP body");
  });

  it("measures omitted replies against the thread total, not the fetched window", () => {
    const long = detail();
    long.post_count = 1001;
    long.total_replies = 1000;
    long.fetched_replies = 3;

    const shaped = shapeTopicDetail(long, 1);

    expect(shaped.fetched_replies).toBe(3);
    expect(shaped.omitted_replies).toBe(999);
    expect(shaped.truncated).toBe(true);
  });

  it("keeps every reply when no limit is given", () => {
    const shaped = shapeTopicDetail(detail());
    expect(shaped.posts).toHaveLength(4);
    expect(shaped.truncated).toBeUndefined();
  });
});
