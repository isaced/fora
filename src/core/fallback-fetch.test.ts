import { afterEach, describe, expect, it } from "bun:test";
import type { DegradationStore } from "./degradation.ts";
import { configureFallbackSink, withBrowserFallback } from "./fallback-fetch.ts";

const challenge = '<html><title>Just a moment...</title><body>cf-challenge</body></html>';

afterEach(() => {
  configureFallbackSink(undefined);
  delete process.env.FORA_BROWSER_FALLBACK;
});

describe("withBrowserFallback", () => {
  it("retries anti-bot 403s through the browser and records degradation", async () => {
    const store: DegradationStore = new Map();
    configureFallbackSink({
      store,
      siteForUrl: () => "ruby-china",
    });

    let browserCalls = 0;
    const browser = (async () => {
      browserCalls += 1;
      return new Response('{"topics":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    const base = (async () => new Response(challenge, { status: 403 })) as unknown as typeof fetch;

    const result = await withBrowserFallback(base, browser)("https://ruby-china.org/api/v3/topics.json");

    expect(result.status).toBe(200);
    expect(browserCalls).toBe(1);
    expect(store.get("ruby-china")?.to).toBe("browser");
    expect(store.get("ruby-china")?.limitations).toContain("requires agent-browser");
  });

  it("leaves non-challenge responses untouched", async () => {
    let browserCalls = 0;
    const browser = (async () => {
      browserCalls += 1;
      return new Response("browser");
    }) as unknown as typeof fetch;
    const base = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const result = await withBrowserFallback(base, browser)("https://example.com/");
    expect(await result.text()).toBe("ok");
    expect(browserCalls).toBe(0);
  });

  it("respects FORA_BROWSER_FALLBACK=0", async () => {
    process.env.FORA_BROWSER_FALLBACK = "0";
    let browserCalls = 0;
    const browser = (async () => {
      browserCalls += 1;
      return new Response("browser");
    }) as unknown as typeof fetch;
    const base = (async () => new Response(challenge, { status: 403 })) as unknown as typeof fetch;

    const result = await withBrowserFallback(base, browser)("https://example.com/");
    expect(result.status).toBe(403);
    expect(browserCalls).toBe(0);
  });
});
