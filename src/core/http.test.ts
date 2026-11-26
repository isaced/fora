/**
 * Rate-limit / robustness behaviour (SPEC §9): a stub server proves we stop
 * and surface exit-code 4 on 429 and on anti-bot block pages, and retry 5xx.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { NetworkError, RateLimitError } from "./errors.ts";
import { HttpClient } from "./http.ts";

const savedBrowserFallback = process.env.FORA_BROWSER_FALLBACK;
process.env.FORA_BROWSER_FALLBACK = "0";

let server: ReturnType<typeof Bun.serve>;
let flakyCount = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/429") return new Response("slow down", { status: 429 });
      if (path === "/block") return new Response("<title>Just a moment...</title>", { status: 403 });
      if (path === "/flaky") {
        flakyCount += 1;
        return flakyCount <= 2 ? new Response("boom", { status: 503 }) : new Response("ok", { status: 200 });
      }
      return new Response("ok", { status: 200 });
    },
  });
});

afterAll(() => {
  if (savedBrowserFallback === undefined) delete process.env.FORA_BROWSER_FALLBACK;
  else process.env.FORA_BROWSER_FALLBACK = savedBrowserFallback;
  server.stop(true);
});

const base = () => `http://127.0.0.1:${server.port}`;

describe("HttpClient", () => {
  it("maps HTTP 429 to a RateLimitError (exit 4)", async () => {
    const client = new HttpClient({ minIntervalMs: 0, maxRetries: 0 });
    await expect(client.getText(`${base()}/429`)).rejects.toBeInstanceOf(RateLimitError);
    try {
      await client.getText(`${base()}/429`);
    } catch (error) {
      expect((error as RateLimitError).exitCode).toBe(4);
    }
  });

  it("treats an anti-bot block page as rate limiting", async () => {
    const client = new HttpClient({ minIntervalMs: 0, maxRetries: 0 });
    await expect(client.getText(`${base()}/block`)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("retries 5xx up to the configured limit, then succeeds", async () => {
    flakyCount = 0;
    const client = new HttpClient({ minIntervalMs: 0, maxRetries: 2 });
    const body = await client.getText(`${base()}/flaky`);
    expect(body).toBe("ok");
    expect(flakyCount).toBe(3);
  });

  it("maps connection failures to a NetworkError", async () => {
    const client = new HttpClient({ minIntervalMs: 0, maxRetries: 0, timeoutMs: 200 });
    await expect(client.getText("http://127.0.0.1:1/nope")).rejects.toBeInstanceOf(NetworkError);
  });
});
