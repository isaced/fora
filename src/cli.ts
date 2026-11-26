#!/usr/bin/env bun
/**
 * fora CLI entry point.
 *
 * We drive citty's runCommand directly (rather than runMain) so that fora's
 * exit codes and --json error shape win over citty's defaults:
 *   0 ok · 1 generic · 2 usage · 3 unsupported · 4 rate-limited.
 */

import { renderUsage, runCommand, type CommandDef } from "citty";
import { renderGuide } from "./commands/help.ts";
import { main } from "./commands/index.ts";
import { buildCommandSchema, buildForaSchema, resolveCommandArgs, selectCommandSchema, type CommandSchema } from "./commands/schema.ts";
import { closeBrowserFetches } from "./core/browser-fetch.ts";
import { closeProxyBridge } from "./core/proxy-fetch.ts";
import { formatCliError, type ErrorSection } from "./core/error-format.ts";
import { resolveOutputMode } from "./core/output-mode.ts";
import { ForaError, SiteBatchError, UsageError, exitCodeOf, messageOf } from "./core/errors.ts";
import { VERSION } from "./core/version.ts";
import { writeErrorJson } from "./output/json.ts";

type AnyCommand = CommandDef<any>;

function collectValueFlags(command: CommandSchema, flags = new Set<string>()): Set<string> {
  for (const arg of command.args) {
    if (arg.type === "boolean" || arg.type === "positional") continue;
    const aliases = typeof arg.alias === "string" ? [arg.alias] : arg.alias ?? [];
    for (const name of [arg.name, ...aliases]) {
      flags.add(name);
      flags.add(name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()));
    }
  }
  for (const child of command.subcommands ?? []) collectValueFlags(child, flags);
  return flags;
}

const valueFlags = collectValueFlags(await buildCommandSchema(main, "fora"));

const FLAG_EXAMPLES: Record<string, string> = {
  site: "fora hot --site v2ex",
  limit: "fora hot --limit 20",
  n: "fora hot -n 20",
  since: "fora hot --since 24h",
  fields: "fora hot --fields title,url",
  period: "fora hot --period week",
  page: "fora show linuxdo:12345 --page 2",
  replies: "fora show linuxdo:12345 --replies 3",
  budget: "fora digest --budget 1000",
  "per-site": "fora digest --per-site 5",
  perSite: "fora digest --per-site 5",
  "top-replies": "fora digest --top-replies 3",
  topReplies: "fora digest --top-replies 3",
  dir: "fora create-adapter my-forum --dir ./packages",
};

function flagName(token: string): string {
  return token.replace(/^-+/, "").split("=")[0]!;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function inspectCommand(rawArgs: string[]) {
  let cmd: AnyCommand = main;
  let parent: AnyCommand | undefined;
  const path: string[] = [];
  let expectValue = false;

  for (const token of rawArgs) {
    if (expectValue) {
      expectValue = false;
      continue;
    }
    if (token.startsWith("-")) {
      expectValue = !token.includes("=") && valueFlags.has(flagName(token));
      continue;
    }
    const subCommands = cmd.subCommands as Record<string, AnyCommand> | undefined;
    if (subCommands && Object.hasOwn(subCommands, token)) {
      parent = cmd;
      cmd = subCommands[token]!;
      path.push(token);
      continue;
    }
    const guidePath = path.join(" ");
    const unknown = subCommands ? { token, parentPath: guidePath, names: Object.keys(subCommands) } : undefined;
    return { cmd, parent, guidePath, unknown, hasPositional: true };
  }
  return { cmd, parent, guidePath: path.join(" "), unknown: undefined, hasPositional: false };
}

function commandPath(rawArgs: string[]): string {
  return inspectCommand(rawArgs).guidePath || "<command>";
}

function missingFlagValue(rawArgs: string[]): string | undefined {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index]!;
    if (token === "--") break;
    if (!token.startsWith("-")) continue;
    const name = flagName(token);
    if (!valueFlags.has(name)) continue;
    const equals = token.indexOf("=");
    if (equals !== -1) {
      if (equals === token.length - 1) return name;
      continue;
    }
    const next = rawArgs[index + 1];
    if (next === undefined || (next.startsWith("-") && !/^-\d/.test(next))) return name;
    index += 1;
  }
  return undefined;
}

function displayFlag(name: string): string {
  if (name === "n") return "-n";
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function missingFlagError(name: string): UsageError {
  return new UsageError(formatCliError(`${displayFlag(name)} requires a value`, [
    { heading: "Example:", lines: [FLAG_EXAMPLES[name] ?? `fora <command> ${displayFlag(name)} <value>`] },
  ]));
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

function didYouMean(token: string, names = Object.keys((main.subCommands ?? {}) as Record<string, AnyCommand>)): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const name of names) {
    const distance = levenshtein(token, name);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best && bestDistance <= 3 ? best : undefined;
}

interface UnknownCommand {
  token: string;
  parentPath: string;
  names: string[];
}

function unknownCommandMessage(info: UnknownCommand): string {
  const sections: ErrorSection[] = [
    { heading: "List commands:", lines: [info.parentPath ? `fora ${info.parentPath} --help` : "fora --help"] },
  ];
  const suggestion = didYouMean(info.token, info.names);
  if (suggestion) {
    const command = [info.parentPath, suggestion].filter(Boolean).join(" ");
    sections.unshift({ heading: "Did you mean:", lines: [`fora ${command}`] });
  }
  return formatCliError(`unknown command "${info.token}"`, sections);
}

function isCittyError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && (error.name === "CLIError" || /^E[A-Z_]*$/.test((error as { code?: string }).code ?? ""));
}

/** Add a short, code-specific next step to errors that do not have one yet. */
function foraErrorMessage(error: ForaError, rawArgs: string[]): string {
  if (error.message.includes("\n")) return error.message;

  const sections: ErrorSection[] = [];
  switch (error.code) {
    case "usage":
      sections.push({ heading: "See usage:", lines: [`fora ${commandPath(rawArgs)} --help`] });
      break;
    case "unsupported":
      sections.push({ heading: "Check engine capabilities:", lines: ["fora engines list"] });
      break;
    case "config":
      sections.push({ heading: "Inspect config:", lines: ["fora sites list", "fora doctor"] });
      break;
    case "network":
    case "upstream":
    case "rate_limited":
      sections.push({ heading: "Check reachability:", lines: ["fora doctor"] });
      break;
    case "not_found":
      sections.push({ heading: "Pick a topic from a fresh list:", lines: ["fora hot --site <name>"] });
      break;
    case "generic":
      break;
  }
  return sections.length > 0 ? formatCliError(error.message, sections) : error.message;
}

function handleError(error: unknown, rawArgs: string[]): void {
  const json = rawArgs.includes("--json");

  if (error instanceof ForaError) {
    const message = foraErrorMessage(error, rawArgs);
    if (json) writeErrorJson(error.code, message, error instanceof SiteBatchError ? { failed_sites: error.failures } : undefined);
    else process.stderr.write(`fora: ${message}\n`);
    process.exitCode = error.exitCode;
    return;
  }

  if (isCittyError(error)) {
    let message = stripAnsi(messageOf(error));
    const sections: ErrorSection[] = [];
    const { unknown: unknownInfo, guidePath } = inspectCommand(rawArgs);
    if (unknownInfo) {
      message = unknownCommandMessage(unknownInfo);
    } else {
      const unknown = message.match(/Unknown command (\S+)/);
      if (unknown) {
        const suggestion = didYouMean(unknown[1]!);
        if (suggestion) {
          const command = [guidePath, suggestion].filter(Boolean).join(" ");
          sections.push({ heading: "Did you mean:", lines: [`fora ${command}`] });
        }
      }
    }
    if (/Missing required/.test(message)) {
      const command = commandPath(rawArgs);
      sections.push({ heading: "See usage:", lines: [`fora ${command} --help`] });
    }
    if (sections.length > 0) message = formatCliError(message, sections);
    if (json) writeErrorJson("usage", message);
    else process.stderr.write(`fora: ${message}\n`);
    process.exitCode = 2;
    return;
  }

  if (json) writeErrorJson("generic", messageOf(error));
  else process.stderr.write(`fora: ${messageOf(error)}\n`);
  process.exitCode = Math.max(1, exitCodeOf(error));
}

/** citty only knows one parent level; rebuild the full `fora …` prefix. */
function usageParent(parent: AnyCommand | undefined, guidePath: string): AnyCommand | undefined {
  if (!parent || !guidePath.includes(" ")) return parent;
  const ancestor = guidePath.slice(0, guidePath.lastIndexOf(" "));
  return { meta: { name: `fora ${ancestor}` } } as AnyCommand;
}

async function printSchema(guidePath: string): Promise<void> {
  const meta = typeof main.meta === "function" ? await main.meta() : await main.meta;
  const schema = await buildForaSchema(main, meta?.version ?? VERSION);
  const selected = selectCommandSchema(schema, guidePath);
  process.stdout.write(`${JSON.stringify(selected ?? schema, null, 2)}\n`);
}

async function printUsage(cmd: AnyCommand, parent: AnyCommand | undefined, guidePath: string): Promise<void> {
  let text = await renderUsage(cmd, usageParent(parent, guidePath));
  if (!process.stdout.isTTY || process.env.NO_COLOR) text = stripAnsi(text);
  const guide = renderGuide(guidePath);
  process.stdout.write(`${text.trimEnd()}${guide ? `\n\n${guide}` : ""}\n`);
}

/** Piped output defaults to JSON for data commands; TTY stays human-readable. */
async function withDefaultJson(rawArgs: string[], cmd: AnyCommand): Promise<string[] | undefined> {
  const args = await resolveCommandArgs(cmd);
  if (!("json" in args)) return rawArgs;

  const mode = resolveOutputMode({ isTTY: Boolean(process.stdout.isTTY), args: rawArgs, env: process.env });
  if (mode === "conflict") {
    handleError(
      new UsageError(
        formatCliError("--json and --human cannot be combined", [
          { heading: "Pick one:", lines: ["--json   # machine-readable", "--human  # table output"] },
        ]),
      ),
      rawArgs,
    );
    return undefined;
  }
  return mode === "json" && !rawArgs.includes("--json") ? [...rawArgs, "--json"] : rawArgs;
}

async function mainEntry(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const separator = rawArgs.indexOf("--");
  const flags = separator === -1 ? rawArgs : rawArgs.slice(0, separator);
  const help = rawArgs[0] === "help";
  const { cmd, parent, guidePath, unknown, hasPositional } = inspectCommand(help ? flags.slice(1) : flags);

  if (help || flags.includes("--help") || flags.includes("-h")) {
    if (unknown) {
      handleError(new UsageError(unknownCommandMessage(unknown)), flags);
      return;
    }
    if (flags.includes("--json")) {
      await printSchema(guidePath);
      return;
    }
    await printUsage(cmd, parent, guidePath);
    return;
  }
  if (rawArgs.length === 1 && (rawArgs[0] === "--version" || rawArgs[0] === "-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const effectiveFlags = await withDefaultJson(flags, cmd);
  if (!effectiveFlags) return;
  try {
    const missingFlag = missingFlagValue(flags);
    if (missingFlag) throw missingFlagError(missingFlag);
    if (!hasPositional && cmd.subCommands && separator === -1) {
      await printUsage(cmd, parent, guidePath);
      return;
    }
    const effectiveArgs = separator === -1 ? effectiveFlags : [...effectiveFlags, ...rawArgs.slice(separator)];
    await runCommand(main, { rawArgs: effectiveArgs });
  } catch (error) {
    handleError(error, effectiveFlags);
  } finally {
    await closeBrowserFetches();
    closeProxyBridge();
  }
}

await mainEntry();
