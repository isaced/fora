/**
 * Agent-friendly help content that citty's renderer does not model:
 * prose about behaviour and concrete, copy-pasteable examples.
 *
 * Each command gets a short prose description followed by an "Examples:"
 * block. `fora help <command>` reaches the same output. The prose adds
 * behavioural detail instead of repeating the command's one-line description.
 */

import { wrapText } from "../core/error-format.ts";

export interface CommandGuide {
  about: string[];
  details?: string[];
  examples: string[];
}

export const COMMAND_GUIDES: Record<string, CommandGuide> = {
  "": {
    about: [
      "Human output is the default; every command accepts --json for a stable fora/v1 envelope.",
      "In JSON mode errors go to stderr as {code, message}.",
      "Exit codes: 0=ok, 1=generic, 2=usage, 3=unsupported, 4=rate-limited.",
      "Site resolution order: --site, positional site, FORA_SITE, then default_site. Use `fora sites list` to discover names.",
    ],
    details: [
      "Agents should prefer explicit --site and --json; positional arguments are shortcuts for humans.",
      "Common flags: --site <name|all|a,b>, -n/--limit, --since, --fields, --json (see each command's help).",
    ],
    examples: [
      "fora hot --site v2ex --json          # one command, machine-readable result",
      "fora sites list --json               # discover site names and engines",
      "fora help hot                        # alternative help entry point",
      "fora doctor --json                   # pre-flight reachability check",
    ],
  },
  hot: {
    about: [
      "Ranking windows vary by engine; `fora engines list` shows which engines support `hot` and `--period`.",
      "HTTP 403s on public reads retry once through agent-browser; Discourse can then fall back to RSS. Degraded calls declare it in output.",
      "Results become the last list, so `fora show <number>` can open an item without copying ids or URLs.",
    ],
    details: [
      "Failures from --site all are reported on stderr; successful sites still print normally.",
    ],
    examples: [
      "fora hot --site v2ex                        # explicit site (recommended)",
      "fora hot v2ex                               # positional shorthand",
      "fora hot --site linuxdo --period week -n 10",
      "fora hot --site all --since 24h --json",
      "fora hot --site v2ex,hn --fields title,url,reply_count",
    ],
  },
  latest: {
    about: [
      "Unlike `hot`, there is no `--period` flag; ordering comes straight from the engine feed.",
      "The output is cached as the last list for `fora show <number>`.",
    ],
    examples: [
      "fora latest --site v2ex",
      "fora latest v2ex -n 10",
      "fora latest --site all --since 24h --json",
      "fora latest --site v2ex,hn --fields title,created_at",
    ],
  },
  show: {
    about: [
      "Hosts that are not configured are resolved ephemerally when their engine can be recognised.",
      "Numbers are 1-based indexes into the last list produced by `hot`, `latest`, `search` or `digest`.",
    ],
    examples: [
      "fora show https://linux.do/t/12345",
      "fora show linuxdo:12345",
      "fora show 3 --json                          # item 3 of the last list",
      "fora show https://news.ycombinator.com/item?id=12345 --all-pages",
    ],
  },
  search: {
    about: [
      "All positional words are joined into one query; choose the target with `--site`.",
      "Engines without search support fail with exit code 3 instead of returning an empty list.",
    ],
    examples: [
      "fora search rust async --site hn",
      'fora search "vector database" --site linuxdo --json',
      "fora search kubernetes --site v2ex -n 10 --since 7d",
    ],
  },
  categories: {
    about: [
      "Only engines declaring the `categories` capability support this; others fail with exit code 3.",
    ],
    examples: [
      "fora categories --site v2ex",
      "fora categories linuxdo --json",
    ],
  },
  digest: {
    about: [
      "The site set comes from `follow:` in config, or `default_site` when `follow` is unset.",
      "Site and topic fetches share a bounded global pool; each host still keeps its request pacing.",
    ],
    details: [
      "Use `fora sites list` to find names for the follow list.",
    ],
    examples: [
      "fora digest",
      "fora digest --since 24h --per-site 5",
      "fora digest --top-replies 2 --json",
    ],
  },
  sites: {
    about: [
      "Sites come from config, the bundled directory and built-in presets; config wins on name clashes.",
    ],
    examples: [
      "fora sites list --json",
      "fora sites search discourse",
      "fora sites add https://linux.do --yes",
      "fora sites remove my-site --yes",
    ],
  },
  "sites list": {
    about: [
      "Each row shows the engine, URL, source (`config`, `directory` or `preset`) and tags.",
    ],
    examples: [
      "fora sites list",
      "fora sites list --json",
    ],
  },
  "sites search": {
    about: [
      "Matching is case-insensitive and also considers engine and URL, not only name and tag.",
    ],
    examples: [
      "fora sites search linux",
      "fora sites search discourse --json",
    ],
  },
  "sites add": {
    about: [
      "Engine detection makes network requests. Interactive by default; pass `--yes` in scripts and for agents.",
    ],
    details: [
      "Check connectivity with `fora doctor` if detection fails.",
    ],
    examples: [
      "fora sites add https://linux.do --yes",
      "fora sites add https://example.com/feed.xml --yes",
    ],
  },
  "sites remove": {
    about: [
      "Presets and directory entries are read-only; use `fora sites add` to make a writable copy.",
    ],
    examples: [
      "fora sites remove my-site --yes",
      "fora sites list --json                 # confirm what is configured",
    ],
  },
  engines: {
    about: [
      "External adapters are discovered from the config directory and installed `fora-adapter-*` packages.",
    ],
    examples: [
      "fora engines list",
      "fora engines list --json",
    ],
  },
  "engines list": {
    about: [
      "Rows are sorted by name and tagged `builtin` or `external`.",
    ],
    examples: [
      "fora engines list",
      "fora engines list --json",
    ],
  },
  doctor: {
    about: [
      "Reports per-site failures and loaded-engine issues; start here for network, rate-limit or adapter problems.",
    ],
    examples: [
      "fora doctor",
      "fora doctor --all --json",
    ],
  },
  schema: {
    about: [
      "Print the machine-readable contract: commands, flags, topic fields, exit codes and degradation semantics.",
    ],
    examples: [
      "fora schema",
      "fora schema sites add",
      "fora help hot --json            # schema for one command",
    ],
  },
  skills: {
    about: [
      "Bundled, version-matched usage guides for agents. No network or repository access needed.",
    ],
    examples: [
      "fora skills get core",
      "fora skills list --json",
    ],
  },
  "skills get": {
    about: [
      "Print a bundled skill as markdown, or as JSON with --json.",
    ],
    examples: [
      "fora skills get core",
      "fora skills get core --json",
    ],
  },
  "skills list": {
    about: [
      "List the skill names bundled with this fora version.",
    ],
    examples: [
      "fora skills list",
      "fora skills list --json",
    ],
  },
  "create-adapter": {
    about: [
      "Generated files go to `fora-adapter-<engine>` in cwd, or under `--dir`.",
      "Implement `detect` and `latest` in `index.ts` before loading the adapter.",
    ],
    examples: [
      "fora create-adapter my-forum",
      "fora create-adapter my-forum --dir ./packages",
      "fora engines list                      # confirm the adapter loads",
    ],
  },
};

/** Append short prose and copy-pasteable examples after citty's flag tables. */
export function renderGuide(path: string): string {
  const guide = COMMAND_GUIDES[path];
  if (!guide) return "";

  const lines: string[] = [];
  for (const paragraph of [...guide.about, ...(guide.details ?? [])]) {
    lines.push(wrapText(paragraph, 88), "");
  }
  lines.push("Examples:", "");
  for (const example of guide.examples) lines.push(`  ${example}`);
  return lines.join("\n").trimEnd();
}
