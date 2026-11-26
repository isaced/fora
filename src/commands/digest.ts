/**
 * `fora digest` — the agent flagship: one call returns every followed site's
 * hot topics with OP excerpts and the top replies by likes (SPEC §6.2).
 *
 * Fetches are bounded by one global pool (sites and topics share it), while
 * HttpClient still enforces the per-host ≥300ms gap.
 */

import { defineCommand } from "citty";
import type { Adapter } from "../core/adapter.ts";
import { mapLimit } from "../core/async.ts";
import { applyFields } from "../core/fields.ts";
import { approxTokens, envelope } from "../core/envelope.ts";
import { errorMessage } from "../core/error-format.ts";
import type { DegradationInfo } from "../core/degradation.ts";
import type { Post, Topic } from "../core/model.ts";
import type { Site } from "../core/sites.ts";
import { followSiteNames, requireSite } from "../core/sites.ts";
import { withinSince } from "../core/time.ts";
import type { DigestGroup, DigestTopic } from "../output/human.ts";
import { renderDigest } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext, type Ctx } from "./context.ts";
import { fieldsArg, intOption, humanArg, jsonArg, parseFieldOption, resolveSince, sinceArg } from "./common.ts";

/** Total in-flight digest requests across all sites and topics. */
export const DIGEST_CONCURRENCY = 5;

export interface DigestFetchOptions {
  names: string[];
  perSite: number;
  topReplies: number;
  sinceMs?: number;
  concurrency?: number;
}

interface LoadedSite {
  group: DigestGroup;
  site?: Site;
  adapter?: Adapter;
  topics: Topic[];
}

function finishDigestTopic(
  topic: Topic,
  excerpt: string | undefined,
  topReplies: Post[],
  omitted: number,
): DigestTopic {
  return {
    ...topic,
    excerpt: excerpt ?? topic.excerpt,
    top_replies: topReplies,
    omitted_replies: omitted > 0 ? omitted : undefined,
  };
}

async function fetchDigestTopic(
  adapter: Adapter,
  site: Site,
  topic: Topic,
  topReplies: number,
): Promise<DigestTopic> {
  if (!adapter.capabilities.topic) return { ...topic };
  try {
    const detail = await adapter.topic(site, topic.id, 1);
    const replies = detail.posts.filter((post) => post.floor > 1);
    const top = [...replies].sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0)).slice(0, topReplies);
    const omitted = Math.max(0, replies.length - top.length);
    return finishDigestTopic(topic, detail.excerpt, top, omitted);
  } catch {
    return { ...topic };
  }
}

/** Resolve sites, fetch hot lists, then fetch topic details with one shared pool. */
export async function fetchDigestGroups(ctx: Ctx, options: DigestFetchOptions): Promise<DigestGroup[]> {
  const concurrency = options.concurrency ?? DIGEST_CONCURRENCY;

  const loaded: LoadedSite[] = await mapLimit(options.names, concurrency, async (name): Promise<LoadedSite> => {
    const group: DigestGroup = { site: name, topics: [] };
    let site: Site;
    try {
      site = requireSite(ctx.sites, name);
    } catch (error) {
      group.error = errorMessage(error);
      return { group, topics: [] };
    }

    const adapter = ctx.registry.get(site.engine);
    if (!adapter) {
      group.error = `unknown engine "${site.engine}"`;
      return { group, topics: [] };
    }
    if (!adapter.capabilities.hot) {
      group.error = `hot is not supported by ${site.engine}`;
      return { group, topics: [] };
    }

    try {
      const hot = await adapter.hot(site, { limit: options.perSite });
      const topics = hot.filter((topic) =>
        withinSince(topic.created_at, topic.last_activity_at, options.sinceMs),
      );
      group.topics = new Array<DigestTopic>(topics.length);
      return { group, site, adapter, topics };
    } catch (error) {
      group.error = errorMessage(error);
      return { group, topics: [] };
    }
  });

  const jobs: Array<{
    siteIndex: number;
    topicIndex: number;
    topic: Topic;
    site: Site;
    adapter: Adapter;
  }> = [];
  loaded.forEach((entry, siteIndex) => {
    entry.topics.forEach((topic, topicIndex) => {
      if (!entry.site || !entry.adapter) return;
      jobs.push({ siteIndex, topicIndex, topic, site: entry.site, adapter: entry.adapter });
    });
  });

  await mapLimit(jobs, concurrency, async (job) => {
    loaded[job.siteIndex]!.group.topics[job.topicIndex] = await fetchDigestTopic(
      job.adapter,
      job.site,
      job.topic,
      options.topReplies,
    );
  });

  return loaded.map((entry) => {
    const degraded: DegradationInfo | undefined = ctx.degradation?.get(entry.group.site);
    if (degraded) entry.group.degraded = degraded;
    return entry.group;
  });
}

export interface DigestBudgetMeta {
  budget: number;
  budget_used: number;
  per_site_tokens: Record<string, number>;
  omitted_sites: string[];
  omitted_topics: Record<string, number>;
  count: number;
}

/** Fit groups/topics into an approximate token budget in follow-list order. */
export function applyDigestBudget(
  groups: DigestGroup[],
  budget: number,
  fields?: string[],
): { groups: DigestGroup[]; meta: DigestBudgetMeta } {
  const payload = (selected: DigestGroup[]) =>
    selected.map((group) => ({
      site: group.site,
      error: group.error,
      degraded: group.degraded,
      topics: applyFields(group.topics, fields),
    }));
  const cost = (selected: DigestGroup[]) => approxTokens(payload(selected));

  const selected: DigestGroup[] = [];
  const perSiteTokens: Record<string, number> = {};
  const omittedSites: string[] = [];
  const omittedTopics: Record<string, number> = {};
  let used = 0;

  for (const group of groups) {
    const shell: DigestGroup = { ...group, topics: [] };
    if (cost([...selected, shell]) > budget) {
      omittedSites.push(group.site);
      if (group.topics.length > 0) omittedTopics[group.site] = group.topics.length;
      continue;
    }

    const topics: DigestTopic[] = [];
    for (const topic of group.topics) {
      const trial = [...selected, { ...shell, topics: [...topics, topic] }];
      if (cost(trial) > budget) break;
      topics.push(topic);
    }
    const kept: DigestGroup = { ...group, topics };
    selected.push(kept);
    used = cost(selected);
    perSiteTokens[group.site] = approxTokens(payload([kept]));
    const omitted = group.topics.length - topics.length;
    if (omitted > 0) omittedTopics[group.site] = omitted;
  }

  return {
    groups: selected,
    meta: {
      budget,
      budget_used: used,
      per_site_tokens: perSiteTokens,
      omitted_sites: omittedSites,
      omitted_topics: omittedTopics,
      count: selected.reduce((sum, group) => sum + group.topics.length, 0),
    },
  };
}

export function formatBudgetSummary(meta: DigestBudgetMeta): string {
  const sites = meta.omitted_sites.length > 0 ? meta.omitted_sites.join(", ") : "none";
  const topics = Object.values(meta.omitted_topics).reduce((sum, count) => sum + count, 0);
  return `[budget] ${meta.budget_used}/${meta.budget} tokens · omitted sites: ${sites} · omitted topics: ${topics}`;
}

export const digestCommand = defineCommand({
  meta: {
    name: "digest",
    description: "One-call briefing: followed sites' hot topics with excerpts and top replies",
  },
  args: {
    since: sinceArg,
    "per-site": {
      type: "string",
      description: "Hot topics per site (default 10)",
      valueHint: "n",
    },
    "top-replies": {
      type: "string",
      description: "Top replies by likes to include per topic (default 3)",
      valueHint: "n",
    },
    fields: fieldsArg,
    budget: {
      type: "string",
      description: "Maximum approximate tokens in the digest payload",
      valueHint: "n",
    },
    json: jsonArg,
    human: humanArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const perSite = intOption(args["per-site"] ?? (args as Record<string, unknown>).perSite, 10, "per-site");
    const topReplies = intOption(
      args["top-replies"] ?? (args as Record<string, unknown>).topReplies,
      3,
      "top-replies",
    );
    const sinceMs = resolveSince(args.since);
    const fields = parseFieldOption(args.fields);
    const json = Boolean(args.json);
    const budget = args.budget === undefined ? undefined : intOption(args.budget, 1, "budget");

    const fetched = await fetchDigestGroups(ctx, {
      names: followSiteNames(ctx.config),
      perSite,
      topReplies,
      sinceMs,
    });

    const fitted = budget === undefined
      ? { groups: fetched, meta: undefined }
      : applyDigestBudget(fetched, budget, fields);
    const groups = fitted.groups;
    const totalTopics = groups.reduce((sum, group) => sum + group.topics.length, 0);

    if (json) {
      const data = groups.map((group) => ({
        site: group.site,
        error: group.error,
        degraded: group.degraded,
        topics: applyFields(group.topics, fields),
      }));
      writeJson(
        envelope(data, {
          since: typeof args.since === "string" ? args.since : undefined,
          per_site: perSite,
          top_replies: topReplies,
          count: totalTopics,
          ...(fitted.meta ?? {}),
        }),
      );
      return;
    }

    process.stdout.write(`${renderDigest(groups)}\n`);
    if (fitted.meta) process.stdout.write(`${formatBudgetSummary(fitted.meta)}\n`);
  },
});
