# Writing a fora adapter

A fora adapter translates one forum platform's API into fora's unified data
model. Adapters are written per **engine** (Discourse, Flarum, …), not per site,
so one adapter serves every site running that engine.

This guide uses the [Hacker News adapter](../src/adapters/hn/index.ts) as the
worked example because it is the simplest: it composes two public JSON APIs.

## The contract

An adapter is a TypeScript module whose default export satisfies `Adapter`:

```ts
export interface Adapter {
  readonly engine: string;
  readonly capabilities: Capabilities;
  detect(site: SiteCandidate): Promise<boolean>;
  hot(site: Site, opts: HotOpts): Promise<Topic[]>;
  latest(site: Site, opts: ListOpts): Promise<Topic[]>;
  topic(site: Site, ref: string, page: number): Promise<TopicDetail>;
  search(site: Site, query: string, opts: ListOpts): Promise<Topic[]>;
  categories(site: Site): Promise<Category[]>;
}

export interface Capabilities {
  hot: boolean;
  latest: boolean;
  hotPeriods: boolean; // hot() accepts a --period window
  topic: boolean;
  search: boolean;
  categories: boolean;
}
```

`Site` is `{ name, engine, base_url?, site_url?, include_nodes?,
include_categories? }`. `ListOpts` is `{ limit }`; `HotOpts` adds an optional
`period: "day" | "week" | "month" | "all"`.

Rules:

- **Never fake data.** If an operation is unsupported, declare the capability
  `false` and throw the standard unsupported error from the stub method.
  Use `unsupported(engine, "operation")` so the CLI exits `3`.
- **Normalise timestamps** to UTC RFC 3339 (`toRfc3339`).
- **Normalise bodies** to plain text with `htmlToText` / `excerptOf`.
- **Honour `opts.limit`** where it saves work (e.g. only fetch N items).
- Be polite: the shared `HttpClient` paces requests, sets an identifiable
  User-Agent, retries 5xx, and stops on 429 / block pages.

## The model

```ts
interface Topic {
  id: string; site: string; title: string; url: string;
  author?: { username: string; display_name?: string; avatar_url?: string };
  category?: { id: string; name?: string };
  tags?: string[];
  reply_count?: number; view_count?: number; like_count?: number;
  created_at: string;          // RFC 3339 UTC
  last_activity_at: string;    // RFC 3339 UTC
  excerpt?: string;
  pinned: boolean;
}

interface Post {
  id: string; topic_id: string; floor: number;
  author?: { username: string };
  content_text: string; content_html?: string;
  created_at: string; like_count?: number;
}

interface TopicDetail extends Topic {
  posts: Post[]; post_count: number; page: number; pages: number;
  truncated?: boolean; omitted_replies?: number;
}
```

Optional fields are simply omitted when the source does not provide them.

## Worked example: Hacker News

The HN adapter needs a list of ids, then one item per id. Fetch item details
with bounded concurrency (max 8 in flight):

```ts
import { mapLimit } from "../../core/async.ts";
import { HttpClient } from "../../core/http.ts";

export function createHnAdapter(http: HttpClient = new HttpClient({ minIntervalMs: 0 })) {
  const engine = "hn";
  const fetchItem = (id: number) =>
    http.getJson<HnItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);

  return {
    engine,
    capabilities: { hot: true, latest: true, hotPeriods: false, topic: true, search: true, categories: false },

    async detect(candidate) {
      const host = candidate.url ? new URL(candidate.url).hostname : undefined;
      return host === "news.ycombinator.com";
    },

    async hot(site, opts) {
      const ids = await http.getJson<number[]>("https://hacker-news.firebaseio.com/v0/topstories.json");
      const items = await mapLimit(ids.slice(0, opts.limit), 8, fetchItem);
      return items.map((item) => mapItem(item, site));
    },
    // latest, topic, search, categories …
  };
}
```

Key points from this example:

- `hot` composes two endpoints: the story-id list and per-item details.
- `latest` is the same shape against `newstories.json`.
- `topic` flattens the `kids` comment tree depth-first and caps it at 200 posts,
  setting `truncated` / `omitted_replies` when it stops early.
- `search` uses Algolia (`https://hn.algolia.com/api/v1/search?query=&tags=story`).
- `categories` throws `unsupported(engine, "categories")`.

## Fixtures and tests

Every adapter ships recorded API responses under `fixtures/` (real responses
with any personal data removed). Tests run fully offline against those files.

The shared contract test in `src/core/contract.test.ts` walks every built-in
adapter and, for each capability it claims, asserts that list/topic/search/
categories output is well-formed. To plug an adapter into that harness, add a
fixture-backed HTTP client and a case to
`src/core/testing/fixtures.ts`. An adapter only passes when it can produce
well-formed model objects from its own fixtures.

Run:

```sh
bun test
bunx tsc --noEmit
```

## External adapters

Built-in adapters live in `src/adapters/<engine>/`. You can also ship an
adapter **outside** the repo; the loader imports it at runtime:

1. **A single file** in `$XDG_CONFIG_HOME/fora/adapters/*.ts|js|mjs`.
2. **An npm package** named `fora-adapter-<engine>` (add it to your project's
   dependencies).

An external adapter is just a module with the default export above — no SDK, no
build step. Scaffold one with:

```sh
fora create-adapter myforum
```

External adapters run with your user privileges, exactly like shell or editor
plugins: only install adapters you trust.

## Checklist

- [ ] `engine` and all six methods implemented.
- [ ] Capabilities reflect what the API actually supports.
- [ ] Unsupported methods throw `unsupported(engine, "…")` (exit 3).
- [ ] Timestamps via `toRfc3339`, HTML via `htmlToText`.
- [ ] `opts.limit` honoured.
- [ ] `fixtures/` added and a fixture-backed case registered.
- [ ] `bun test` and `bunx tsc --noEmit` pass.
