# fora

An agent-first, read-only command-line client for many forums, through a single
unified interface. Humans get readable defaults; agents get clean, structured
data.

```
fora hot --site v2ex            # ranked topics on V2EX
fora hot --site linuxdo          # any Discourse instance
fora show https://www.v2ex.com/t/1259639
fora digest --since 24h --json   # one scheduled-briefing payload
```

fora is not a generic web fetcher. Its value is **semantic normalisation**:
knowing which field is the title, which is the reply count, and who the author
is, across every supported forum — so agents can consume forums without
scraping HTML.

## Design philosophy

fora is built **agent-first**; every command, flag and output is judged by how
well an agent can discover, call and afford it.

- **Accessibility**: `--json` on every command, structured errors with actionable
  next steps, meaningful exit codes, no TTY-only prompts, and help with concrete
  Examples (`fora help <command>`).
- **Efficiency**: one call replaces agent-side loops — `digest` returns every
  followed site's briefing in a single payload; fetches use a bounded global
  pool while keeping each host's request pacing. HTTP 403s on public reads
  retry once via a reusable agent-browser session when available.
- **Cost awareness**: `--fields` projection, excerpts by default, top-N replies,
  declared truncation, and a token estimate in every JSON envelope so agents can
  budget before reading the full payload.

## Supported engines

Adapters are written per **engine**, not per site. A site is just
`{name, url, engine}` in configuration, so adding a forum is usually zero code.

| Engine | Sites it serves | Notes |
|---|---|---|
| `discourse` | all Discourse instances | JSON API first, automatic RSS fallback on HTTP 403; hot / latest / topic / search / categories |
| `discourse-rss` | fallback transport used by `discourse` | hot / latest / topic via feeds; no search/categories or engagement metrics |
| `v2ex` | v2ex.com | hot / latest / topic / categories (no search, no period) |
| `hn` | Hacker News | hot / latest / topic / search (Firebase + Algolia) |
| `flarum` | any Flarum instance | hot (approx.) / latest / topic / search / tags |
| `nodebb` | any NodeBB instance | hot / latest / topic / search / categories |
| `ruby-china` | ruby-china.org | hot / latest / topic / categories (no search, no period) |
| `rss` | any forum with an RSS/Atom feed | latest, plus topic when full content is present |

Out of the box (zero config) you get **linux.do, V2EX and Hacker News**, plus a
bundled directory of ~30 notable forums. When a Discourse site falls back to
RSS or the browser, JSON output includes `meta.degraded_sites` so agents know
which capabilities were lost.

## Install

Requires [Bun](https://bun.sh) 1.1+ at runtime.

```sh
bunx fora-cli hot
npm install -g fora-cli
```

Single-file binaries are published on GitHub Releases. To build one locally:

```sh
bun run build        # -> dist/fora
```

## Commands

```
fora                             # prints help (use fora hot for the default site)
fora help <command>              # full help + examples (same as <command> --help)
fora digest  [--since 24h] [--per-site 10] [--top-replies 3]
fora hot     [site] [--site <name|all|a,b>] [--period day|week|month|all] [-n 20]
fora latest  [site] [--site <name|all|a,b>] [-n 20]
fora show    <topic-url | site:topic-id | last-list-number> [--page N] [--all-pages]
fora search  <query…> [--site <name>]
fora categories [site] [--site <name>]
fora sites   list | add <url> | remove <name> | search <keyword>
fora engines list                # engines + capabilities matrix
fora doctor [--all]              # per-site reachability pre-flight
fora create-adapter <engine>     # scaffold an external adapter package
```

Global flags: `--json`, `--limit/-n`, `--site`. Site resolution order is
`--site` → positional → `FORA_SITE` → `default_site` in config. If no site is
given and no `default_site` is set, fora exits 2 and lists the known sites.

### Addressable results

Every list is numbered, and the most recent one is cached so you can pick by
number:

```sh
fora hot --site v2ex
fora show 3          # opens the 3rd topic of that list
```

The cache lives in `$XDG_CACHE_HOME/fora/last-list.json` and is purely a
convenience — deleting it never changes what any command means.

### Exit codes

`0` ok · `1` generic error · `2` usage error · `3` unsupported operation ·
`4` rate-limited / upstream refusal.

## Configuration

`$XDG_CONFIG_HOME/fora/config.yaml` (fallback `~/.config/fora/config.yaml`):

```yaml
default_site: v2ex
follow: [v2ex, linuxdo]

sites:
  - name: v2ex
    engine: v2ex
    base_url: https://www.v2ex.com
  - name: linuxdo
    engine: discourse
    base_url: https://linux.do
    include_categories: [开发调优]   # optional allowlist
  - name: my-feed
    engine: rss
    base_url: https://example.com/feed.xml
```

Built-in presets are available with zero config; pass `--site` (or set
`default_site`) to choose one. `fora sites add <url>` probes a forum URL,
detects its engine, and appends it to your config (use `--yes` in scripts).

### Official site directory

`sites.yaml` at the package root is a bundled directory of known forums. Its
entries work without `sites add`:

```sh
fora hot --site swift-forums
fora sites search rust
```

User config overrides the directory on a name clash. Adding a forum is a
one-line PR.

## JSON for agents

Every command accepts `--json`, and all payloads share a stable envelope:

```json
{ "schema": "fora/v1", "data": …, "meta": { "approx_tokens": 1234 } }
```

Agent-specific provisions:

- `fora digest --json` returns every followed site's hot topics with OP
  excerpts and the top replies by likes — one call for a scheduled briefing.
- `--since 24h` restricts lists/digests to topics created or active inside the
  window, using only timestamps the APIs already return. No state files, no
  seen-store.
- `--fields title,url` returns only the named model fields (plus `site`).
- Truncation is always declared (`truncated`, `omitted_replies`), never silent.
- `fora engines list --json` and `fora doctor --json` are machine-readable
  capability/pre-flight checks.

## Development

```sh
bun install
bun test               # fully offline: adapters run on recorded fixtures
bunx tsc --noEmit      # type check
bun run build          # single-file binary
```

See [`docs/writing-an-adapter.md`](docs/writing-an-adapter.md) to add an engine.

## License

MIT
