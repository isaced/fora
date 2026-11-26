import { describe, expect, it } from "bun:test";
import { closeBrowserFetches, createBrowserFetch, type BrowserRunResult } from "./browser-fetch.ts";

describe("createBrowserFetch", () => {
  it("opens one headed session per origin and evaluates fetches in page context", async () => {
    const calls: string[][] = [];
    const run = async (args: string[], stdin?: string): Promise<BrowserRunResult> => {
      calls.push(args);
      if (args.includes("eval")) {
        expect(stdin).toContain("https://ruby-china.org/api/v3/topics.json");
        return {
          stdout: JSON.stringify({ status: 200, headers: { "content-type": "application/json" }, body: '{"topics":[]}' }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const fetchThroughBrowser = createBrowserFetch(run);
    const response = await fetchThroughBrowser("https://ruby-china.org/api/v3/topics.json");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"topics":[]}');
    expect(calls.some((args) => args.includes("--headed") && args.includes("open"))).toBe(true);
    expect(calls.some((args) => args.includes("eval"))).toBe(true);

    await closeBrowserFetches(run);
    expect(calls.some((args) => args.includes("close"))).toBe(true);
  });
});
