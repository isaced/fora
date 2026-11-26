/**
 * Discourse auto engine — the default path for every `engine: discourse` site.
 *
 * It tries the JSON API first and falls back to Discourse feeds only when the
 * JSON endpoint is blocked by a Cloudflare-style anti-bot response (HTTP 403).
 * The fallback is recorded in a per-invocation store so every command can tell
 * agents that search, categories and engagement metrics are unavailable.
 */

import type { Adapter, SiteCandidate } from "../../core/adapter.ts";
import type { DegradationStore } from "../../core/degradation.ts";
import { RateLimitError, UnsupportedError } from "../../core/errors.ts";
import type { Site } from "../../core/sites.ts";

const LIMITATIONS = ["no search", "no categories", "no engagement metrics"];

function isChallenge(error: unknown): boolean {
  return error instanceof RateLimitError && /(anti-bot|HTTP 403)/.test(error.message);
}

function candidateSite(candidate: SiteCandidate): Site | undefined {
  const raw = candidate.url ?? candidate.base_url;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return {
      name: url.host.replace(/^www\./, "").replace(/\./g, "-"),
      engine: "discourse",
      base_url: url.origin,
      source: "preset",
    };
  } catch {
    return undefined;
  }
}

export function createDiscourseAutoAdapter(
  json: Adapter,
  rss: Adapter,
  store: DegradationStore,
): Adapter {
  const markDegraded = (site: Site) => {
    store.set(site.name, {
      site: site.name,
      from: "discourse",
      to: "discourse-rss",
      reason: "Discourse JSON API returned a Cloudflare-style challenge",
      limitations: LIMITATIONS,
    });
  };

  const attempt = async <T>(site: Site, run: (adapter: Adapter) => Promise<T>, operation: string): Promise<T> => {
    try {
      const result = await run(json);
      store.delete(site.name);
      return result;
    } catch (error) {
      if (!isChallenge(error)) throw error;
      markDegraded(site);
      try {
        return await run(rss);
      } catch (fallbackError) {
        if (fallbackError instanceof UnsupportedError) {
          throw new UnsupportedError(`${operation} after RSS fallback for ${site.name}`, "discourse");
        }
        throw fallbackError;
      }
    }
  };

  return {
    engine: "discourse",
    capabilities: json.capabilities,

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const probe = candidateSite(candidate);
      let jsonOk = false;
      try {
        jsonOk = await json.detect(candidate);
      } catch {
        jsonOk = false;
      }
      if (jsonOk && probe) {
        try {
          await json.latest(probe, { limit: 1 });
          store.delete(probe.name);
          return true;
        } catch (error) {
          if (!isChallenge(error)) return true;
          markDegraded(probe);
        }
      }
      return rss.detect(candidate);
    },

    hot: (site, opts) => attempt(site, (adapter) => adapter.hot(site, opts), "hot"),
    latest: (site, opts) => attempt(site, (adapter) => adapter.latest(site, opts), "latest"),
    topic: (site, ref, page) => attempt(site, (adapter) => adapter.topic(site, ref, page), "topic"),
    search: (site, query, opts) => attempt(site, (adapter) => adapter.search(site, query, opts), "search"),
    categories: (site) => attempt(site, (adapter) => adapter.categories(site), "categories"),
  };
}
