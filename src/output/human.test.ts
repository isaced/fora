import { describe, expect, it } from "bun:test";
import type { Topic, TopicDetail } from "../core/model.ts";
import { renderTopicDetail, renderTopicList, type DoctorSiteReport } from "./human.ts";
import { renderDoctor } from "./human.ts";

const now = new Date().toISOString();

const topic: Topic = {
  id: "42",
  site: "demo",
  title: "A deterministic title",
  url: "https://example.com/t/42",
  author: { username: "alice" },
  category: { id: "1", name: "General" },
  reply_count: 12,
  view_count: 300,
  created_at: now,
  last_activity_at: now,
  pinned: false,
};

const detail: TopicDetail = {
  ...topic,
  posts: [
    {
      id: "1",
      topic_id: "42",
      floor: 1,
      author: { username: "alice" },
      content_text: "Hello world",
      created_at: now,
    },
  ],
  post_count: 1,
  page: 1,
  pages: 1,
};

describe("renderTopicDetail (golden)", () => {
  it("renders header, meta and posts as plain text", () => {
    const output = renderTopicDetail(detail, { width: 0 });
    expect(output).toBe(
      [
        "A deterministic title",
        "demo · General · @alice · #42",
        "https://example.com/t/42",
        "",
        "#1 @alice · just now",
        "Hello world",
      ].join("\n"),
    );
  });
});

describe("renderTopicList", () => {
  it("numbers results and includes title, author and category", () => {
    const output = renderTopicList([topic], { width: 0 });
    const lines = output.split("\n");
    expect(lines[0]).toContain("TITLE");
    expect(lines[1]).toContain("1");
    expect(lines[1]).toContain("A deterministic title");
    expect(lines[1]).toContain("alice");
    expect(lines[1]).toContain("General");
  });
});

describe("renderDoctor", () => {
  it("lists engines and per-site status", () => {
    const sites: DoctorSiteReport[] = [
      { name: "v2ex", engine: "v2ex", reachable: true },
      { name: "linuxdo", engine: "discourse", reachable: false, error: "boom" },
    ];
    const output = renderDoctor({ sites, engines: ["v2ex", "discourse"] });
    expect(output).toContain("loaded engines: v2ex, discourse");
    expect(output).toContain("reachable");
    expect(output).toContain("unreachable");
    expect(output).toContain("boom");
  });
});
