/** `fora create-adapter <engine>` — scaffold an external adapter package. */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import { formatCliError } from "../core/error-format.ts";
import { UsageError } from "../core/errors.ts";

function template(engine: string): string {
  return `/**
 * fora external adapter: ${engine}
 *
 * A fora adapter is a plain module whose default export satisfies the Adapter
 * contract. No SDK or build step is required: drop this package into
 * node_modules (or reference it from package.json) and fora will load it.
 */

const ENGINE = ${JSON.stringify(engine)};

const adapter = {
  engine: ENGINE,
  capabilities: {
    hot: false,
    latest: true,
    hotPeriods: false,
    topic: false,
    search: false,
    categories: false,
  },

  async detect(site) {
    // Return true when this URL belongs to your engine.
    return false;
  },

  async hot(site, opts) {
    throw new Error("hot is not supported by " + ENGINE);
  },

  async latest(site, opts) {
    // TODO: fetch the list, map to fora Topics, and honour opts.limit.
    return [];
  },

  async topic(site, ref, page) {
    throw new Error("topic is not supported by " + ENGINE);
  },

  async search(site, query, opts) {
    throw new Error("search is not supported by " + ENGINE);
  },

  async categories(site) {
    throw new Error("categories is not supported by " + ENGINE);
  },
};

export default adapter;
`;
}

export const createAdapterCommand = defineCommand({
  meta: {
    name: "create-adapter",
    description: "Scaffold a new external adapter package",
  },
  args: {
    engine: { type: "positional", required: true, description: "Engine name (e.g. myforum)" },
    dir: { type: "string", description: "Directory to create the package in (default: cwd)", valueHint: "path" },
  },
  async run({ args }) {
    const engine = String(args.engine).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(engine)) {
      throw new UsageError(
        formatCliError("engine name must be lowercase letters, digits and dashes", [
          { heading: "Example:", lines: ["fora create-adapter my-forum"] },
        ]),
      );
    }

    const baseDir = typeof args.dir === "string" && args.dir.trim() ? args.dir.trim() : process.cwd();
    const packageDir = join(baseDir, `fora-adapter-${engine}`);

    if (await Bun.file(join(packageDir, "package.json")).exists()) {
      throw new UsageError(
        formatCliError(`${packageDir} already exists`, [
          {
            heading: "Choose another directory or engine name:",
            lines: ["fora create-adapter <engine> --dir <path>"],
          },
        ]),
      );
    }

    await mkdir(packageDir, { recursive: true });
    await Bun.write(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: `fora-adapter-${engine}`,
          version: "0.1.0",
          description: `A fora adapter for ${engine}`,
          type: "module",
          main: "index.ts",
          keywords: ["fora-adapter"],
          license: "MIT",
        },
        null,
        2,
      )}\n`,
    );
    await Bun.write(join(packageDir, "index.ts"), template(engine));

    process.stdout.write(
      `${formatCliError(`Created ${packageDir}`, [
        {
          heading: "Next:",
          lines: [
            `implement detect/latest in ${join(packageDir, "index.ts")}`,
            "fora engines list   # confirm it loads",
          ],
        },
      ])}\n`,
    );
  },
});
