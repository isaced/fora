/** `fora search <query…>` — full-text search on engines that support it. */

import { defineCommand } from "citty";
import { requireSite } from "../core/sites.ts";
import { createContext } from "./context.ts";
import {
  assertCapability,
  fieldsArg,
  filterSince,
  finishList,
  intOption,
  jsonArg,
  limitArg,
  parseFieldOption,
  pickSiteName,
  resolveSince,
  sinceArg,
  siteFlagArg,
} from "./common.ts";
import { UsageError } from "../core/errors.ts";

export const searchCommand = defineCommand({
  meta: {
    name: "search",
    description: "Search topics on a site (fails clearly where unsupported)",
  },
  args: {
    query: {
      type: "positional",
      required: true,
      description: "Search query (all positional words are joined)",
    },
    site: siteFlagArg,
    json: jsonArg,
    limit: limitArg,
    since: sinceArg,
    fields: fieldsArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const words = (args._ as string[]).filter((word) => typeof word === "string" && word.trim().length > 0);
    const query = words.join(" ").trim();
    if (!query) throw new UsageError("search needs a query, e.g. fora search rust async");

    const site = requireSite(ctx.sites, pickSiteName(args.site, undefined, ctx.config, ctx.sites));

    const adapter = ctx.registry.require(site.engine);
    assertCapability(adapter, "search", "search");

    const limit = intOption(args.limit, 20, "limit");
    const topics = await adapter.search(site, query, { limit });

    await finishList(ctx, {
      topics: filterSince(topics, resolveSince(args.since)),
      command: "search",
      siteLabel: site.name,
      fields: parseFieldOption(args.fields),
      json: Boolean(args.json),
      meta: { site: site.name, query },
    });
  },
});
