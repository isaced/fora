/** Shared CLI argument definitions and helpers used by every command. */

import type { Adapter, Capabilities } from "../core/adapter.ts";
import { applyFields, parseFields } from "../core/fields.ts";
import { envelope } from "../core/envelope.ts";
import { degradationMeta, degradedSites, formatDegradation } from "../core/degradation.ts";
import { formatCliError, knownSitesSection, type ErrorSection } from "../core/error-format.ts";
import { UnsupportedError, UsageError } from "../core/errors.ts";
import type { Topic } from "../core/model.ts";
import { defaultSiteName, parseSiteSelector, unknownSiteError, type Site } from "../core/sites.ts";
import { parseDuration, withinSince } from "../core/time.ts";
import type { Ctx } from "./context.ts";
import { renderTopicList } from "../output/human.ts";
import { writeJson } from "../output/json.ts";

export const jsonArg = {
  type: "boolean",
  description: "Emit the fora/v1 JSON envelope",
  default: false,
} as const;

export const siteFlagArg = {
  type: "string",
  description: 'Site name, "all", or a comma-separated list',
  valueHint: "name|all|a,b",
} as const;

export const limitArg = {
  type: "string",
  alias: "n",
  description: "Maximum number of results (default 20)",
  valueHint: "n",
} as const;

export const sinceArg = {
  type: "string",
  description: "Only topics created or active within a window (e.g. 24h, 7d)",
  valueHint: "duration",
} as const;

export const fieldsArg = {
  type: "string",
  description: "Return only these comma-separated model fields",
  valueHint: "a,b,c",
} as const;

export const periodArg = {
  type: "enum" as const,
  options: ["day", "week", "month", "all"],
  description: "Ranking window for hot",
};

export const yesArg = {
  type: "boolean",
  alias: "y",
  description: "Skip interactive confirmation",
  default: false,
} as const;

export function intOption(raw: unknown, fallback: number, name: string): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new UsageError(
      formatCliError(`--${name} must be a positive integer`, [
        { heading: "Example:", lines: [`--${name} 20`] },
      ]),
    );
  }
  return value;
}

/** Site resolution order: --site flag → positional → FORA_SITE → default_site. */
export function pickSiteName(
  flag: unknown,
  positional: unknown,
  config: Ctx["config"],
  sites: Site[] = [],
  command = "hot",
  positionalSite = true,
): string {
  for (const candidate of [flag, positional, process.env.FORA_SITE]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  const fallback = defaultSiteName(config);
  if (fallback) return fallback;

  const sections: ErrorSection[] = [
    {
      heading: "Pass a site explicitly:",
      lines: [
        `fora ${command} --site <name>`,
        ...(positionalSite ? [`fora ${command} <name>`] : []),
      ],
    },
    {
      heading: "Or set a default in config:",
      lines: ["default_site: <name>"],
    },
  ];
  if (sites.length > 0) sections.push(knownSitesSection(sites.map((site) => site.name)));
  sections.push({ heading: "Add a custom site:", lines: ["fora sites add <url>"] });

  throw new UsageError(formatCliError("no site specified", sections));
}

export function assertCapability(adapter: Adapter, capability: keyof Capabilities, operation: string): void {
  if (!adapter.capabilities[capability]) throw new UnsupportedError(operation, adapter.engine);
}

export function resolveSince(raw: unknown): number | undefined {
  return typeof raw === "string" && raw.trim() ? parseDuration(raw) : undefined;
}

export function filterSince(topics: Topic[], sinceMs: number | undefined): Topic[] {
  if (sinceMs === undefined) return topics;
  return topics.filter((topic) => withinSince(topic.created_at, topic.last_activity_at, sinceMs));
}

export function parseFieldOption(raw: unknown): string[] | undefined {
  return parseFields(typeof raw === "string" ? raw : undefined);
}

export interface FinishListParams {
  topics: Topic[];
  command: string;
  siteLabel: string;
  fields?: string[];
  json: boolean;
  groupBySite?: boolean;
  meta?: Record<string, unknown>;
}

/** Cache the full list (before projection) then render human or JSON output. */
export async function finishList(ctx: Ctx, params: FinishListParams): Promise<void> {
  await ctx.cache.write(params.topics, { site: params.siteLabel, command: params.command });

  const selector = parseSiteSelector(params.siteLabel);
  const names = selector.all ? ctx.sites.map((site) => site.name) : selector.names;
  const degraded = degradedSites(ctx.degradation, names);

  if (params.json) {
    const data = applyFields(params.topics, params.fields);
    writeJson(
      envelope(data, {
        site: params.siteLabel,
        count: params.topics.length,
        ...degradationMeta(degraded),
        ...(params.meta ?? {}),
      }),
    );
    return;
  }

  for (const info of degraded) process.stderr.write(`fora: degraded: ${formatDegradation(info)}\n`);
  process.stdout.write(`${renderTopicList(params.topics, { groupBySite: params.groupBySite })}\n`);
}

/** Resolve and validate a site by name from the merged universe. */
export function siteByName(sites: Site[], name: string): Site {
  const site = sites.find((candidate) => candidate.name === name);
  if (!site) throw unknownSiteError(name, sites);
  return site;
}
