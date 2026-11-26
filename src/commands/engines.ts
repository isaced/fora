/** `fora engines list` — the machine-readable capability matrix. */

import { defineCommand } from "citty";
import { envelope } from "../core/envelope.ts";
import { renderEngines } from "../output/human.ts";
import { writeJson } from "../output/json.ts";
import { createContext } from "./context.ts";
import { humanArg, jsonArg } from "./common.ts";

export const enginesCommand = defineCommand({
  meta: {
    name: "engines",
    description: "Inspect loaded engine adapters",
  },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List engines and their capabilities" },
      args: { json: jsonArg, human: humanArg },
      async run({ args }) {
        const ctx = await createContext();
        const infos = ctx.registry.list();
        if (args.json) {
          writeJson(envelope(infos, { count: infos.length }));
          return;
        }
        process.stdout.write(`${renderEngines(infos)}\n`);
      },
    }),
  },
});
