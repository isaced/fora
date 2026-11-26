/**
 * Configuration loading and persistence.
 *
 * File: $XDG_CONFIG_HOME/fora/config.yaml (fallback ~/.config/fora/config.yaml).
 */

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { formatCliError } from "./error-format.ts";
import { ConfigError } from "./errors.ts";

export interface SiteConfig {
  name: string;
  engine: string;
  base_url?: string;
  site_url?: string;
  include_nodes?: string[];
  include_categories?: string[];
}

export interface ForaConfig {
  default_site?: string;
  follow?: string[];
  sites: SiteConfig[];
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "fora");
}

export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return join(base, "fora");
}

export function defaultConfig(): ForaConfig {
  return { sites: [] };
}

export class ConfigStore {
  readonly path: string;

  constructor(options: { path?: string; dir?: string } = {}) {
    this.path = options.path ?? join(options.dir ?? configDir(), "config.yaml");
  }

  async load(): Promise<ForaConfig> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return defaultConfig();

    let raw: string;
    try {
      raw = await file.text();
    } catch (error) {
      throw new ConfigError(
        formatCliError(`could not read ${this.path}`, [
          { heading: "Reason:", lines: [errorText(error)] },
          { heading: "Check file permissions, or regenerate it:", lines: ["fora sites list"] },
        ]),
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (error) {
      throw new ConfigError(
        formatCliError(`invalid YAML in ${this.path}`, [
          { heading: "Reason:", lines: [errorText(error)] },
          { heading: "Fix the file above, then verify with:", lines: ["fora doctor"] },
        ]),
      );
    }

    if (parsed === null || parsed === undefined) return defaultConfig();
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigError(
        formatCliError(`${this.path} must contain a YAML mapping`, [
          { heading: "Example:", lines: ["default_site: v2ex", "sites: []"] },
        ]),
      );
    }

    const obj = parsed as Record<string, unknown>;
    const sites = Array.isArray(obj.sites) ? obj.sites : [];
    const normalisedSites: SiteConfig[] = [];
    for (const entry of sites) {
      if (!entry || typeof entry !== "object") continue;
      const site = normaliseSite(entry as Record<string, unknown>);
      if (site) normalisedSites.push(site);
    }

    const config: ForaConfig = { sites: normalisedSites };
    if (typeof obj.default_site === "string") config.default_site = obj.default_site;
    if (Array.isArray(obj.follow)) {
      config.follow = obj.follow.filter((name): name is string => typeof name === "string");
    }
    return config;
  }

  async save(config: ForaConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const header = "# fora configuration\n";
    const body = stringifyYaml(config, { lineWidth: 0 });
    await Bun.write(this.path, header + body);
  }

  async addSite(site: SiteConfig): Promise<ForaConfig> {
    const config = await this.load();
    const without = config.sites.filter((existing) => existing.name !== site.name);
    without.push(site);
    config.sites = without;
    await this.save(config);
    return config;
  }

  async removeSite(name: string): Promise<{ removed: boolean; config: ForaConfig }> {
    const config = await this.load();
    const before = config.sites.length;
    config.sites = config.sites.filter((site) => site.name !== name);
    const removed = config.sites.length !== before;
    if (removed) await this.save(config);
    return { removed, config };
  }
}

function normaliseSite(entry: Record<string, unknown>): SiteConfig | undefined {
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const engine = typeof entry.engine === "string" ? entry.engine.trim() : "";
  if (!name || !engine) return undefined;

  const site: SiteConfig = { name, engine };
  if (typeof entry.base_url === "string") site.base_url = entry.base_url;
  if (typeof entry.site_url === "string") site.site_url = entry.site_url;
  if (Array.isArray(entry.include_nodes)) {
    site.include_nodes = entry.include_nodes.filter((v): v is string => typeof v === "string");
  }
  if (Array.isArray(entry.include_categories)) {
    site.include_categories = entry.include_categories.filter((v): v is string => typeof v === "string");
  }
  return site;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
