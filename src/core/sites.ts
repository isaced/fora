/**
 * Site resolution: merges the three sources of sites — user config,
 * the bundled directory, and built-in presets — with the precedence from
 * SPEC §5.1 (user config overrides the directory on a name clash).
 */

import type { ForaConfig, SiteConfig } from "./config.ts";
import { loadDirectory, type DirectorySite } from "./directory.ts";
import { formatCliError, knownSitesSection } from "./error-format.ts";
import { UsageError } from "./errors.ts";

export type SiteSource = "config" | "directory" | "preset";

export interface Site {
  name: string;
  engine: string;
  base_url?: string;
  site_url?: string;
  include_nodes?: string[];
  include_categories?: string[];
  tags?: string[];
  source: SiteSource;
}

export const PRESETS: Site[] = [
  { name: "v2ex", engine: "v2ex", base_url: "https://www.v2ex.com", source: "preset" },
  { name: "linuxdo", engine: "discourse", base_url: "https://linux.do", source: "preset" },
  { name: "hn", engine: "hn", base_url: "https://news.ycombinator.com", source: "preset" },
];

/** Build the merged site universe. Precedence: config > directory > preset. */
export function buildSites(config: ForaConfig, directory: DirectorySite[] = loadDirectory()): Site[] {
  const byName = new Map<string, Site>();

  for (const preset of PRESETS) byName.set(preset.name, { ...preset });

  for (const entry of directory) {
    byName.set(entry.name, {
      name: entry.name,
      engine: entry.engine,
      base_url: entry.url,
      tags: entry.tags,
      source: "directory",
    });
  }

  for (const site of config.sites) {
    byName.set(site.name, configToSite(site));
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function configToSite(site: SiteConfig): Site {
  return {
    name: site.name,
    engine: site.engine,
    base_url: site.base_url,
    site_url: site.site_url,
    include_nodes: site.include_nodes,
    include_categories: site.include_categories,
    source: "config",
  };
}

export function findSite(sites: Site[], name: string): Site | undefined {
  return sites.find((site) => site.name === name);
}

export function requireSite(sites: Site[], name: string): Site {
  const site = findSite(sites, name);
  if (site) return site;
  throw unknownSiteError(name, sites);
}

/** Build the shared, readable error for an unknown site name. */
export function unknownSiteError(name: string, sites: Site[]): UsageError {
  return new UsageError(
    formatCliError(`unknown site "${name}"`, [
      knownSitesSection(sites.map((site) => site.name)),
      { heading: "Add a custom site:", lines: ["fora sites add <url>"] },
    ]),
  );
}

/** Configured default site, or undefined when none is set. */
export function defaultSiteName(config: ForaConfig): string | undefined {
  return config.default_site?.trim() || undefined;
}

/** Sites included in `fora digest` (the follow list). */
export function followSiteNames(config: ForaConfig): string[] {
  if (config.follow && config.follow.length > 0) return config.follow;
  const fallback = defaultSiteName(config);
  if (!fallback) {
    throw new UsageError(
      formatCliError("no followed sites", [
        {
          heading: "Set a follow list in config:",
          lines: ["follow: [v2ex, linuxdo]", "# or: default_site: v2ex"],
        },
        { heading: "Add a custom site:", lines: ["fora sites add <url>"] },
      ]),
    );
  }
  return [fallback];
}

export interface SiteSelector {
  /** "all" → every configured site; "a,b" → an ad-hoc subset. */
  all: boolean;
  names: string[];
}

export function parseSiteSelector(raw: string): SiteSelector {
  const value = raw.trim();
  if (value === "all") return { all: true, names: [] };
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return { all: false, names };
}

/**
 * Sites for `--site all`: user-configured sites when present, otherwise the
 * built-in presets (so a zero-config machine still has something to query).
 */
export function sitesForAll(config: ForaConfig, sites: Site[]): Site[] {
  if (config.sites.length > 0) {
    return config.sites
      .map((site) => findSite(sites, site.name))
      .filter((site): site is Site => site !== undefined);
  }
  return sites.filter((site) => site.source === "preset");
}
