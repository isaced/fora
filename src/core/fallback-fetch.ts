/**
 * Generic anti-bot fallback: replay a blocked request through the browser
 * transport and record the downgrade for output metadata.
 */

import { createBrowserFetch } from "./browser-fetch.ts";
import type { DegradationStore } from "./degradation.ts";

export interface FallbackSink {
  store: DegradationStore;
  siteForUrl: (url: string) => string;
}

let sink: FallbackSink | undefined;

export function configureFallbackSink(next: FallbackSink | undefined): void {
  sink = next;
}

function looksBlocked(status: number, headers: Headers, body: string): boolean {
  if (status !== 403) return false;
  if (headers.get("cf-mitigated") === "challenge") return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("cf-challenge") ||
    (lower.includes("cloudflare") && (lower.includes("captcha") || lower.includes("challenge")))
  );
}

/** Wrap a fetch so anti-bot 403s are retried through agent-browser once. */
export function withBrowserFallback(base: typeof fetch, browser?: typeof fetch): typeof fetch {
  let browserFetch = browser;
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const response = await base(input, init);
    if (response.status !== 403) return response;

    const body = await response.text();
    const rebuild = () =>
      new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

    if (!looksBlocked(response.status, response.headers, body)) return rebuild();
    if (process.env.FORA_BROWSER_FALLBACK === "0") return rebuild();

    try {
      browserFetch ??= createBrowserFetch();
      const retried = await browserFetch(input, init);
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (sink) {
        const url = new URL(target);
        const site = sink.siteForUrl(url.href);
        sink.store.set(site, {
          site,
          from: "http",
          to: "browser",
          reason: `Cloudflare anti-bot on GET ${url.pathname}${url.search}`,
          limitations: ["requires agent-browser", "slower", "needs headed browser"],
        });
      }
      return retried;
    } catch {
      return rebuild();
    }
  }) as typeof fetch;
}
