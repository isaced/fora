import { beforeEach, describe, expect, it } from "bun:test";
import { UsageError } from "../core/errors.ts";
import { followSiteNames } from "../core/sites.ts";
import type { Site } from "../core/sites.ts";
import { pickSiteName, siteByName } from "./common.ts";

const sites: Site[] = [
  { name: "v2ex", engine: "v2ex", source: "preset" },
  { name: "linuxdo", engine: "discourse", source: "preset" },
];

beforeEach(() => {
  delete process.env.FORA_SITE;
});

describe("pickSiteName", () => {
  it("prefers --site over the positional", () => {
    expect(pickSiteName("linuxdo", "v2ex", { sites: [] }, sites)).toBe("linuxdo");
  });

  it("uses the positional when no flag is given", () => {
    expect(pickSiteName(undefined, "v2ex", { sites: [] }, sites)).toBe("v2ex");
  });

  it("falls back to default_site", () => {
    expect(pickSiteName(undefined, undefined, { sites: [], default_site: "linuxdo" }, sites)).toBe("linuxdo");
  });

  it("errors instead of guessing when no site is available", () => {
    expect(() => pickSiteName(undefined, undefined, { sites: [] }, sites)).toThrow(UsageError);
  });

  it("lays out the no-site error in short, readable lines", () => {
    let message = "";
    try {
      pickSiteName(undefined, undefined, { sites: [] }, sites, "hot");
    } catch (error) {
      message = (error as Error).message;
    }
    const lines = message.split("\n");
    expect(lines[0]).toBe("no site specified");
    expect(message).toContain("fora hot --site <name>");
    expect(message).toContain("fora hot <name>");
    expect(message).toContain("default_site: <name>");
    expect(message).toContain("Known sites:");
    expect(lines.every((line) => line.length <= 80)).toBe(true);
  });

  it("omits the positional example for site-less commands like search", () => {
    let message = "";
    try {
      pickSiteName(undefined, undefined, { sites: [] }, sites, "search", false);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("fora search --site <name>");
    expect(message).not.toContain("fora search <name>");
  });
});

describe("siteByName", () => {
  it("lays out unknown-site errors with wrapped known sites", () => {
    let message = "";
    try {
      siteByName(sites, "nope");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.split("\n")[0]).toBe('unknown site "nope"');
    expect(message).toContain("Known sites:");
    expect(message).toContain("fora sites add <url>");
    expect(message.split("\n").every((line) => line.length <= 80)).toBe(true);
  });
});

describe("followSiteNames", () => {
  it("uses the follow list when present", () => {
    expect(followSiteNames({ sites: [], follow: ["v2ex", "linuxdo"] })).toEqual(["v2ex", "linuxdo"]);
  });

  it("falls back to default_site", () => {
    expect(followSiteNames({ sites: [], default_site: "linuxdo" })).toEqual(["linuxdo"]);
  });

  it("errors when neither follow nor default_site is set", () => {
    expect(() => followSiteNames({ sites: [] })).toThrow(UsageError);
  });
});
