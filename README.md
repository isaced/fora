<h1 align="center">fora</h1>

<p align="center">
  Agent-first, read-only CLI for many forums.<br>
  One normalised interface for humans and AI agents — clean JSON by default when piped.
</p>

<p align="center">
  <a href="#why-fora"><strong>Why</strong></a> ·
  <a href="#token-economy"><strong>Token economy</strong></a> ·
  <a href="#supported-engines"><strong>Engines</strong></a> ·
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#commands"><strong>Commands</strong></a> ·
  <a href="#json-contract"><strong>JSON contract</strong></a>
</p>

<p align="center">
  <a href="https://github.com/isaced/fora/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/isaced/fora/ci.yml?branch=main&label=CI&logo=github" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/fora-cli"><img src="https://img.shields.io/npm/v/fora-cli?label=npm&logo=npm" alt="npm version"></a>
  <a href="https://github.com/isaced/fora/releases"><img src="https://img.shields.io/github/v/release/isaced/fora?label=release" alt="latest release"></a>
  <img src="https://img.shields.io/badge/runtime-Bun%201.1%2B-black?logo=bun" alt="Bun 1.1+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

```sh
fora hot --site v2ex                    # ranked topics on V2EX
fora hot --site linuxdo                 # Discourse, with automatic fallbacks
fora show 1 3 5 --excerpt --replies 3   # batch, token-shaped follow-up reads
fora digest --since 24h --budget 8000   # one scheduled-briefing payload
```

fora is not a generic web fetcher. Its value is **semantic normalisation**:
knowing which field is the title, which is the reply count, and who the author
is across forums — so agents can consume forums without scraping HTML or
driving a browser.

## Why fora

fora is built **agent-first**. Every command, flag and output is judged by how
well an agent can discover it, call it and afford it.

- **Accessible** — piped output is JSON by default; `--human` forces a table.
  Errors are structured with actionable next steps, exit codes are meaningful,
  and help ships concrete Examples (`fora help <command>`). Agents can bootstrap
  from the CLI with `fora skills get core` and `fora schema`.
- **Efficient** — one call replaces agent-side loops. `digest` returns every
  followed site's briefing in a single payload, using a bounded global fetch
  pool while keeping each host's request pacing.
- **Resilient** — public read requests that get HTTP 403 retry once through a
  reusable agent-browser session; Discourse can then fall back to RSS. JSON
  output declares which transport was used and which capabilities were lost.
- **Cost-aware** — `--fields`, excerpts, top-N replies, declared truncation,
  per-site token accounting and `digest --budget` keep context spend predictable.

## Token economy

Agents pay for every byte they read. Raw forum APIs return rendered HTML and
complete reply trees; fora returns excerpts and top replies, with truncation
declared in every envelope (`meta.approx_tokens`).

**Measured 2026-11-26: reading the hot lists and top 5 threads of V2EX and
HN costs ~546k tokens through raw APIs — fora does it in ~11k, about 49×
less (≈2%).**

```text
V2EX  Raw API  ████████████████████                 ~199,000
      fora     ▌                                      4,371

HN    Raw API  ███████████████████████████████████  ~346,000
      fora     ▋                                      6,874

(1 █ ≈ 10,000 tokens)
```

Same ~4 chars/token estimator on both sides — the one fora uses for
`meta.approx_tokens`:

|                                   |  Raw API |  fora |
| --------------------------------- | -------: | ----: |
| V2EX hot list (10)                |  ~12,300 | 1,313 |
| V2EX top 5 threads (677 replies)  | ~187,000 | 3,058 |
| HN front page (10)                |   ~5,400 |   874 |
| HN top 5 threads (2,409 comments) | ~341,000 | 6,000 |

Via HN's official Firebase API the same five threads require 2,409 separate
requests (~192k tokens); fora does it in one call.

## Supported engines

Adapters are written per **engine**, not per site. A site is just
`{name, url, engine}` in configuration, so adding a forum is usually zero code.

| Engine | Sites it serves | Notes |
|---|---|---|
| `discourse` | all Discourse instances | JSON API first, automatic RSS/browser fallback on HTTP 403; full capability set |
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

The npm package requires [Bun](https://bun.sh) 1.1+ at runtime:

```sh
bunx fora-cli hot
npm install -g fora-cli    # note: fora-cli, not fora
```

Note: the unscoped `fora` package on npm is an unrelated legacy framework.

For a standalone binary with no Bun runtime:

```sh
curl -fsSL https://raw.githubusercontent.com/isaced/fora/main/install.sh | sh
```

The script detects your OS/arch, downloads the matching release asset and
`.sha256`, verifies the checksum, and installs to `$HOME/.fora/bin`. Set
`FORA_VERIFY_ATTESTATION=1` to additionally require `gh attestation verify`. Pin a version or change the
install directory with environment variables:

```sh
FORA_VERSION=fora-cli-v0.3.0 sh install.sh
FORA_INSTALL_DIR=~/.local/bin sh install.sh --no-modify-path
```

To build a binary locally:

```sh
bun run build        # -> dist/fora
```

## Commands

```text
fora                             # print help
fora help <command>              # full help + examples (same as <command> --help)
fora skills get core             # version-matched agent guide
fora schema                      # machine-readable command/field contract
fora digest  [--since 24h] [--per-site 10] [--top-replies 3] [--budget N]
fora hot     [site] [--site <name|all|a,b>] [--period day|week|month|all] [-n 20]
fora latest  [site] [--site <name|all|a,b>] [-n 20]
fora show    <topic-ref...> [--page N] [--all-pages] [--replies N] [--excerpt]
fora search  <query…> [--site <name>]
fora categories [site] [--site <name>]
fora sites   list | add <url> | remove <name> | search <keyword>
fora engines list                # engines + capabilities matrix
fora doctor [--all]              # per-site reachability pre-flight
fora create-adapter <engine>     # scaffold an external adapter package
```

Global flags: `--json`, `--human`, `--limit/-n`, `--site`. Site resolution order
is `--site` → positional → `FORA_SITE` → `default_site` in config. If no site is
given and no `default_site` is set, fora exits 2 and lists known sites.

Piped data commands emit JSON by default; use `--human` to force a table.

### Addressable results

Every list is numbered, and the most recent one is cached so you can pick by
number:

```sh
fora hot --site v2ex
fora show 3          # opens the 3rd topic of that list
fora show 1 3 5      # batch, one process and one pacing pool
fora show 3 --excerpt --replies 5
```

The cache lives in `$XDG_CACHE_HOME/fora/last-list.json`. It supplies numeric
references and can associate a recent item URL with its site when the URL
and the configured feed live on different hosts.

For Hacker News, `url` links to the discussion that `fora show` can open;
`source_url` preserves the linked article when there is one.

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

Built-in presets work with zero config; pass `--site` (or set `default_site`)
to choose one. `fora sites add <url>` probes a forum URL, detects its engine,
and appends it to your config (use `--yes` in scripts).

`digest` applies `include_nodes` and `include_categories` before fetching
topic details. Entries match section IDs (quote them in YAML), slugs, or
names exactly; configured allowlists exclude topics whose section cannot be
matched.

### Official site directory

`sites.yaml` at the package root is a bundled directory of known forums. Its
entries work without `sites add`:

```sh
fora hot --site swift-forums
fora sites search rust
```

User config overrides the directory on a name clash. Adding a forum is a
one-line PR.

## JSON contract

Every data command shares one envelope:

```json
{ "schema": "fora/v1", "data": …, "meta": { "approx_tokens": 1234 } }
```

Agent-facing guarantees:

- `meta.approx_tokens` estimates the payload cost before deeper reading.
- `meta.degraded_sites` declares transport downgrades and lost capabilities.
- Multi-site `hot`/`latest` and `digest` report `meta.succeeded_sites` and
  `meta.failed_sites` (`site`, `code`, `message`). A successful empty site
  still counts as success. If every site fails, stdout stays empty and the
  JSON error on stderr includes `failed_sites`; the exit code is nonzero.
- `digest` reports `per_site_tokens`, `budget`, `omitted_sites` and
  `omitted_topics`.
- `show` declares `total_replies`, `fetched_replies` and `omitted_replies` so a
  fetch window cannot masquerade as the whole thread.
- `--since 24h` restricts lists/digests to topics created or active inside the
  window, using only timestamps the APIs already return. No seen-store.
- `fora schema` and `fora help <command> --json` expose the full contract
  without parsing human help.

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
