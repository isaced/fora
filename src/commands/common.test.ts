import { beforeEach, describe, expect, it } from "bun:test";
import { UsageError } from "../core/errors.ts";
import { followSiteNames } from "../core/sites.ts";
import type { Site } from "../core/sites.ts";
import { pickSiteName } from "./common.ts";

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
