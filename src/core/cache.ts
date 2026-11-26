/**
 * The "last list" cache that makes results addressable (SPEC §6.1 rule 1).
 *
 * It lives in the cache directory because deleting it must never change what
 * any output means — `show 3` simply asks for a fresh list if it is gone.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheDir } from "./config.ts";
import { formatCliError } from "./error-format.ts";
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
      throw new UsageError(
        formatCliError(`expected a positive result number, got "${index}"`, [
          { heading: "Example:", lines: ["fora show 3"] },
        ]),
      );
    }
    const list = await this.read();
    if (!list) {
      throw new UsageError(
        formatCliError("there is no last list yet", [
          {
            heading: "Run a list first, then pick a result:",
            lines: ["fora hot --site <name>", "fora show 3"],
          },
        ]),
      );
    }
    const topic = list.topics[index - 1];
    if (!topic) {
      throw new UsageError(
        formatCliError(`result ${index} is out of range (last list has ${list.topics.length} item(s))`, [
          {
            heading: "Refresh the list or pick a smaller number:",
            lines: ["fora hot --site <name>", `fora show <1-${list.topics.length}>`],
          },
        ]),
      );
    }
    return topic;
  }
}
