/**
 * Generic browser-backed fetch fallback via agent-browser.
 *
 * Triggered only on anti-bot HTTP 403 responses. A headed agent-browser
 * session is opened per origin, Cloudflare is cleared there, then each request
 * is replayed with `fetch()` inside that page so cookies and JS challenges
 * apply. The result is converted back into a standard Response.
 */

export interface BrowserRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type BrowserRunner = (args: string[], stdin?: string) => Promise<BrowserRunResult>;

async function defaultRunner(args: string[], stdin?: string): Promise<BrowserRunResult> {
  const proc = Bun.spawn(["agent-browser", ...args], {
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, code: proc.exitCode ?? 1 };
}

const sessions = new Set<string>();

function sessionId(origin: string): string {
  return `fora-${origin.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]/g, "-")}`;
}

async function ensureSession(run: BrowserRunner, url: URL, session: string): Promise<void> {
  if (sessions.has(session)) return;
  sessions.add(session);
  const opened = await run(["--headed", "--session", session, "open", url.href]);
  if (opened.code !== 0) {
    sessions.delete(session);
    throw new Error(`agent-browser could not open ${url.origin}: ${opened.stderr.trim() || opened.stdout.trim()}`);
  }
  await run(["--session", session, "wait", "--load", "load"]);
}

export function createBrowserFetch(run: BrowserRunner = defaultRunner): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const session = sessionId(url.origin);
    await ensureSession(run, url, session);

    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const script = `(async () => {
      const response = await fetch(${JSON.stringify(url.href)}, {
        method: ${JSON.stringify(init.method ?? "GET")},
        headers: ${JSON.stringify(headers)},
      });
      const body = await response.text();
      return JSON.stringify({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      });
    })()`;

    const result = await run(["--session", session, "eval", "--stdin"], script);
    if (result.code !== 0) {
      throw new Error(`agent-browser fetch failed for ${url.href}: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    let parsed: unknown = JSON.parse(result.stdout.trim());
    // agent-browser prints string eval results as JSON-quoted strings.
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    const payload = parsed as {
      status: number;
      headers: Record<string, string>;
      body: string;
    };
    return new Response(payload.body, { status: payload.status, headers: payload.headers });
  }) as typeof fetch;
}

/** Close browser sessions opened by this process. */
export async function closeBrowserFetches(run: BrowserRunner = defaultRunner): Promise<void> {
  for (const session of sessions) {
    await run(["--session", session, "close"]);
  }
  sessions.clear();
}
