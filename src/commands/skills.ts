/** Bundled, version-matched usage guide for agents. */

import { defineCommand, type CommandDef } from "citty";
import { COMMAND_GUIDES } from "./help.ts";
import { jsonArg } from "./common.ts";

const SKILL_NAMES = ["core"] as const;
type SkillName = (typeof SKILL_NAMES)[number];

function coreSkill(): string {
  const sections: string[] = [
    "# fora core skill",
    "",
    "fora is an agent-first, read-only CLI for many forums. Prefer explicit `--site`",
    "and `--json`. Every command prints a stable `fora/v1` envelope with JSON,",
    "actionable errors on stderr, and meaningful exit codes.",
    "",
    "## Start here",
    "",
    "- `fora --help` — command list",
    "- `fora help <command>` — full help with Examples",
    "- `fora schema` — machine-readable commands, flags and fields",
    "- `fora help <command> --json` — JSON schema for one command",
    "- `fora skills get core` — this document",
    "",
    "## Contract",
    "",
    "- JSON envelope: `{schema: \"fora/v1\", data, meta}`; `meta.approx_tokens` is a",
    "  pre-read cost estimate.",
    "- Exit codes: 0 ok, 1 generic, 2 usage, 3 unsupported, 4 rate limited/blocked.",
    "- Site resolution order: `--site`, positional site, `FORA_SITE`, `default_site`.",
    "- `--site all` and `--site a,b` aggregate sites; per-site failures are reported",
    "  without discarding successful results.",
    "- List results are cached: `fora show 3` opens item 3 of the last list.",
    "- `--fields a,b,c` projects fields; excerpts are the default; truncation is",
    "  always declared rather than silent.",
    "",
    "## Degradation",
    "",
    "Public read requests that get HTTP 403 retry once through a reusable browser",
    "session. Discourse sites can then fall back to RSS. JSON results include",
    "`meta.degraded_sites` (or `degraded` per digest group) with `from`, `to`,",
    "`reason` and `limitations`. `fora doctor --json` reports the active route.",
    "",
    "## Command map",
    "",
  ];

  for (const path of Object.keys(COMMAND_GUIDES)) {
    if (!path) continue;
    const guide = COMMAND_GUIDES[path]!;
    sections.push(`- \`fora ${path}\` — ${guide.about[0]}`);
  }

  sections.push("", "## Examples", "");
  const root = COMMAND_GUIDES[""]!;
  for (const example of root.examples) sections.push(`- \`${example}\``);
  return `${sections.join("\n")}\n`;
}

function skill(name: SkillName): string {
  return name === "core" ? coreSkill() : "";
}

function listCommand(): CommandDef<any> {
  return defineCommand({
    meta: { name: "list", description: "List bundled agent skills" },
    args: { json: jsonArg },
    async run({ args }) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify(SKILL_NAMES)}\n`);
        return;
      }
      process.stdout.write(`${SKILL_NAMES.map((name) => `- ${name}`).join("\n")}\n`);
    },
  });
}

function getCommand(): CommandDef<any> {
  return defineCommand({
    meta: { name: "get", description: "Print a bundled agent skill" },
    args: {
      name: { type: "positional", required: true, description: "Skill name, e.g. core" },
      json: jsonArg,
    },
    async run({ args }) {
      const name = String(args.name) as SkillName;
      if (!SKILL_NAMES.includes(name)) {
        process.stderr.write(`fora: unknown skill "${name}". Available: ${SKILL_NAMES.join(", ")}\n`);
        process.exitCode = 2;
        return;
      }
      const content = skill(name).trimEnd();
      if (args.json) {
        process.stdout.write(`${JSON.stringify({ name, content }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${content}\n`);
    },
  });
}

export function buildSkillsCommand(): CommandDef<any> {
  return defineCommand({
    meta: { name: "skills", description: "Read fora's bundled agent skills" },
    subCommands: {
      list: listCommand(),
      get: getCommand(),
    },
  });
}
