/** Machine-readable command/field contract. */

import { defineCommand, type CommandDef } from "citty";
import { TOPIC_FIELDS } from "../core/fields.ts";

type AnyCommand = CommandDef<any>;

export interface ArgSchema {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  valueHint?: string;
  alias?: string | string[];
  options?: string[];
  default?: unknown;
}

export interface CommandSchema {
  name: string;
  description?: string;
  args: ArgSchema[];
  subcommands?: CommandSchema[];
}

export interface ForaSchema {
  schema: "fora/v1-schema";
  version: string;
  commands: CommandSchema[];
  topic_fields: readonly string[];
  exit_codes: Record<string, string>;
  envelope: Record<string, unknown>;
  site_resolution: string[];
  output_default: Record<string, unknown>;
  degradation: Record<string, unknown>;
}

export async function resolveCommandArgs(cmd: AnyCommand): Promise<Record<string, any>> {
  const args = typeof cmd.args === "function" ? await cmd.args() : cmd.args;
  return (args ?? {}) as Record<string, any>;
}

async function resolveSubCommands(cmd: AnyCommand): Promise<Record<string, AnyCommand>> {
  const subs = typeof cmd.subCommands === "function" ? await cmd.subCommands() : cmd.subCommands;
  return (subs ?? {}) as Record<string, AnyCommand>;
}

export async function buildCommandSchema(cmd: AnyCommand, name: string): Promise<CommandSchema> {
  const meta = typeof cmd.meta === "function" ? await cmd.meta() : await cmd.meta;
  const args = Object.entries(await resolveCommandArgs(cmd)).map(([argName, raw]) => {
    const arg = raw ?? {};
    return {
      name: argName,
      type: String(arg.type ?? "string"),
      required: arg.required === true || (arg.type === "positional" && arg.required !== false && arg.default === undefined),
      ...(arg.description ? { description: String(arg.description) } : {}),
      ...(arg.valueHint ? { valueHint: String(arg.valueHint) } : {}),
      ...(arg.alias ? { alias: arg.alias } : {}),
      ...(arg.options ? { options: arg.options.map(String) } : {}),
      ...(arg.default !== undefined ? { default: arg.default } : {}),
    };
  });

  const subs = await resolveSubCommands(cmd);
  const names = Object.keys(subs);
  const subcommands = names.length > 0
    ? await Promise.all(names.map((subName) => buildCommandSchema(subs[subName]!, subName)))
    : undefined;

  return {
    name,
    ...(meta?.description ? { description: meta.description } : {}),
    args,
    ...(subcommands ? { subcommands } : {}),
  };
}

export async function buildForaSchema(root: AnyCommand, version: string): Promise<ForaSchema> {
  const subs = await resolveSubCommands(root);
  const commands = await Promise.all(
    Object.keys(subs).map((name) => buildCommandSchema(subs[name]!, name)),
  );

  return {
    schema: "fora/v1-schema",
    version,
    commands,
    topic_fields: TOPIC_FIELDS,
    exit_codes: {
      "0": "ok",
      "1": "generic error",
      "2": "usage error",
      "3": "unsupported operation",
      "4": "rate limited or blocked",
    },
    envelope: {
      schema: "fora/v1",
      data: "command payload",
      meta: "approx_tokens plus command-specific fields such as site, count and degraded_sites",
      site_results: {
        commands: ["hot (multi-site)", "latest (multi-site)", "digest"],
        succeeded_sites: "site names, including successful empty results",
        failed_sites: "array of {site, code, message}",
        all_failed: "nonzero exit; JSON error with failed_sites on stderr",
      },
    },
    site_resolution: ["--site", "positional site", "FORA_SITE", "default_site"],
    output_default: {
      tty: "human",
      piped: "json",
      overrides: ["--json", "--human", "FORA_JSON=1|0"],
      note: "Data commands with --json support default to JSON when stdout is not a TTY.",
    },
    degradation: {
      field: "meta.degraded_sites",
      values: ["http", "browser", "rss"],
      note: "Degraded calls declare lost capabilities; all fora requests are public reads.",
    },
  };
}

/** Select a subcommand tree by space-separated path. */
export function selectCommandSchema(schema: ForaSchema, path: string): CommandSchema | undefined {
  if (!path) return undefined;
  let current: CommandSchema | undefined;
  for (const part of path.split(" ")) {
    current = (current?.subcommands ?? schema.commands).find((command) => command.name === part);
    if (!current) return undefined;
  }
  return current;
}

export function buildSchemaCommand(getRoot: () => AnyCommand): CommandDef<any> {
  return defineCommand({
    meta: { name: "schema", description: "Print the machine-readable fora contract" },
    args: {
      command: { type: "positional", required: false, description: "Optional command path, e.g. sites add" },
      json: { type: "boolean", description: "Alias for the default JSON output", default: true },
    },
    async run({ args }) {
      const root = getRoot();
      const meta = typeof root.meta === "function" ? await root.meta() : await root.meta;
      const schema = await buildForaSchema(root, meta?.version ?? "0.0.0");
      const selected = typeof args.command === "string" && args.command
        ? selectCommandSchema(schema, args.command)
        : undefined;
      process.stdout.write(`${JSON.stringify(selected ?? schema, null, 2)}\n`);
    },
  });
}
