/** The root citty command and all subcommands. */

import { defineCommand, type CommandDef } from "citty";
import { VERSION } from "../core/version.ts";
import { categoriesCommand } from "./categories.ts";
import { createAdapterCommand } from "./create-adapter.ts";
import { digestCommand } from "./digest.ts";
import { doctorCommand } from "./doctor.ts";
import { enginesCommand } from "./engines.ts";
import { hotCommand, latestCommand } from "./lists.ts";
import { searchCommand } from "./search.ts";
import { showCommand } from "./show.ts";
import { buildSchemaCommand } from "./schema.ts";
import { buildSkillsCommand } from "./skills.ts";
import { sitesCommand } from "./sites.ts";

export const main: CommandDef<any> = defineCommand({
  meta: {
    name: "fora",
    version: VERSION,
    description: "One read-only CLI for many forums, for humans and AI agents",
  },
  // Flags belong to subcommands; the root only dispatches.
  args: {},
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
    schema: buildSchemaCommand(() => main),
    skills: buildSkillsCommand(),
  },
});
