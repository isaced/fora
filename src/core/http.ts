/**
 * A small HTTP client with the etiquette rules from SPEC §9 baked in:
 * identifiable User-Agent, pacing per host, a hard timeout, bounded retries
 * on 5xx, and an immediate stop on 429 or anti-bot block pages.
 */

import { NetworkError, NotFoundError, RateLimitError, UpstreamError } from "./errors.ts";
import { createFetch } from "./proxy-fetch.ts";
import { USER_AGENT } from "./version.ts";

export interface HttpClientOptions {
  userAgent?: string;
  /** Minimum gap between request starts to the same host (default 300 ms). */
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  accept?: string;
  signal?: AbortSignal;
}

export interface RawResponse {
  url: string;
  status: number;
  headers: Headers;
  text: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function looksLikeBlockPage(status: number, body: string): boolean {
  if (status !== 403) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("attention required") ||
    lower.includes("cf-challenge") ||
    (lower.includes("cloudflare") && (lower.includes("captcha") || lower.includes("challenge")))
  );
}

export class HttpClient {
  readonly userAgent: string;
  readonly minIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;

  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly lastRequestAt = new Map<string, number>();
  private readonly hostChains = new Map<string, Promise<void>>();

  constructor(options: HttpClientOptions = {}) {
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.minIntervalMs = options.minIntervalMs ?? 300;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? createFetch();
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  /** Serialise request starts per host so pacing holds under concurrency. */
  private async pace(host: string): Promise<void> {
    const previous = this.hostChains.get(host) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.hostChains.set(host, previous.then(() => gate));

    await previous;

    const last = this.lastRequestAt.get(host) ?? -Infinity;
    const wait = this.minIntervalMs - (Date.now() - last);
    if (wait > 0) await this.sleepImpl(wait);
    this.lastRequestAt.set(host, Date.now());
    release();
  }

  async get(url: string, options: RequestOptions = {}): Promise<RawResponse> {
    const host = safeHost(url);
    let attempt = 0;

    while (true) {
      attempt += 1;
      await this.pace(host);

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method ?? "GET",
          headers: {
            "user-agent": this.userAgent,
            accept: options.accept ?? "*/*",
            ...(options.headers ?? {}),
          },
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(this.timeoutMs)])
            : AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (attempt <= this.maxRetries) {
          await this.sleepImpl(400 * attempt);
          continue;
        }
        throw new NetworkError(`request to ${host} failed: ${errorText(error)}`);
      }

      const text = await safeText(response);

      if (response.status === 429) {
        throw new RateLimitError(`GET ${url} was rate limited (HTTP 429)`);
      }
      if (looksLikeBlockPage(response.status, text)) {
        throw new RateLimitError(`GET ${url} was blocked by an anti-bot page (HTTP 403)`);
      }
      if (response.status >= 500) {
        if (attempt <= this.maxRetries) {
          await this.sleepImpl(500 * attempt);
          continue;
        }
        throw new UpstreamError(`GET ${url} failed with HTTP ${response.status}`, response.status);
      }
      if (response.status === 404) {
        throw new NotFoundError(`GET ${url} returned 404`);
      }
      if (response.status >= 400) {
        throw new UpstreamError(`GET ${url} failed with HTTP ${response.status}`, response.status);
      }

      return { url, status: response.status, headers: response.headers, text };
    }
  }

  async getText(url: string, options: RequestOptions = {}): Promise<string> {
    return (await this.get(url, options)).text;
  }

  async getJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.get(url, { ...options, accept: options.accept ?? "application/json" });
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new UpstreamError(`GET ${url} did not return valid JSON`, response.status);
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timed out";
    return error.message;
  }
  return String(error);
}
