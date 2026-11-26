#!/usr/bin/env bun
/**
 * fora CLI entry point.
 *
 * We drive citty's runCommand directly (rather than runMain) so that fora's
 * exit codes and --json error shape win over citty's defaults:
 *   0 ok · 1 generic · 2 usage · 3 unsupported · 4 rate-limited.
 */

import { renderUsage, runCommand, type CommandDef } from "citty";
import { main } from "./commands/index.ts";
import { ForaError, exitCodeOf, messageOf } from "./core/errors.ts";
import { VERSION } from "./core/version.ts";
import { writeErrorJson } from "./output/json.ts";

type AnyCommand = CommandDef<any>;

const VALUE_FLAGS = new Set(["site", "limit", "n", "since", "fields", "period", "page", "per-site", "top-replies", "dir"]);

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
      expectValue = VALUE_FLAGS.has(token.replace(/^-+/, ""));
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

function didYouMean(token: string): string | undefined {
  const names = Object.keys((main.subCommands ?? {}) as Record<string, AnyCommand>);
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

function isCittyError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && (error.name === "CLIError" || /^E[A-Z_]*$/.test((error as { code?: string }).code ?? ""));
}

function handleError(error: unknown, rawArgs: string[]): void {
  const json = rawArgs.includes("--json");

  if (error instanceof ForaError) {
    if (json) writeErrorJson(error.code, error.message);
    else process.stderr.write(`fora: ${error.message}\n`);
    process.exitCode = error.exitCode;
    return;
  }

  if (isCittyError(error)) {
    let message = stripAnsi(messageOf(error));
    const unknown = message.match(/Unknown command (\S+)/);
    if (unknown) {
      const suggestion = didYouMean(unknown[1]!);
      if (suggestion) message += `\nDid you mean "${suggestion}"?`;
    }
    if (/Missing required/.test(message)) {
      message += "\nRun `fora <command> --help` for usage.";
    }
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
      expectValue = VALUE_FLAGS.has(token.replace(/^-+/, ""));
      continue;
    }
    return token;
  }
  return undefined;
}

async function printUsage(cmd: AnyCommand, parent?: AnyCommand): Promise<void> {
  let text = await renderUsage(cmd, parent);
  if (!process.stdout.isTTY || process.env.NO_COLOR) text = stripAnsi(text);
  process.stdout.write(`${text}\n`);
}

async function mainEntry(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    await printUsage(...resolveHelpTarget(rawArgs));
    return;
  }
  if (rawArgs.length === 1 && (rawArgs[0] === "--version" || rawArgs[0] === "-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (firstNonFlagToken(rawArgs) === undefined) {
    await printUsage(main);
    return;
  }

  try {
    await runCommand(main, { rawArgs });
  } catch (error) {
    handleError(error, rawArgs);
  }
}

await mainEntry();
