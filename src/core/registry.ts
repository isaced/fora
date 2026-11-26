/**
 * Central adapter registry. Built-in adapters are registered from one list
 * (SPEC §4); external adapters are added by the loader.
 */

import { isAdapter, type Adapter, type Capabilities } from "./adapter.ts";
import { ConfigError } from "./errors.ts";
import { builtinAdapters } from "./builtin.ts";

export type AdapterSource = "builtin" | "external";

export interface AdapterInfo {
  engine: string;
  capabilities: Capabilities;
  source: AdapterSource;
}

interface RegistryEntry {
  adapter: Adapter;
  source: AdapterSource;
}

export class AdapterRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  static withBuiltins(): AdapterRegistry {
    const registry = new AdapterRegistry();
    for (const adapter of builtinAdapters) registry.register(adapter, "builtin");
    return registry;
  }

  register(adapter: Adapter, source: AdapterSource = "external"): void {
    if (!isAdapter(adapter)) {
      throw new ConfigError(`adapter "${(adapter as { engine?: string })?.engine ?? "?"}" does not implement the Adapter contract`);
    }
    this.entries.set(adapter.engine, { adapter, source });
  }

  get(engine: string): Adapter | undefined {
    return this.entries.get(engine)?.adapter;
  }

  require(engine: string): Adapter {
    const entry = this.entries.get(engine);
    if (!entry) {
      const known = [...this.entries.keys()].sort().join(", ");
      throw new ConfigError(`unknown engine "${engine}". Loaded engines: ${known}`);
    }
    return entry.adapter;
  }

  has(engine: string): boolean {
    return this.entries.has(engine);
  }

  engines(): string[] {
    return [...this.entries.keys()].sort();
  }

  list(): AdapterInfo[] {
    return [...this.entries.values()]
      .map(({ adapter, source }) => ({ engine: adapter.engine, capabilities: adapter.capabilities, source }))
      .sort((a, b) => a.engine.localeCompare(b.engine));
  }
}
