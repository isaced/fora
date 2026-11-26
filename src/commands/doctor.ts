/** `fora doctor` — pre-flight reachability check for sites and engines. */

import { defineCommand } from "citty";
import { mapLimit } from "../core/async.ts";
import { envelope } from "../core/envelope.ts";
import { errorMessage } from "../core/error-format.ts";
import { findSite, PRESETS, type Site } from "../core/sites.ts";
import { renderDoctor, type DoctorSiteReport } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext } from "./context.ts";
import { humanArg, jsonArg } from "./common.ts";

const PROBE_CONCURRENCY = 4;

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Check site reachability and list loaded engines",
  },
  args: {
    all: {
      type: "boolean",
      description: "Probe every directory site, not just configured ones",
      default: false,
    },
    json: jsonArg,
    human: humanArg,
  },
  async run({ args }) {
    const ctx = await createContext();
    const targets = args.all ? ctx.sites : defaultTargets(ctx);

    const sites: DoctorSiteReport[] = await mapLimit(targets, PROBE_CONCURRENCY, async (site) => {
      const adapter = ctx.registry.get(site.engine);
      if (!adapter) {
        return { name: site.name, engine: site.engine, route: undefined, reachable: false, error: "engine not loaded" };
      }
      if (site.engine === "rss") {
        return { name: site.name, engine: site.engine, route: "rss", reachable: "unknown", error: "RSS reachability not probed" };
      }
      try {
        const reachable = await adapter.detect({ base_url: site.base_url, url: site.base_url });
        const degraded = ctx.degradation.get(site.name);
        const route = degraded?.to === "browser" ? "browser" : degraded ? "rss" : site.engine === "rss" ? "rss" : "http";
        return { name: site.name, engine: site.engine, route, reachable };
      } catch (error) {
        return { name: site.name, engine: site.engine, route: undefined, reachable: false, error: errorMessage(error) };
      }
    });

    const report = { sites, engines: ctx.registry.engines() };
    if (args.json) {
      writeJson(envelope(report, { count: sites.length }));
      return;
    }
    process.stdout.write(`${renderDoctor(report)}\n`);
  },
});

function defaultTargets(ctx: Awaited<ReturnType<typeof createContext>>): Site[] {
  const configured = ctx.config.sites
    .map((site) => findSite(ctx.sites, site.name))
    .filter((site): site is Site => site !== undefined);
  if (configured.length > 0) return configured;
  return PRESETS.map((preset) => findSite(ctx.sites, preset.name) ?? preset);
}
