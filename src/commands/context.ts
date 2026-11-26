/** Per-invocation context: config, merged sites, adapter registry, cache. */

import { ListCache } from "../core/cache.ts";
import { ConfigStore, configDir, type ForaConfig } from "../core/config.ts";
import { ensureEnginePackage, loadExternalAdapters, loadPackageAdapters } from "../core/loader.ts";
import { AdapterRegistry } from "../core/registry.ts";
import { buildSites, type Site } from "../core/sites.ts";

export interface Ctx {
  config: ForaConfig;
  configStore: ConfigStore;
  registry: AdapterRegistry;
  sites: Site[];
  cache: ListCache;
}

export async function createContext(): Promise<Ctx> {
  const configStore = new ConfigStore();
  const config = await configStore.load();
  const registry = AdapterRegistry.withBuiltins();

  await loadExternalAdapters(registry, configDir());
  await loadPackageAdapters(registry);

  for (const site of config.sites) {
    if (!registry.has(site.engine)) await ensureEnginePackage(registry, site.engine);
  }

  return { config, configStore, registry, sites: buildSites(config), cache: new ListCache() };
}
