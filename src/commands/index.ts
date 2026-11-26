/** The root citty command and all subcommands. */

import { defineCommand } from "citty";
import { VERSION } from "../core/version.ts";
import { categoriesCommand } from "./categories.ts";
import { createAdapterCommand } from "./create-adapter.ts";
import { digestCommand } from "./digest.ts";
import { doctorCommand } from "./doctor.ts";
import { enginesCommand } from "./engines.ts";
import { hotCommand, latestCommand } from "./lists.ts";
import { searchCommand } from "./search.ts";
import { showCommand } from "./show.ts";
import { sitesCommand } from "./sites.ts";

export const main = defineCommand({
  meta: {
    name: "fora",
    version: VERSION,
    description: "One read-only CLI for many forums, for humans and AI agents",
  },
  args: hotCommand.args,
  default: "hot",
  subCommands: {
    hot: hotCommand,
    latest: latestCommand,
    show: showCommand,
    search: searchCommand,
    categories: categoriesCommand,
    digest: digestCommand,
    sites: sitesCommand,
    engines: enginesCommand,
    doctor: doctorCommand,
    "create-adapter": createAdapterCommand,
  },
});
