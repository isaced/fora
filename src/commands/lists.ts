/** `fora hot` and `fora latest` — the two list verbs. */

import { defineCommand, type CommandDef } from "citty";
import { errorMessage, formatCliError } from "../core/error-format.ts";
import { UnsupportedError } from "../core/errors.ts";
import type { Period } from "../core/adapter.ts";
import type { Topic } from "../core/model.ts";
import { parseSiteSelector, requireSite, sitesForAll, type Site } from "../core/sites.ts";
import { createContext } from "./context.ts";
import {
  assertCapability,
  fieldsArg,
  filterSince,
  finishList,
  intOption,
  jsonArg,
  limitArg,
  parseFieldOption,
  periodArg,
  pickSiteName,
  resolveSince,
  sinceArg,
  siteByName,
  siteFlagArg,
} from "./common.ts";

type ListKind = "hot" | "latest";

async function runList(kind: ListKind, args: Record<string, unknown>): Promise<void> {
  const ctx = await createContext();
  const limit = intOption(args.limit, 20, "limit");
  const fields = parseFieldOption(args.fields);
  const sinceMs = resolveSince(args.since);
  const json = Boolean(args.json);
  const period = kind === "hot" ? (args.period as Period | undefined) : undefined;

  const selectorRaw = pickSiteName(args.site, args.target, ctx.config, ctx.sites, kind);
  const selector = parseSiteSelector(selectorRaw);

  if (selector.all || selector.names.length > 1) {
    const targets: Site[] = selector.all
      ? sitesForAll(ctx.config, ctx.sites)
      : selector.names.map((name) => siteByName(ctx.sites, name));

    const collected: Topic[] = [];
    const failures: string[] = [];

    for (const site of targets) {
      try {
        collected.push(...(await fetchFromSite(ctx, site, kind, limit, period)));
      } catch (error) {
        failures.push(`${site.name}: ${errorMessage(error)}`);
      }
    }

    if (failures.length > 0) {
      const report = formatCliError(
        collected.length === 0 ? `all ${targets.length} site(s) failed` : "some sites failed",
        [{ heading: "Failures:", lines: failures }],
      );
      if (collected.length === 0) throw new Error(report);
      process.stderr.write(`fora: ${report}\n`);
    }

    await finishList(ctx, {
      topics: filterSince(collected, sinceMs),
      command: kind,
      siteLabel: selectorRaw,
      fields,
      json,
      groupBySite: !json,
      meta: { since: typeof args.since === "string" ? args.since : undefined },
    });
    return;
  }

  const site = requireSite(ctx.sites, selectorRaw);
  const topics = await fetchFromSite(ctx, site, kind, limit, period);

  await finishList(ctx, {
    topics: filterSince(topics, sinceMs),
    command: kind,
    siteLabel: site.name,
    fields,
    json,
    meta: { site: site.name, since: typeof args.since === "string" ? args.since : undefined },
  });
}

async function fetchFromSite(
  ctx: Awaited<ReturnType<typeof createContext>>,
  site: Site,
  kind: ListKind,
  limit: number,
  period: Period | undefined,
): Promise<Topic[]> {
  const adapter = ctx.registry.require(site.engine);
  assertCapability(adapter, kind, kind);
  if (period && !adapter.capabilities.hotPeriods) {
    throw new UnsupportedError("hot --period", adapter.engine);
  }
  if (kind === "hot") {
    return adapter.hot(site, period ? { limit, period } : { limit });
  }
  return adapter.latest(site, { limit });
}

function build(kind: ListKind) {
  return defineCommand({
    meta: {
      name: kind,
      description:
        kind === "hot"
          ? "Ranked topics by engagement (per-engine period window)"
          : "Chronological latest topics",
    },
    args: {
      target: {
        type: "positional",
        required: false,
        description: "Site name (same as --site)",
      },
      site: siteFlagArg,
      json: jsonArg,
      limit: limitArg,
      since: sinceArg,
      fields: fieldsArg,
      ...(kind === "hot" ? { period: periodArg } : {}),
    },
    async run({ args }) {
      await runList(kind, args as Record<string, unknown>);
    },
  });
}

export const hotCommand = build("hot");
export const latestCommand = build("latest");
