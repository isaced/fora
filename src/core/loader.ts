/**
 * External adapter loader (SPEC §4 / milestone M2).
 *
 * Adapters are plain modules with a default export satisfying `Adapter`.
 * They are discovered from two places:
 *   (a) single files in <config>/adapters/*.ts|js|mjs
 *   (b) installed npm packages named fora-adapter-<engine>
 *
 * Failures are collected, not thrown, so one broken external adapter never
 * takes down the whole CLI.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isAdapter, type Adapter } from "./adapter.ts";
import type { AdapterRegistry } from "./registry.ts";

export interface LoadReport {
  loaded: string[];
  failed: { source: string; message: string }[];
}

const SCRIPT_EXTENSIONS = [".ts", ".js", ".mjs", ".mts"];

function isScript(name: string): boolean {
  return SCRIPT_EXTENSIONS.some((extension) => name.endsWith(extension));
}

async function importAdapterModule(specifier: string): Promise<Adapter> {
  const module = (await import(specifier)) as { default?: unknown; adapter?: unknown };
  const candidate = module.default ?? module.adapter;
  if (!isAdapter(candidate)) {
    throw new Error("module does not default-export an Adapter");
  }
  return candidate;
}

/** Load every adapter file in <config>/adapters. */
export async function loadExternalAdapters(registry: AdapterRegistry, configDir: string): Promise<LoadReport> {
  const report: LoadReport = { loaded: [], failed: [] };
  const adaptersDir = join(configDir, "adapters");

  let files: string[];
  try {
    files = await readdir(adaptersDir);
  } catch {
    return report;
  }

  for (const file of files.sort()) {
    if (!isScript(file) || file.startsWith(".")) continue;
    const fullPath = join(adaptersDir, file);
    try {
      const adapter = await importAdapterModule(pathToFileURL(fullPath).href);
      registry.register(adapter, "external");
      report.loaded.push(adapter.engine);
    } catch (error) {
      report.failed.push({ source: fullPath, message: errorText(error) });
    }
  }

  return report;
}

/**
 * Load fora-adapter-* packages that are direct dependencies of the current
 * project. Used so `fora engines list` can show installed adapters.
 */
export async function loadPackageAdapters(registry: AdapterRegistry, cwd = process.cwd()): Promise<LoadReport> {
  const report: LoadReport = { loaded: [], failed: [] };
  const packageJsonPath = join(cwd, "package.json");

  let dependencies: string[] = [];
  const file = Bun.file(packageJsonPath);
  if (await file.exists()) {
    try {
      const pkg = (await file.json()) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      dependencies = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ].filter((name) => name.startsWith("fora-adapter-"));
    } catch {
      // Ignore malformed project manifests.
    }
  }

  for (const name of dependencies) {
    try {
      const adapter = await importAdapterModule(name);
      if (!registry.has(adapter.engine)) {
        registry.register(adapter, "external");
        report.loaded.push(adapter.engine);
      }
    } catch (error) {
      report.failed.push({ source: name, message: errorText(error) });
    }
  }

  return report;
}

/** On-demand load of fora-adapter-<engine> when config references it. */
export async function ensureEnginePackage(registry: AdapterRegistry, engine: string): Promise<boolean> {
  if (registry.has(engine)) return true;
  const packageName = `fora-adapter-${engine}`;
  try {
    const adapter = await importAdapterModule(packageName);
    registry.register(adapter, "external");
    return true;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
