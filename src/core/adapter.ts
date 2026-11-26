/**
 * The adapter (plugin) contract. An engine adapter translates one forum
 * platform's API into the unified model. Built-in and external adapters
 * satisfy the same interface.
 */

import { UnsupportedError } from "./errors.ts";
import type { Category, Topic, TopicDetail } from "./model.ts";
import type { Site } from "./sites.ts";

export type Period = "day" | "week" | "month" | "all";

export interface ListOpts {
  limit: number;
}

export interface HotOpts extends ListOpts {
  period?: Period;
}

export interface Capabilities {
  hot: boolean;
  latest: boolean;
  /** Whether hot() accepts a --period window. */
  hotPeriods: boolean;
  topic: boolean;
  search: boolean;
  categories: boolean;
}

export interface SiteCandidate {
  base_url?: string;
  url?: string;
  host?: string;
}

export interface Adapter {
  readonly engine: string;
  readonly capabilities: Capabilities;
  /** Fingerprint a URL to decide whether this engine serves it. */
  detect(site: SiteCandidate): Promise<boolean>;
  hot(site: Site, opts: HotOpts): Promise<Topic[]>;
  latest(site: Site, opts: ListOpts): Promise<Topic[]>;
  topicRefFromUrl?(url: URL, site: Site): string | undefined;
  topic(site: Site, ref: string, page: number): Promise<TopicDetail>;
  search(site: Site, query: string, opts: ListOpts): Promise<Topic[]>;
  categories(site: Site): Promise<Category[]>;
}

/** Throw the standard unsupported-operation error from a stub method. */
export function unsupported(engine: string, operation: string): never {
  throw new UnsupportedError(operation, engine);
}

/** Structural check used when loading external adapter modules. */
export function isAdapter(value: unknown): value is Adapter {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.engine !== "string") return false;
  for (const method of ["detect", "hot", "latest", "topic", "search", "categories"]) {
    if (typeof candidate[method] !== "function") return false;
  }
  if (candidate.topicRefFromUrl !== undefined && typeof candidate.topicRefFromUrl !== "function") return false;
  const caps = candidate.capabilities as Record<string, unknown> | undefined;
  if (!caps || typeof caps !== "object") return false;
  return ["hot", "latest", "hotPeriods", "topic", "search", "categories"].every(
    (key) => typeof caps[key] === "boolean",
  );
}
