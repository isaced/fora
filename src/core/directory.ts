/**
 * The bundled official site directory (sites.yaml at the package root).
 *
 * The file is inlined at build time so `bun build --compile` binaries still
 * carry the directory. Every entry is data only — adding a forum is a
 * one-line change, no code.
 */

import { parse as parseYaml } from "yaml";
import sitesYamlText from "../../sites.yaml" with { type: "text" };

export interface DirectorySite {
  name: string;
  url: string;
  engine: string;
  tags: string[];
}

let cached: DirectorySite[] | undefined;

export function loadDirectory(): DirectorySite[] {
  if (cached) return cached;

  let parsed: unknown;
  try {
    parsed = parseYaml(sitesYamlText);
  } catch {
    cached = [];
    return cached;
  }

  if (!Array.isArray(parsed)) {
    cached = [];
    return cached;
  }

  const entries: DirectorySite[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    const engine = typeof entry.engine === "string" ? entry.engine.trim() : "";
    if (!name || !url || !engine || seen.has(name)) continue;
    seen.add(name);
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    entries.push({ name, url, engine, tags });
  }

  cached = entries;
  return cached;
}
