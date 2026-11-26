/**
 * Discourse-over-RSS adapter — for Discourse instances whose JSON endpoints
 * whose JSON endpoints are blocked (e.g. linux.do). The RSS endpoints remain
 * readable, so hot/latest/topic are mapped from feeds instead of /top.json.
 *
 * The output model matches the regular discourse adapter; engagement metrics
 * are simply omitted because feeds do not carry them.
 */

import { unsupported, type Adapter, type HotOpts, type ListOpts, type Period, type SiteCandidate } from "../../core/adapter.ts";
import { formatCliError, missingBaseUrlError } from "../../core/error-format.ts";
import { isHttpForbidden, NotFoundError, RateLimitError, UsageError } from "../../core/errors.ts";
import { HttpClient } from "../../core/http.ts";
import type { Site } from "../../core/sites.ts";
import { discourseTopicRef } from "../discourse/index.ts";
import { feedEntryToDetail, feedEntryToTopic, parseFeed } from "../rss/index.ts";

const ENGINE = "discourse-rss";

const TOP_PERIODS: Record<Period, string | undefined> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  all: undefined,
};

function topPath(period: Period = "day"): string {
  const value = TOP_PERIODS[period];
  return value ? `/top.rss?period=${value}` : "/top.rss";
}

function forumOrigin(site: Site): string {
  if (!site.base_url) throw new UsageError(missingBaseUrlError(site.name, true));
  try {
    return new URL(site.base_url).origin;
  } catch {
    throw new UsageError(
      formatCliError(`invalid base_url for site "${site.name}"`, [
        { heading: "Use the forum origin:", lines: ["base_url: https://linux.do"] },
      ]),
    );
  }
}

function candidateOrigin(candidate: SiteCandidate): string | undefined {
  const raw = candidate.url ?? candidate.base_url;
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // fall through
    }
  }
  if (candidate.host) return `https://${candidate.host}`;
  return undefined;
}

const FEED_ACCEPT = "application/rss+xml, application/xml;q=0.9, */*;q=0.8";

function challengedError(site: Site): RateLimitError {
  return new RateLimitError(
    formatCliError(`${site.name} is rate limiting or challenging its RSS feeds`, [
      { heading: "Wait a moment and retry, or check reachability:", lines: ["fora doctor"] },
    ]),
  );
}

export function createDiscourseRssAdapter(http: HttpClient = new HttpClient()): Adapter {
  const load = async (site: Site, path: string): Promise<ReturnType<typeof parseFeed>> =>
    parseFeed(await http.getText(`${forumOrigin(site)}${path}`, { accept: FEED_ACCEPT }));

  /** A 403 can be transient or path-specific; try equivalent feed URLs before giving up. */
  const loadWithFallback = async (site: Site, paths: string[]) => {
    let challenged = false;
    for (const path of [...new Set(paths)]) {
      try {
        return await load(site, path);
      } catch (error) {
        if (!isHttpForbidden(error)) throw error;
        challenged = true;
      }
    }
    throw challengedError(site);
  };

  return {
    engine: ENGINE,
    topicRefFromUrl: (url) => discourseTopicRef(url) ? url.href : undefined,
    capabilities: { hot: true, latest: true, hotPeriods: true, topic: true, search: false, categories: false },

    async detect(candidate: SiteCandidate): Promise<boolean> {
      const base = candidateOrigin(candidate);
      if (!base) return false;

      let isDiscourse = false;
      try {
        const info = await http.getJson<Record<string, unknown>>(`${base}/site.json`);
        isDiscourse = Boolean(info && (info.default_archetype || info.post_action_types || info.topic));
      } catch {
        return false;
      }
      if (!isDiscourse) return false;

      // A regular Discourse instance serves /latest.json. A blocked JSON
      // endpoint means this feed-backed transport is needed.
      try {
        await http.getJson(`${base}/latest.json`);
        return false;
      } catch (error) {
        return isHttpForbidden(error);
      }
    },

    async hot(site: Site, opts: HotOpts) {
      const entries = await loadWithFallback(site, [topPath(opts.period ?? "day"), "/hot.rss", "/top.rss"]);
      return entries.slice(0, opts.limit).map((entry) => feedEntryToTopic(entry, site));
    },

    async latest(site: Site, opts: ListOpts) {
      const entries = await loadWithFallback(site, ["/latest.rss"]);
      return entries.slice(0, opts.limit).map((entry) => feedEntryToTopic(entry, site));
    },

    async topic(site: Site, ref: string, page: number) {
      const url = URL.canParse(ref) ? new URL(ref) : undefined;
      const id = url ? discourseTopicRef(url) : ref;
      // A topic can come from any window, so check the feeds a list can use.
      const paths = ["/latest.rss", topPath("week"), topPath("day"), topPath("month"), "/top.rss", "/hot.rss"];
      let challenged = false;
      for (const path of paths) {
        let entries;
        try {
          entries = await load(site, path);
        } catch (error) {
          if (error instanceof NotFoundError) continue;
          if (!isHttpForbidden(error)) throw error;
          challenged = true;
          continue;
        }
        const entry = entries.find((candidate) =>
          candidate.id === ref || candidate.url === ref ||
          (id !== undefined && URL.canParse(candidate.url) && discourseTopicRef(new URL(candidate.url)) === id),
        );
        if (entry) return feedEntryToDetail(entry, site, page, ENGINE);
      }
      if (challenged) throw challengedError(site);
      throw new NotFoundError(
        formatCliError(`topic "${ref}" is not in the recent feeds of ${site.name}`, [
          { heading: "Refresh the list and pick a current result:", lines: [`fora hot --site ${site.name}`] },
        ]),
      );
    },

    async search(): Promise<never> {
      unsupported(ENGINE, "search");
    },

    async categories(): Promise<never> {
      unsupported(ENGINE, "categories");
    },
  };
}

const adapter = createDiscourseRssAdapter();
export default adapter;
