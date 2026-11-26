/**
 * The "last list" cache that makes results addressable (SPEC §6.1 rule 1).
 *
 * It lives in the cache directory because deleting it must never change what
 * any output means — `show 3` simply asks for a fresh list if it is gone.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./config.ts";
import { UsageError } from "./errors.ts";
import type { Topic } from "./model.ts";

export interface LastList {
  site: string;
  command: string;
  created_at: string;
  topics: Topic[];
}

export class ListCache {
  readonly path: string;

  constructor(options: { path?: string; dir?: string } = {}) {
    this.path = options.path ?? join(options.dir ?? cacheDir(), "last-list.json");
  }

  async write(topics: Topic[], meta: { site: string; command: string }): Promise<void> {
    await mkdir(join(this.path, ".."), { recursive: true });
    const payload: LastList = {
      site: meta.site,
      command: meta.command,
      created_at: new Date().toISOString(),
      topics,
    };
    await Bun.write(this.path, `${JSON.stringify(payload, null, 2)}\n`);
  }

  async read(): Promise<LastList | undefined> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return undefined;
    try {
      const parsed = (await file.json()) as LastList;
      if (!parsed || !Array.isArray(parsed.topics)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  /** Resolve a 1-based index against the last list. */
  async resolve(index: number): Promise<Topic> {
    if (!Number.isInteger(index) || index < 1) {
      throw new UsageError(`expected a positive result number, got "${index}"`);
    }
    const list = await this.read();
    if (!list) {
      throw new UsageError(
        "there is no last list yet. Run a list command (e.g. `fora hot`) first, then use `fora show <number>`.",
      );
    }
    const topic = list.topics[index - 1];
    if (!topic) {
      throw new UsageError(
        `result ${index} is out of range; the last list has ${list.topics.length} item(s).`,
      );
    }
    return topic;
  }
}
