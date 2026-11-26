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
import { buildForaSchema, selectCommandSchema } from "./commands/schema.ts";
import { closeBrowserFetches } from "./core/browser-fetch.ts";
import { closeProxyBridge } from "./core/proxy-fetch.ts";
import { formatCliError, type ErrorSection } from "./core/error-format.ts";
import { ForaError, exitCodeOf, messageOf } from "./core/errors.ts";
import { VERSION } from "./core/version.ts";
import { writeErrorJson } from "./output/json.ts";

type AnyCommand = CommandDef<any>;

const VALUE_FLAGS = new Set([
  "site",
  "limit",
  "n",
  "since",
  "fields",
  "period",
  "page",
  "per-site",
  "perSite",
  "top-replies",
  "topReplies",
  "dir",
]);

const FLAG_EXAMPLES: Record<string, string> = {
  site: "fora hot --site v2ex",
  limit: "fora hot --limit 20",
  n: "fora hot -n 20",
  since: "fora hot --since 24h",
  fields: "fora hot --fields title,url",
  period: "fora hot --period week",
  page: "fora show linuxdo:12345 --page 2",
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

function resolveHelpTarget(rawArgs: string[]): readonly [AnyCommand, AnyCommand | undefined] {
  let cmd: AnyCommand = main;
  let parent: AnyCommand | undefined;
  let expectValue = false;

  for (const token of rawArgs) {
    if (expectValue) {
      expectValue = false;
      continue;
    }
    if (token.startsWith("-")) {
      expectValue = !token.includes("=") && VALUE_FLAGS.has(flagName(token));
      continue;
    }
    const subCommands = cmd.subCommands as Record<string, AnyCommand> | undefined;
    if (subCommands && token in subCommands) {
      parent = cmd;
      cmd = subCommands[token]!;
      continue;
    }
    break;
  }
  return [cmd, parent] as const;
}

function commandPath(rawArgs: string[]): string {
  let cmd: AnyCommand = main;
  const path: string[] = [];
  let expectValue = false;
  for (const token of rawArgs) {
    if (expectValue) {
      expectValue = false;
      continue;
    }
    if (token.startsWith("-")) {
      expectValue = !token.includes("=") && VALUE_FLAGS.has(flagName(token));
      continue;
    }
    const subCommands = cmd.subCommands as Record<string, AnyCommand> | undefined;
    if (subCommands && token in subCommands) {
      cmd = subCommands[token]!;
      path.push(token);
      continue;
    }
    break;
  }
  return path.join(" ") || "<command>";
}

function missingFlagValue(rawArgs: string[]): string | undefined {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index]!;
    if (!token.startsWith("-") || token.includes("=")) continue;
    const name = flagName(token);
    if (!VALUE_FLAGS.has(name)) continue;
    const next = rawArgs[index + 1];
    if (next === undefined || (next.startsWith("-") && !/^-\d/.test(next))) return name;
  }
  return undefined;
}

function displayFlag(name: string): string {
  if (name === "n") return "-n";
  return `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function writeMissingFlagError(name: string, json: boolean): void {
  const message = formatCliError(`${displayFlag(name)} requires a value`, [
    { heading: "Example:", lines: [FLAG_EXAMPLES[name] ?? `fora <command> ${displayFlag(name)} <value>`] },
  ]);
  if (json) writeErrorJson("usage", message);
  else process.stderr.write(`fora: ${message}\n`);
  process.exitCode = 2;
}

/** `fora sites` / `fora engines` should show help instead of a terse subcommand error. */
function bareParentCommand(
  rawArgs: string[],
): readonly [AnyCommand, AnyCommand | undefined, string] | undefined {
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
      expectValue = !token.includes("=") && VALUE_FLAGS.has(flagName(token));
      continue;
    }
    const subCommands = cmd.subCommands as Record<string, AnyCommand> | undefined;
    if (!subCommands || !(token in subCommands)) return undefined;
    parent = cmd;
    cmd = subCommands[token]!;
    path.push(token);
  }
  return cmd.subCommands ? [cmd, parent, path.join(" ")] : undefined;
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

/** Find the first token that is not a subcommand of the current command level. */
function findUnknownCommand(rawArgs: string[]): UnknownCommand | undefined {
  let cmd: AnyCommand = main;
  const path: string[] = [];
  let expectValue = false;

  for (const token of rawArgs) {
    if (expectValue) {
      expectValue = false;
      continue;
    }
    if (token.startsWith("-")) {
      expectValue = !token.includes("=") && VALUE_FLAGS.has(flagName(token));
      continue;
    }
    const subCommands = cmd.subCommands as Record<string, AnyCommand> | undefined;
    if (!subCommands) return undefined;
    if (token in subCommands) {
      cmd = subCommands[token]!;
      path.push(token);
      continue;
    }
    return { token, parentPath: path.join(" "), names: Object.keys(subCommands) };
  }
  return undefined;
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
    if (json) writeErrorJson(error.code, message);
    else process.stderr.write(`fora: ${message}\n`);
    process.exitCode = error.exitCode;
    return;
  }

  if (isCittyError(error)) {
    let message = stripAnsi(messageOf(error));
    const sections: ErrorSection[] = [];
    const unknownInfo = findUnknownCommand(rawArgs);
    if (unknownInfo) {
      message = unknownCommandMessage(unknownInfo);
    } else {
      const unknown = message.match(/Unknown command (\S+)/);
      if (unknown) {
        const parentPath = guidePathOf(rawArgs);
        const suggestion = didYouMean(unknown[1]!);
        if (suggestion) {
          const command = [parentPath, suggestion].filter(Boolean).join(" ");
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

function firstNonFlagToken(rawArgs: string[]): string | undefined {
  let expectValue = false;
  for (const token of rawArgs) {
    if (expectValue) {
      expectValue = false;
      continue;
    }
    if (token.startsWith("-")) {
      expectValue = !token.includes("=") && VALUE_FLAGS.has(flagName(token));
      continue;
    }
    return token;
  }
  return undefined;
}

function guidePathOf(rawArgs: string[]): string {
  const path = commandPath(rawArgs);
  return path === "<command>" ? "" : path;
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

async function mainEntry(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs[0] === "help") {
    const targetArgs = rawArgs.slice(1);
    const unknown = findUnknownCommand(targetArgs);
    if (unknown) {
      process.stderr.write(`${unknownCommandMessage(unknown)}\n`);
      process.exitCode = 2;
      return;
    }
    const guidePath = guidePathOf(targetArgs);
    if (rawArgs.includes("--json")) {
      await printSchema(guidePath);
      return;
    }
    const [cmd, parent] = resolveHelpTarget(targetArgs);
    await printUsage(cmd, parent, guidePath);
    return;
  }
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    const unknown = findUnknownCommand(rawArgs);
    if (unknown) {
      process.stderr.write(`${unknownCommandMessage(unknown)}\n`);
      process.exitCode = 2;
      return;
    }
    const guidePath = guidePathOf(rawArgs);
    if (rawArgs.includes("--json")) {
      await printSchema(guidePath);
      return;
    }
    const [cmd, parent] = resolveHelpTarget(rawArgs);
    await printUsage(cmd, parent, guidePath);
    return;
  }
  if (rawArgs.length === 1 && (rawArgs[0] === "--version" || rawArgs[0] === "-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (firstNonFlagToken(rawArgs) === undefined) {
    await printUsage(main, undefined, "");
    return;
  }
  const bareParent = bareParentCommand(rawArgs);
  if (bareParent) {
    await printUsage(...bareParent);
    return;
  }
  const missingFlag = missingFlagValue(rawArgs);
  if (missingFlag) {
    writeMissingFlagError(missingFlag, rawArgs.includes("--json"));
    return;
  }

  try {
    await runCommand(main, { rawArgs });
  } catch (error) {
    handleError(error, rawArgs);
  } finally {
    await closeBrowserFetches();
    closeProxyBridge();
  }
}

await mainEntry();
