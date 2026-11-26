/** Per-invocation context: config, merged sites, adapter registry, cache. */

import { ListCache } from "../core/cache.ts";
import { ConfigStore, configDir, type ForaConfig } from "../core/config.ts";
import { ensureEnginePackage, loadExternalAdapters, loadPackageAdapters } from "../core/loader.ts";
import { AdapterRegistry } from "../core/registry.ts";
import type { DegradationStore } from "../core/degradation.ts";
import { createDiscourseAutoAdapter } from "../adapters/discourse-auto/index.ts";
import { buildSites, type Site } from "../core/sites.ts";

export interface Ctx {
  config: ForaConfig;
  configStore: ConfigStore;
  registry: AdapterRegistry;
  sites: Site[];
  cache: ListCache;
  degradation: DegradationStore;
}

export async function createContext(): Promise<Ctx> {
  const configStore = new ConfigStore();
  const config = await configStore.load();
  const registry = AdapterRegistry.withBuiltins();
  const degradation: DegradationStore = new Map();
  const json = registry.require("discourse");
  const rss = registry.require("discourse-rss");
  registry.register(createDiscourseAutoAdapter(json, rss, degradation), "builtin");

  await loadExternalAdapters(registry, configDir());
  await loadPackageAdapters(registry);

  for (const site of config.sites) {
    if (!registry.has(site.engine)) await ensureEnginePackage(registry, site.engine);
  }

  return {
    config,
    configStore,
    registry,
    sites: buildSites(config),
    cache: new ListCache(),
    degradation,
  };
}
