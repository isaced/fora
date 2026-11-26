/**
 * Shared adapter contract test (SPEC §4/§10): every registered adapter is
 * exercised against its recorded fixtures for each capability it claims.
 */

import { describe, expect, it } from "bun:test";
import { ForaError } from "./errors.ts";
import type { Topic } from "./model.ts";
import { buildFixtureAdapters } from "./testing/fixtures.ts";

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function assertTopicShape(topic: Topic, siteName: string): void {
  expect(typeof topic.id).toBe("string");
  expect(topic.id.length).toBeGreaterThan(0);
  expect(topic.site).toBe(siteName);
  expect(typeof topic.title).toBe("string");
  expect(topic.url).toMatch(/^https?:\/\//);
  expect(topic.created_at).toMatch(RFC3339);
  expect(topic.last_activity_at).toMatch(RFC3339);
  expect(typeof topic.pinned).toBe("boolean");
}

async function expectUnsupported(run: () => Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ForaError);
  expect((error as ForaError).exitCode).toBe(3);
}

async function firstTopics(fixture: ReturnType<typeof buildFixtureAdapters>[number]): Promise<Topic[]> {
  const { adapter, site } = fixture;
  return adapter.capabilities.hot ? adapter.hot(site, { limit: 5 }) : adapter.latest(site, { limit: 5 });
}

for (const fixture of buildFixtureAdapters()) {
  const { adapter, site } = fixture;

  describe(`contract:${fixture.label}`, () => {
    it("detects its own base URL", async () => {
      const detected = await adapter.detect({ base_url: site.base_url, url: site.base_url });
      if (adapter.engine === "rss") expect(detected).toBe(false);
      else expect(detected).toBe(true);
    });

    it("returns well-formed topics for its list verb", async () => {
      const topics = await firstTopics(fixture);
      expect(topics.length).toBeGreaterThan(0);
      for (const topic of topics) assertTopicShape(topic, site.name);
    });

    it("returns a well-formed topic detail when supported", async () => {
      if (!adapter.capabilities.topic) return;
      const topics = await firstTopics(fixture);
      const first = topics[0]!;
      const detail = await adapter.topic(site, first.id, 1);

      expect(detail.site).toBe(site.name);
      expect(detail.id.length).toBeGreaterThan(0);
      expect(Array.isArray(detail.posts)).toBe(true);
      expect(detail.posts.length).toBeGreaterThan(0);
      expect(detail.post_count).toBeGreaterThanOrEqual(1);
      expect(detail.page).toBe(1);
      expect(detail.pages).toBeGreaterThanOrEqual(1);

      for (const post of detail.posts) {
        expect(typeof post.id).toBe("string");
        expect(typeof post.content_text).toBe("string");
        expect(post.floor).toBeGreaterThanOrEqual(1);
        expect(post.created_at).toMatch(RFC3339);
      }
    });

    it("searches when supported", async () => {
      if (!adapter.capabilities.search) return;
      const topics = await adapter.search(site, "test", { limit: 3 });
      expect(topics.length).toBeGreaterThan(0);
      for (const topic of topics) assertTopicShape(topic, site.name);
    });

    it("lists categories when supported", async () => {
      if (!adapter.capabilities.categories) return;
      const categories = await adapter.categories(site);
      expect(categories.length).toBeGreaterThan(0);
      for (const category of categories) {
        expect(typeof category.id).toBe("string");
        expect(typeof category.name).toBe("string");
      }
    });

    it("reports unsupported operations as exit-code-3 errors", async () => {
      if (!adapter.capabilities.hot) await expectUnsupported(() => adapter.hot(site, { limit: 1 }));
      if (!adapter.capabilities.search) await expectUnsupported(() => adapter.search(site, "x", { limit: 1 }));
      if (!adapter.capabilities.categories) await expectUnsupported(() => adapter.categories(site));
      if (adapter.capabilities.hot && !adapter.capabilities.hotPeriods) {
        await expectUnsupported(() => adapter.hot(site, { limit: 1, period: "week" }));
      }
    });
  });
}
