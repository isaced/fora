/**
 * `fora digest` — the agent flagship: one call returns every followed site's
 * hot topics with OP excerpts and the top replies by likes (SPEC §6.2).
 */

import { defineCommand } from "citty";
import { mapLimit } from "../core/async.ts";
import { applyFields } from "../core/fields.ts";
import { envelope } from "../core/envelope.ts";
import { errorMessage } from "../core/error-format.ts";
import type { Post, Topic } from "../core/model.ts";
import { followSiteNames, requireSite } from "../core/sites.ts";
import { withinSince } from "../core/time.ts";
import type { DigestGroup, DigestTopic } from "../output/human.ts";
import { renderDigest } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext } from "./context.ts";
import { fieldsArg, intOption, jsonArg, parseFieldOption, resolveSince, sinceArg } from "./common.ts";

const TOPIC_CONCURRENCY = 3;

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
    json: jsonArg,
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

    const names = followSiteNames(ctx.config);
    const groups: DigestGroup[] = await mapLimit(names, TOPIC_CONCURRENCY, async (name) => {
      let site;
      try {
        site = requireSite(ctx.sites, name);
      } catch (error) {
        return { site: name, topics: [], error: errorMessage(error) };
      }

      const adapter = ctx.registry.get(site.engine);
      if (!adapter) return { site: name, topics: [], error: `unknown engine "${site.engine}"` };
      if (!adapter.capabilities.hot) {
        return { site: name, topics: [], error: `hot is not supported by ${site.engine}` };
      }

      try {
        const hot = await adapter.hot(site, { limit: perSite });
        const filtered = hot.filter((topic) => withinSince(topic.created_at, topic.last_activity_at, sinceMs));

        const topics = await mapLimit(filtered, TOPIC_CONCURRENCY, async (topic): Promise<DigestTopic> => {
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
        });

        return { site: name, topics };
      } catch (error) {
        return { site: name, topics: [], error: errorMessage(error) };
      }
    });

    const totalTopics = groups.reduce((sum, group) => sum + group.topics.length, 0);

    if (json) {
      const data = groups.map((group) => ({
        site: group.site,
        error: group.error,
        topics: applyFields(group.topics, fields),
      }));
      writeJson(
        envelope(data, {
          since: typeof args.since === "string" ? args.since : undefined,
          per_site: perSite,
          top_replies: topReplies,
          count: totalTopics,
        }),
      );
      return;
    }

    process.stdout.write(`${renderDigest(groups)}\n`);
  },
});

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
