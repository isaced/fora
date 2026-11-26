/** `fora sites list|add|remove|search` — the site directory and config. */

import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";
import { envelope } from "../core/envelope.ts";
import { formatCliError } from "../core/error-format.ts";
import { UsageError } from "../core/errors.ts";
import { buildSites, type Site } from "../core/sites.ts";
import { renderSites } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext } from "./context.ts";
import { humanArg, jsonArg, yesArg } from "./common.ts";

const DETECT_ORDER = ["hn", "v2ex", "discourse-rss", "discourse", "flarum", "nodebb"];

function siteRecord(site: Site) {
  return {
    name: site.name,
    engine: site.engine,
    url: site.base_url,
    source: site.source,
    tags: site.tags ?? [],
  };
}

function suggestName(host: string): string {
  const stripped = host.replace(/^www\./, "");
  const parts = stripped.split(".");
  const base = parts.length > 1 ? parts.slice(0, -1).join("-") : stripped;
  return base.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase() || stripped;
}

async function detectEngine(ctx: Awaited<ReturnType<typeof createContext>>, url: string): Promise<string | undefined> {
  for (const engine of DETECT_ORDER) {
    const adapter = ctx.registry.get(engine);
    if (!adapter) continue;
    try {
      if (await adapter.detect({ url })) return engine;
    } catch {
      // try the next engine
    }
  }
  return undefined;
}

async function askConfirmation(message: string, skip: boolean): Promise<boolean> {
  if (skip) return true;
  if (!process.stdin.isTTY) {
    throw new UsageError(
      formatCliError("refusing to change config in non-interactive mode", [
        { heading: "Re-run with confirmation skipped:", lines: ["fora sites add <url> --yes"] },
      ]),
    );
  }
  const answer = await confirm({ message });
  if (isCancel(answer) || answer !== true) return false;
  return true;
}

const listCommand = defineCommand({
  meta: { name: "list", description: "List directory, preset and configured sites" },
  args: { json: jsonArg, human: humanArg },
  async run({ args }) {
    const ctx = await createContext();
    const sites = buildSites(ctx.config);
    if (args.json) {
      writeJson(envelope(sites.map(siteRecord), { count: sites.length }));
      return;
    }
    process.stdout.write(`${renderSites(sites)}\n`);
  },
});

const searchCommand = defineCommand({
  meta: { name: "search", description: "Search sites by name or tag" },
  args: {
    keyword: { type: "positional", required: true, description: "Name or tag keyword" },
    json: jsonArg,
    human: humanArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const keyword = String(args.keyword).toLowerCase();
    const sites = buildSites(ctx.config).filter((site) => {
      const haystack = [site.name, site.engine, site.base_url ?? "", ...(site.tags ?? [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });

    if (args.json) {
      writeJson(envelope(sites.map(siteRecord), { count: sites.length, query: keyword }));
      return;
    }
    if (sites.length === 0) {
      process.stdout.write(
        `${formatCliError(`no sites match "${keyword}"`, [
          { heading: "Browse all sites:", lines: ["fora sites list"] },
        ])}\n`,
      );
      return;
    }
    process.stdout.write(`${renderSites(sites)}\n`);
  },
});

const addCommand = defineCommand({
  meta: { name: "add", description: "Probe a forum URL and add the detected site to config" },
  args: {
    url: { type: "positional", required: true, description: "Forum URL to probe" },
    yes: yesArg,
  },
  async run({ args }) {
    const raw = String(args.url);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UsageError(
        formatCliError(`"${raw}" is not a valid URL`, [
          { heading: "Include the scheme:", lines: ["fora sites add https://example.com"] },
        ]),
      );
    }

    const ctx = await createContext();
    const engine = await detectEngine(ctx, url.origin);
    if (!engine) {
      throw new UsageError(
        formatCliError(`could not detect an engine for ${url.host}`, [
          {
            heading: "Built-in engines:",
            lines: ["hn, v2ex, discourse, discourse-rss, flarum, nodebb, rss"],
          },
          { heading: "Debug with:", lines: ["fora doctor", "fora engines list"] },
        ]),
      );
    }

    const name = suggestName(url.host);
    const confirmed = await askConfirmation(`Add site "${name}" (${engine}) at ${url.origin}?`, Boolean(args.yes));
    if (!confirmed) {
      process.stdout.write("Aborted.\n");
      return;
    }

    await ctx.configStore.addSite({ name, engine, base_url: url.origin });
    process.stdout.write(
      `${formatCliError(`Added "${name}" (${engine}) at ${url.origin}.`, [
        { heading: "Try:", lines: [`fora hot --site ${name}`] },
      ])}\n`,
    );
  },
});

const removeCommand = defineCommand({
  meta: { name: "remove", description: "Remove a site from your config" },
  args: {
    name: { type: "positional", required: true, description: "Site name to remove" },
    yes: yesArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const name = String(args.name);
    const inConfig = ctx.config.sites.some((site) => site.name === name);
    if (!inConfig) {
      const known = ctx.sites.some((site) => site.name === name);
      if (known) {
        process.stdout.write(
          `${formatCliError(`"${name}" is a preset/directory site, not in your config`, [
            { heading: "Nothing to remove; see configured sites:", lines: ["fora sites list"] },
          ])}\n`,
        );
        return;
      }
      throw new UsageError(
        formatCliError(`no configured site named "${name}"`, [
          { heading: "See configured sites:", lines: ["fora sites list"] },
        ]),
      );
    }

    const confirmed = await askConfirmation(`Remove site "${name}" from your config?`, Boolean(args.yes));
    if (!confirmed) {
      process.stdout.write("Aborted.\n");
      return;
    }
    await ctx.configStore.removeSite(name);
    process.stdout.write(`Removed "${name}".\n`);
  },
});

export const sitesCommand = defineCommand({
  meta: { name: "sites", description: "Browse, add and remove sites" },
  subCommands: {
    list: listCommand,
    search: searchCommand,
    add: addCommand,
    remove: removeCommand,
  },
});
