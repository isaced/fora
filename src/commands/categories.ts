/** `fora categories [site]` — native sections for the selected engine. */

import { defineCommand } from "citty";
import { envelope } from "../core/envelope.ts";
import { requireSite } from "../core/sites.ts";
import { renderCategories } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext } from "./context.ts";
import { assertCapability, jsonArg, pickSiteName, siteFlagArg } from "./common.ts";

export const categoriesCommand = defineCommand({
  meta: {
    name: "categories",
    description: "List a site's categories, nodes or tags",
  },
  args: {
    target: {
      type: "positional",
      required: false,
      description: "Site name (same as --site)",
    },
    site: siteFlagArg,
    json: jsonArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const site = requireSite(ctx.sites, pickSiteName(args.site, args.target, ctx.config));
    const adapter = ctx.registry.require(site.engine);
    assertCapability(adapter, "categories", "categories");

    const categories = await adapter.categories(site);

    if (args.json) {
      writeJson(envelope(categories, { site: site.name, count: categories.length }));
      return;
    }
    process.stdout.write(`${renderCategories(site.name, categories)}\n`);
  },
});
