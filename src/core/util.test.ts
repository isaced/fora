import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListCache } from "./cache.ts";
import { ConfigStore } from "./config.ts";
import { envelope, approxTokens } from "./envelope.ts";
import { ConfigError, UsageError } from "./errors.ts";
import { applyFields, parseFields, pickTopicFields } from "./fields.ts";
import type { Topic } from "./model.ts";

const sampleTopic: Topic = {
  id: "1",
  site: "v2ex",
  title: "Hello",
  url: "https://example.com/t/1",
  author: { username: "alice" },
  created_at: "2026-11-26T08:00:00.000Z",
  last_activity_at: "2026-11-26T09:00:00.000Z",
  pinned: false,
};

describe("envelope", () => {
  it("wraps data in the fora/v1 schema with a token estimate", () => {
    const wrapped = envelope([{ id: "1" }], { site: "demo" });
    expect(wrapped.schema).toBe("fora/v1");
    expect(wrapped.data).toEqual([{ id: "1" }]);
    expect(wrapped.meta.site).toBe("demo");
    expect(wrapped.meta.approx_tokens).toBe(approxTokens([{ id: "1" }]));
    expect(wrapped.meta.approx_tokens).toBeGreaterThan(0);
  });
});

describe("fields", () => {
  it("always keeps site in a projection", () => {
    const projected = pickTopicFields(sampleTopic, ["title"]);
    expect(projected).toEqual({ site: "v2ex", title: "Hello" });
  });

  it("drops unspecified fields", () => {
    const [projected] = applyFields([sampleTopic], ["id", "url"]);
    expect(projected).toEqual({ id: "1", site: "v2ex", url: "https://example.com/t/1" });
  });

  it("rejects unknown field names with a wrapped list of valid fields", () => {
    expect(() => parseFields("title,bogus")).toThrow(UsageError);
    let message = "";
    try {
      parseFields("title,bogus");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.split("\n")[0]).toBe("unknown --fields value(s): bogus");
    expect(message).toContain("Valid fields:");
    expect(message.split("\n").every((line) => line.length <= 80)).toBe(true);
    expect(parseFields(undefined)).toBeUndefined();
  });
});

describe("ListCache", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "fora-cache-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves 1-based indices and rejects out-of-range values", async () => {
    const cache = new ListCache({ dir });
    expect(await cache.read()).toBeUndefined();

    await cache.write([sampleTopic], { site: "v2ex", command: "hot" });
    expect((await cache.resolve(1)).id).toBe("1");
    await expect(cache.resolve(2)).rejects.toBeInstanceOf(UsageError);
    await expect(cache.resolve(0)).rejects.toBeInstanceOf(UsageError);
  });
});

describe("ConfigStore", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "fora-config-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads defaults, adds and removes sites", async () => {
    const store = new ConfigStore({ dir });
    const initial = await store.load();
    expect(initial.sites).toEqual([]);

    await store.addSite({ name: "demo", engine: "discourse", base_url: "https://demo.example" });
    const afterAdd = await store.load();
    expect(afterAdd.sites).toHaveLength(1);
    expect(afterAdd.sites[0]!.name).toBe("demo");

    const { removed } = await store.removeSite("demo");
    expect(removed).toBe(true);
    expect((await store.load()).sites).toHaveLength(0);
  });

  it("raises ConfigError on malformed YAML", async () => {
    const store = new ConfigStore({ path: join(dir, "broken.yaml") });
    await Bun.write(store.path, "sites: [unclosed");
    await expect(store.load()).rejects.toBeInstanceOf(ConfigError);
  });
});
